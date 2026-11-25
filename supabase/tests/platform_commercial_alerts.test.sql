-- Regression test for Frente 7 commercial alerts outbox & candidate RPC.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'platform_commercial_alerts'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  ),
  'platform_commercial_alerts enables both RLS and FORCE ROW LEVEL SECURITY'
);

SELECT extensions.is(
  pg_catalog.has_table_privilege('anon', 'public.platform_commercial_alerts', 'SELECT'),
  false,
  'anon cannot select platform_commercial_alerts'
);

SELECT extensions.is(
  pg_catalog.has_function_privilege(
    'anon',
    'public.list_platform_commercial_alert_candidates(date)'::regprocedure,
    'EXECUTE'
  ),
  false,
  'anon cannot execute list_platform_commercial_alert_candidates'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.list_platform_commercial_alert_candidates(date)'::regprocedure
      AND p.prosecdef = true
      AND '' = ANY (p.proconfig)
  ),
  'list_platform_commercial_alert_candidates is SECURITY DEFINER with empty search_path'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.list_platform_commercial_alert_candidates(date)'::regprocedure
  ) ILIKE '%is_platform_admin%',
  'list_platform_commercial_alert_candidates checks app_auth.is_platform_admin()'
);

SELECT * FROM extensions.finish();
ROLLBACK;
