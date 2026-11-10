-- Complete the FK index coverage for internal staff RBAC tables.
-- This migration is forward-only and is not applied to SMS2 until a separate rollout.

CREATE INDEX IF NOT EXISTS idx_platform_staff_invited_by
  ON public.platform_staff(invited_by);

CREATE INDEX IF NOT EXISTS idx_platform_staff_role_assignments_assigned_by
  ON public.platform_staff_role_assignments(assigned_by);

CREATE INDEX IF NOT EXISTS idx_platform_staff_role_permissions_permission_code
  ON public.platform_staff_role_permissions(permission_code);

CREATE INDEX IF NOT EXISTS idx_platform_staff_roles_created_by
  ON public.platform_staff_roles(created_by);
