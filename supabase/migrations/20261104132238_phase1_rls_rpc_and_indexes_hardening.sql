-- Harden Phase 1 after first installation:
-- 1) allow tenant provisioning RPC to run as invoker under explicit RLS grants,
-- 2) separate SELECT from write policies on role permissions,
-- 3) add indexes on child-side foreign keys flagged by Supabase Advisor.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Child-side FK indexes for delete/update referential checks and joins.
CREATE INDEX idx_membership_roles_tenant
  ON public.membership_roles(tenant_id);
CREATE INDEX idx_platform_admins_granted_by
  ON public.platform_admins(granted_by)
  WHERE granted_by IS NOT NULL;
CREATE INDEX idx_tenant_role_permissions_permission
  ON public.tenant_role_permissions(permission_id);
CREATE INDEX idx_tenants_created_by
  ON public.tenants(created_by);

-- The provisioning RPC does not need to bypass RLS: make the permission
-- boundaries explicit in policies and let it execute as the authenticated caller.
ALTER FUNCTION public.create_tenant_with_admin(text, text, uuid) SECURITY INVOKER;

GRANT INSERT ON public.tenants TO authenticated;
CREATE POLICY p_tenants_insert ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.is_platform_admin())
    AND created_by = (SELECT auth.uid())
  );

-- A platform admin may create native/system roles during controlled provisioning.
-- Municipal role managers may create and manage only custom roles.
DROP POLICY p_roles_insert ON public.tenant_roles;
CREATE POLICY p_roles_insert ON public.tenant_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    (is_system AND (SELECT app_auth.is_platform_admin()))
    OR (
      NOT is_system
      AND (
        (SELECT app_auth.is_platform_admin())
        OR (SELECT app_auth.has_tenant_permission(tenant_id, 'roles:manage'))
      )
    )
  );

-- Keep one SELECT policy, and narrow the management policies to actual write actions.
DROP POLICY p_role_permissions_manage ON public.tenant_role_permissions;
CREATE POLICY p_role_permissions_insert ON public.tenant_role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.is_platform_admin())
    OR EXISTS (
      SELECT 1
      FROM public.tenant_roles tr
      WHERE tr.id = tenant_role_permissions.role_id
        AND app_auth.has_tenant_permission(tr.tenant_id, 'roles:manage')
    )
  );
CREATE POLICY p_role_permissions_delete ON public.tenant_role_permissions
  FOR DELETE TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR EXISTS (
      SELECT 1
      FROM public.tenant_roles tr
      WHERE tr.id = tenant_role_permissions.role_id
        AND app_auth.has_tenant_permission(tr.tenant_id, 'roles:manage')
    )
  );

COMMIT;
