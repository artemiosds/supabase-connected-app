BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

SELECT extensions.has_table(
  'public',
  'tenant_document_branding',
  'each Secretaria has an optional document letterhead settings record'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class
   WHERE oid = 'public.tenant_document_branding'::regclass),
  'letterhead settings enforce row-level security'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'tenant_document_branding'),
  3,
  'letterhead settings have explicit select, insert and update policies'
);
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.tenant_document_branding', 'DELETE'),
  'authenticated users cannot physically delete letterhead settings'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_constraintdef(oid) LIKE '%logo_mime IS NOT NULL%'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%logo_file_size IS NOT NULL%'
   FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.tenant_document_branding'::regclass
     AND conname = 'tenant_document_branding_logo_metadata_check'),
  'a stored logo must include a verified MIME type and file size'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.tenant_document_branding'::regclass
      AND tgname = 'trg_tenant_document_branding_protect'
      AND NOT tgisinternal
  ),
  'tenant identity and update metadata are protected by a trigger'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.tenant_document_branding'::regclass
      AND tgname = 'trg_tenant_document_branding_audit'
      AND NOT tgisinternal
  ),
  'letterhead changes are audited'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.fn_audit_tenant_document_branding()'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.fn_audit_tenant_document_branding()',
    'EXECUTE'
  ),
  'audit trigger uses a fixed search path and cannot be called directly'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'gfs_tenant_document_branding_upload',
       'gfs_tenant_document_branding_read',
       'gfs_tenant_document_branding_orphan_delete'
     )),
  3,
  'private logo storage has upload, linked read and orphan cleanup policies'
);

SELECT * FROM extensions.finish();
ROLLBACK;
