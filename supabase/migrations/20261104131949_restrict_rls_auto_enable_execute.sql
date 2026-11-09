-- Bootstrap the RLS event-trigger baseline for clean local/test installations.
-- SMS2 already had this platform safeguard before the first app migration, but its
-- original DDL was not versioned. Keep the exact reviewed implementation here so
-- a fresh database can replay the same migration chain as the managed project.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name = 'public'
       AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl
        FROM pg_catalog.pg_class c
        WHERE c.oid = cmd.objid;

        EXECUTE pg_catalog.format(
          'ALTER TABLE IF EXISTS %I.%I ENABLE ROW LEVEL SECURITY',
          cmd.schema_name,
          tbl
        );
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (schema is outside public)', cmd.object_identity;
    END IF;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.rls_auto_enable() OWNER TO postgres;

DO $event_trigger$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure('public.rls_auto_enable()');
  v_existing record;
BEGIN
  SELECT e.evtfoid, e.evtevent, e.evtenabled, e.evttags
    INTO v_existing
  FROM pg_catalog.pg_event_trigger e
  WHERE e.evtname = 'ensure_rls';

  IF NOT FOUND THEN
    EXECUTE
      'CREATE EVENT TRIGGER ensure_rls
       ON ddl_command_end
       WHEN TAG IN (''CREATE TABLE'', ''CREATE TABLE AS'', ''SELECT INTO'')
       EXECUTE FUNCTION public.rls_auto_enable()';
  ELSIF v_existing.evtfoid IS DISTINCT FROM v_function_oid
     OR v_existing.evtevent IS DISTINCT FROM 'ddl_command_end'
     OR v_existing.evtenabled IS DISTINCT FROM 'O'
     OR v_existing.evttags IS DISTINCT FROM ARRAY['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[] THEN
    RAISE EXCEPTION
      'Migration stopped: existing event trigger ensure_rls does not match the reviewed RLS baseline.';
  END IF;
END;
$event_trigger$;

-- Restrict direct API execution of the internal RLS event-trigger function.
-- The event trigger ensure_rls remains enabled and is verified below.
-- A disposable public table proves the event trigger still enables RLS.
DO $migration$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure('public.rls_auto_enable()');
  v_probe_name text := '__rls_auto_enable_probe_' ||
    pg_catalog.substr(pg_catalog.md5(pg_catalog.txid_current()::text), 1, 10);
  v_rls_enabled boolean;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Migration stopped: public.rls_auto_enable() was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_event_trigger e
    WHERE e.evtname = 'ensure_rls'
      AND e.evtfoid = v_function_oid
      AND e.evtevent = 'ddl_command_end'
      AND e.evtenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Migration stopped: enabled event trigger ensure_rls is not attached to public.rls_auto_enable().';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_function_oid
      AND p.prosecdef = true
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'Migration stopped: public.rls_auto_enable() does not match the reviewed postgres-owned SECURITY DEFINER function.';
  END IF;

  EXECUTE
    'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role';

  IF pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration stopped: an API role still has EXECUTE on public.rls_auto_enable().';
  END IF;

  -- This DDL fires ensure_rls. If the internal event-trigger execution were
  -- broken by the ACL change, this migration aborts before committing.
  EXECUTE pg_catalog.format(
    'CREATE TABLE public.%I (id integer PRIMARY KEY)',
    v_probe_name
  );

  SELECT c.relrowsecurity
    INTO v_rls_enabled
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = v_probe_name;

  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Migration stopped: ensure_rls did not enable RLS on the disposable verification table.';
  END IF;

  EXECUTE pg_catalog.format('DROP TABLE public.%I', v_probe_name);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_event_trigger e
    WHERE e.evtname = 'ensure_rls'
      AND e.evtfoid = v_function_oid
      AND e.evtevent = 'ddl_command_end'
      AND e.evtenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Migration stopped: ensure_rls is no longer enabled after the verification DDL.';
  END IF;
END
$migration$;
