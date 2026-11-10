-- Preserve the original municipal permission path and add only the scoped support-session path.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION app_auth.has_supplier_permission(
  p_tenant_id uuid,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT
    app_auth.has_active_supplier_support_session(p_tenant_id,p_permission_code)
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
          AND p.code=p_permission_code
      )
    );
$function$;

REVOKE ALL ON FUNCTION app_auth.has_supplier_permission(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.has_supplier_permission(uuid,text)
  TO authenticated;

COMMIT;
