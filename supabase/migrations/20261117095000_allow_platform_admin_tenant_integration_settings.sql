-- Allow platform administrators to manage tenant integration settings globally.
-- Tenant administrators remain restricted to their own tenant permissions.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_tenant_settings_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean, can_edit boolean)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT
    CASE
      WHEN app_auth.is_platform_admin() THEN true
      ELSE app_auth.has_tenant_permission(p_tenant_id, 'org:view')
    END,
    CASE
      WHEN app_auth.is_platform_admin() THEN true
      ELSE app_auth.has_tenant_permission(p_tenant_id, 'org:edit')
    END;
$function$;

COMMENT ON FUNCTION public.get_tenant_settings_capabilities(uuid) IS
  'Allows platform administrators to view and manage any tenant integration settings; tenant users require org:view/org:edit on the requested tenant.';

COMMIT;
