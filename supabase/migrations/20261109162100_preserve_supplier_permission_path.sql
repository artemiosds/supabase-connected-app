-- Preserve the original municipal permission path and add only the scoped support-session path.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $supplier_permission_fn$
DECLARE
  v_argument_name text;
BEGIN
  SELECT p.proargnames[2]
    INTO v_argument_name
  FROM pg_catalog.pg_proc p
  WHERE p.oid = pg_catalog.to_regprocedure('app_auth.has_supplier_permission(uuid,text)');

  IF v_argument_name NOT IN ('p_code', 'p_permission_code') THEN
    RAISE EXCEPTION 'Unexpected second argument name for app_auth.has_supplier_permission(uuid,text): %',
      COALESCE(v_argument_name, '<unnamed>');
  END IF;

  EXECUTE pg_catalog.format($definition$
    CREATE OR REPLACE FUNCTION app_auth.has_supplier_permission(
      p_tenant_id uuid,
      %1$I text
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path=''
    AS $body$
      SELECT
        app_auth.has_active_supplier_support_session(p_tenant_id, %1$I)
        OR (
          NOT app_auth.is_platform_admin()
          AND EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            JOIN public.tenants t ON t.id=tm.tenant_id
            JOIN public.membership_roles mr
              ON mr.membership_id=tm.id AND mr.tenant_id=tm.tenant_id
            JOIN public.tenant_roles tr
              ON tr.id=mr.role_id AND tr.tenant_id=mr.tenant_id
            JOIN public.tenant_role_permissions rp ON rp.role_id=tr.id
            JOIN public.permissions p ON p.id=rp.permission_id
            WHERE tm.tenant_id=p_tenant_id
              AND tm.user_id=(SELECT auth.uid())
              AND tm.status='active'
              AND t.status='active'
              AND p.code=%1$I
          )
        );
    $body$;
  $definition$, v_argument_name);
END;
$supplier_permission_fn$;

REVOKE ALL ON FUNCTION app_auth.has_supplier_permission(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.has_supplier_permission(uuid,text)
  TO authenticated;

COMMIT;
