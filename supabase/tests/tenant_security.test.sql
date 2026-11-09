-- Multitenant security regression tests.
-- Run only against a disposable local Supabase stack:
--   supabase start
--   supabase test db
-- No production rows or Auth users are created by this test file.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(24);

-- 1. Public application tables must all have RLS enabled.
SELECT extensions.ok(
  (SELECT count(*) > 0 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'),
  'public schema contains application tables'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity),
  (SELECT count(*)::integer FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'),
  'every public table has row level security enabled'
);

-- 2. Every table carrying tenant_id must be protected by RLS and have a policy.
SELECT extensions.ok(
  (SELECT count(*) > 0
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attname = 'tenant_id' AND NOT a.attisdropped),
  'tenant-scoped tables exist'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attname = 'tenant_id' AND NOT a.attisdropped
     AND c.relrowsecurity),
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attname = 'tenant_id' AND NOT a.attisdropped),
  'every tenant-scoped table has RLS enabled'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attname = 'tenant_id' AND NOT a.attisdropped
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_policies p
       WHERE p.schemaname = n.nspname AND p.tablename = c.relname
     )),
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attname = 'tenant_id' AND NOT a.attisdropped),
  'every tenant-scoped table has at least one RLS policy'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_policies p
   JOIN pg_catalog.pg_class c ON c.relname = p.tablename
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE p.schemaname = 'public' AND n.nspname = 'public'
     AND c.relkind = 'r' AND a.attname = 'tenant_id' AND NOT a.attisdropped
     AND p.roles && ARRAY['anon'::name, 'public'::name]),
  0,
  'tenant-scoped RLS policies never target anon or PUBLIC'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_policies p
   JOIN pg_catalog.pg_class c ON c.relname = p.tablename
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE p.schemaname = 'public' AND n.nspname = 'public'
     AND c.relkind = 'r' AND a.attname = 'tenant_id' AND NOT a.attisdropped
     AND (coalesce(p.qual, '') ~* '^[[:space:]]*\\(?[[:space:]]*true[[:space:]]*\\)?[[:space:]]*
       OR coalesce(p.with_check, '') ~* '^\\s*\\(?\\s*true\\s*\\)?\\s*$')),
  0,
  'tenant-scoped policies do not use unconditional TRUE predicates'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'),
  0,
  'anon has no direct table privileges in public'
);

-- 3. Private authorization schema and SECURITY DEFINER function hardening.
SELECT extensions.ok(
  NOT has_schema_privilege('anon', 'app_auth', 'USAGE'),
  'anon cannot access the private authorization schema'
);

SELECT extensions.ok(
  has_schema_privilege('authenticated', 'app_auth', 'USAGE'),
  'authenticated can call internal authorization helpers through policies'
);

SELECT extensions.ok(
  (SELECT count(*) > 0 AND bool_and(coalesce(proconfig::text, '') LIKE '%search_path=%')
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_auth' AND p.prosecdef),
  'all SECURITY DEFINER helpers in app_auth pin search_path'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_auth' AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon cannot execute SECURITY DEFINER authorization helpers'
);

-- 4. Private GED bucket and its tenant-aware policies.
SELECT extensions.is(
  (SELECT count(*)::integer FROM storage.buckets
   WHERE id = 'gfs-private-documents' AND public = false),
  1,
  'GED bucket exists and is private'
);

SELECT extensions.ok(
  (SELECT c.relrowsecurity
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'),
  'Storage objects table has RLS enabled'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'gfs_private_supplier_documents_read',
       'gfs_private_supplier_documents_upload',
       'gfs_private_supplier_documents_orphan_read',
       'gfs_private_supplier_documents_orphan_delete'
     )),
  4,
  'all four GED access policies are installed'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'gfs_private_supplier_documents%'
     AND roles <> ARRAY['authenticated'::name]),
  0,
  'GED policies apply only to authenticated users'
);

SELECT extensions.ok(
  (SELECT coalesce(qual, '') LIKE '%supplier_documents%'
          AND coalesce(qual, '') LIKE '%status%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_supplier_documents_read'),
  'GED download requires an active document record matching the object path'
);

SELECT extensions.ok(
  (SELECT coalesce(with_check, '') LIKE '%suppliers%'
          AND coalesce(with_check, '') LIKE '%tenant_id%'
          AND coalesce(with_check, '') LIKE '%has_tenant_data_permission%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_supplier_documents_upload'),
  'GED upload validates supplier ownership and tenant permissions'
);

-- 5. Negative authorization checks using a non-existent, non-admin identity.
-- These assertions do not create users, tenants, memberships, or application rows.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.is(
  (SELECT app_auth.is_platform_admin()),
  false,
  'an unrelated authenticated user is not a platform administrator'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_member('00000000-0000-4000-8000-000000000002'::uuid)),
  false,
  'a user without membership is not a tenant member'
);

SELECT extensions.is(
  (SELECT app_auth.has_tenant_permission('00000000-0000-4000-8000-000000000002'::uuid, 'users:view')),
  false,
  'a user without membership has no tenant role permissions'
);

SELECT extensions.is(
  (SELECT app_auth.has_tenant_data_permission('00000000-0000-4000-8000-000000000002'::uuid, 'documents:view')),
  false,
  'a user without membership has no tenant data permissions'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_in_good_standing('00000000-0000-4000-8000-000000000002'::uuid)),
  false,
  'a non-member cannot pass tenant commercial standing checks'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_module_enabled('00000000-0000-4000-8000-000000000002'::uuid, 'documentos')),
  false,
  'a non-member cannot pass tenant module checks'
);

SELECT * FROM extensions.finish();
ROLLBACK;

       OR coalesce(p.with_check, '') ~* '^[[:space:]]*\\(?[[:space:]]*true[[:space:]]*\\)?[[:space:]]*)),
  0,
  'tenant-scoped policies do not use unconditional TRUE predicates'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'),
  0,
  'anon has no direct table privileges in public'
);

-- 3. Private authorization schema and SECURITY DEFINER function hardening.
SELECT extensions.ok(
  NOT has_schema_privilege('anon', 'app_auth', 'USAGE'),
  'anon cannot access the private authorization schema'
);

SELECT extensions.ok(
  has_schema_privilege('authenticated', 'app_auth', 'USAGE'),
  'authenticated can call internal authorization helpers through policies'
);

SELECT extensions.ok(
  (SELECT count(*) > 0 AND bool_and(coalesce(proconfig::text, '') LIKE '%search_path=%')
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_auth' AND p.prosecdef),
  'all SECURITY DEFINER helpers in app_auth pin search_path'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_auth' AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon cannot execute SECURITY DEFINER authorization helpers'
);

-- 4. Private GED bucket and its tenant-aware policies.
SELECT extensions.is(
  (SELECT count(*)::integer FROM storage.buckets
   WHERE id = 'gfs-private-documents' AND public = false),
  1,
  'GED bucket exists and is private'
);

SELECT extensions.ok(
  (SELECT c.relrowsecurity
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'),
  'Storage objects table has RLS enabled'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'gfs_private_supplier_documents_read',
       'gfs_private_supplier_documents_upload',
       'gfs_private_supplier_documents_orphan_read',
       'gfs_private_supplier_documents_orphan_delete'
     )),
  4,
  'all four GED access policies are installed'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'gfs_private_supplier_documents%'
     AND roles <> ARRAY['authenticated'::name]),
  0,
  'GED policies apply only to authenticated users'
);

SELECT extensions.ok(
  (SELECT coalesce(qual, '') LIKE '%supplier_documents%'
          AND coalesce(qual, '') LIKE '%status%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_supplier_documents_read'),
  'GED download requires an active document record matching the object path'
);

SELECT extensions.ok(
  (SELECT coalesce(with_check, '') LIKE '%suppliers%'
          AND coalesce(with_check, '') LIKE '%tenant_id%'
          AND coalesce(with_check, '') LIKE '%has_tenant_data_permission%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_supplier_documents_upload'),
  'GED upload validates supplier ownership and tenant permissions'
);

-- 5. Negative authorization checks using a non-existent, non-admin identity.
-- These assertions do not create users, tenants, memberships, or application rows.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.is(
  (SELECT app_auth.is_platform_admin()),
  false,
  'an unrelated authenticated user is not a platform administrator'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_member('00000000-0000-4000-8000-000000000002'::uuid)),
  false,
  'a user without membership is not a tenant member'
);

SELECT extensions.is(
  (SELECT app_auth.has_tenant_permission('00000000-0000-4000-8000-000000000002'::uuid, 'users:view')),
  false,
  'a user without membership has no tenant role permissions'
);

SELECT extensions.is(
  (SELECT app_auth.has_tenant_data_permission('00000000-0000-4000-8000-000000000002'::uuid, 'documents:view')),
  false,
  'a user without membership has no tenant data permissions'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_in_good_standing('00000000-0000-4000-8000-000000000002'::uuid)),
  false,
  'a non-member cannot pass tenant commercial standing checks'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_module_enabled('00000000-0000-4000-8000-000000000002'::uuid, 'documentos')),
  false,
  'a non-member cannot pass tenant module checks'
);

SELECT * FROM extensions.finish();
ROLLBACK;
)),
  0,
  'tenant-scoped policies do not use unconditional TRUE predicates'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'),
  0,
  'anon has no direct table privileges in public'
);

-- 3. Private authorization schema and SECURITY DEFINER function hardening.
SELECT extensions.ok(
  NOT has_schema_privilege('anon', 'app_auth', 'USAGE'),
  'anon cannot access the private authorization schema'
);

SELECT extensions.ok(
  has_schema_privilege('authenticated', 'app_auth', 'USAGE'),
  'authenticated can call internal authorization helpers through policies'
);

SELECT extensions.ok(
  (SELECT count(*) > 0 AND bool_and(coalesce(proconfig::text, '') LIKE '%search_path=%')
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_auth' AND p.prosecdef),
  'all SECURITY DEFINER helpers in app_auth pin search_path'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_auth' AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon cannot execute SECURITY DEFINER authorization helpers'
);

-- 4. Private GED bucket and its tenant-aware policies.
SELECT extensions.is(
  (SELECT count(*)::integer FROM storage.buckets
   WHERE id = 'gfs-private-documents' AND public = false),
  1,
  'GED bucket exists and is private'
);

SELECT extensions.ok(
  (SELECT c.relrowsecurity
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'),
  'Storage objects table has RLS enabled'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'gfs_private_supplier_documents_read',
       'gfs_private_supplier_documents_upload',
       'gfs_private_supplier_documents_orphan_read',
       'gfs_private_supplier_documents_orphan_delete'
     )),
  4,
  'all four GED access policies are installed'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'gfs_private_supplier_documents%'
     AND roles <> ARRAY['authenticated'::name]),
  0,
  'GED policies apply only to authenticated users'
);

SELECT extensions.ok(
  (SELECT coalesce(qual, '') LIKE '%supplier_documents%'
          AND coalesce(qual, '') LIKE '%status%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_supplier_documents_read'),
  'GED download requires an active document record matching the object path'
);

SELECT extensions.ok(
  (SELECT coalesce(with_check, '') LIKE '%suppliers%'
          AND coalesce(with_check, '') LIKE '%tenant_id%'
          AND coalesce(with_check, '') LIKE '%has_tenant_data_permission%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_supplier_documents_upload'),
  'GED upload validates supplier ownership and tenant permissions'
);

-- 5. Negative authorization checks using a non-existent, non-admin identity.
-- These assertions do not create users, tenants, memberships, or application rows.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.is(
  (SELECT app_auth.is_platform_admin()),
  false,
  'an unrelated authenticated user is not a platform administrator'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_member('00000000-0000-4000-8000-000000000002'::uuid)),
  false,
  'a user without membership is not a tenant member'
);

SELECT extensions.is(
  (SELECT app_auth.has_tenant_permission('00000000-0000-4000-8000-000000000002'::uuid, 'users:view')),
  false,
  'a user without membership has no tenant role permissions'
);

SELECT extensions.is(
  (SELECT app_auth.has_tenant_data_permission('00000000-0000-4000-8000-000000000002'::uuid, 'documents:view')),
  false,
  'a user without membership has no tenant data permissions'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_in_good_standing('00000000-0000-4000-8000-000000000002'::uuid)),
  false,
  'a non-member cannot pass tenant commercial standing checks'
);

SELECT extensions.is(
  (SELECT app_auth.is_tenant_module_enabled('00000000-0000-4000-8000-000000000002'::uuid, 'documentos')),
  false,
  'a non-member cannot pass tenant module checks'
);

SELECT * FROM extensions.finish();
ROLLBACK;
