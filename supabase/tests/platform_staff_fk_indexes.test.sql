BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_staff_invited_by') IS NOT NULL,
  'staff invitation creator foreign key has a covering index'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_staff_role_assignments_assigned_by') IS NOT NULL,
  'staff role assignment actor foreign key has a covering index'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_staff_role_permissions_permission_code') IS NOT NULL,
  'staff role permission lookup foreign key has a covering index'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_staff_roles_created_by') IS NOT NULL,
  'staff role creator foreign key has a covering index'
);

SELECT * FROM extensions.finish();
ROLLBACK;
