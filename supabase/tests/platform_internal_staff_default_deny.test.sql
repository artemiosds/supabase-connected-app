-- Explicit deny policies and support FK index regression tests.
-- Run only on the disposable local Supabase database through "supabase test db".
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff'::regclass),
  'platform_staff keeps RLS and FORCE RLS'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_roles'::regclass),
  'platform_staff_roles keeps RLS and FORCE RLS'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_permissions'::regclass),
  'platform_staff_permissions keeps RLS and FORCE RLS'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_role_permissions'::regclass),
  'platform_staff_role_permissions keeps RLS and FORCE RLS'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_role_assignments'::regclass),
  'platform_staff_role_assignments keeps RLS and FORCE RLS'
);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid='public.platform_staff'::regclass AND polname='p_platform_staff_default_deny'
      AND polcmd='*' AND pg_catalog.pg_get_expr(polqual,polrelid)='false'
      AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='false'),
  'platform_staff has explicit deny-all policy for API roles'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid='public.platform_staff_roles'::regclass AND polname='p_platform_staff_roles_default_deny'
      AND polcmd='*' AND pg_catalog.pg_get_expr(polqual,polrelid)='false'
      AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='false'),
  'platform_staff_roles has explicit deny-all policy for API roles'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid='public.platform_staff_permissions'::regclass AND polname='p_platform_staff_permissions_default_deny'
      AND polcmd='*' AND pg_catalog.pg_get_expr(polqual,polrelid)='false'
      AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='false'),
  'platform_staff_permissions has explicit deny-all policy for API roles'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid='public.platform_staff_role_permissions'::regclass AND polname='p_platform_staff_role_permissions_default_deny'
      AND polcmd='*' AND pg_catalog.pg_get_expr(polqual,polrelid)='false'
      AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='false'),
  'platform_staff_role_permissions has explicit deny-all policy for API roles'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid='public.platform_staff_role_assignments'::regclass AND polname='p_platform_staff_role_assignments_default_deny'
      AND polcmd='*' AND pg_catalog.pg_get_expr(polqual,polrelid)='false'
      AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='false'),
  'platform_staff_role_assignments has explicit deny-all policy for API roles'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon','public.platform_staff','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.platform_staff','SELECT,INSERT,UPDATE,DELETE'),
  'public.platform_staff remains inaccessible through direct API grants'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.platform_staff_roles','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.platform_staff_roles','SELECT,INSERT,UPDATE,DELETE'),
  'public.platform_staff_roles remains inaccessible through direct API grants'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.platform_staff_permissions','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.platform_staff_permissions','SELECT,INSERT,UPDATE,DELETE'),
  'public.platform_staff_permissions remains inaccessible through direct API grants'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.platform_staff_role_permissions','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.platform_staff_role_permissions','SELECT,INSERT,UPDATE,DELETE'),
  'public.platform_staff_role_permissions remains inaccessible through direct API grants'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.platform_staff_role_assignments','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.platform_staff_role_assignments','SELECT,INSERT,UPDATE,DELETE'),
  'public.platform_staff_role_assignments remains inaccessible through direct API grants'
);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_support_agents_created_by') IS NOT NULL,
  'support agent created_by foreign key has a covering index'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_support_assignments_created_by') IS NOT NULL,
  'support assignment created_by foreign key has a covering index'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_platform_support_sessions_ended_by') IS NOT NULL,
  'support session ended_by foreign key has a covering index'
);

SELECT * FROM extensions.finish();
ROLLBACK;
