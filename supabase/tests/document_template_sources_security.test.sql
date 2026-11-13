BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.has_table('public', 'document_template_sources', 'private model sources have a metadata table');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class
   WHERE oid = 'public.document_template_sources'::regclass),
  'source metadata forces row-level security'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'document_template_sources'
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')),
  0,
  'model sources cannot be modified or deleted by authenticated users'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.document_template_sources', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.document_template_sources', 'DELETE'),
  'the API cannot update or delete source metadata'
);
SELECT extensions.ok(
  (SELECT count(*) = 4 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'gfs_private_template_sources_%'),
  'private Storage has upload, linked read and orphan cleanup policies'
);
SELECT extensions.ok(
  (SELECT count(*) = 2 AND bool_and(qual LIKE '%owner_id%')
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'gfs_private_template_sources_orphan_read',
       'gfs_private_template_sources_orphan_delete'
     )),
  'orphan cleanup policies use the supported owner_id column'
);

SELECT extensions.ok(
  (SELECT qual LIKE '%[89ab][0-9a-f]{3}-[0-9a-f]{12}%'
      AND qual NOT LIKE '%[89ab][0-9a-f]{3}-[89ab][0-9a-f]{12}%'
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'gfs_private_template_sources_orphan_delete'),
  'orphan deletion validates a canonical UUID path'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='document_template_sources'
      AND policyname='document_template_sources_select'
      AND cmd='SELECT'
  ),
  'private source metadata has an explicit tenant-scoped read policy'
);

SELECT extensions.ok(
  (SELECT
     qual LIKE '%has_tenant_data_permission%'
     AND qual LIKE '%documents:view%'
     AND qual LIKE '%is_tenant_in_good_standing%'
     AND qual LIKE '%is_tenant_module_enabled%'
   FROM pg_catalog.pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname='gfs_private_template_sources_read'
     AND cmd='SELECT'),
  'linked DOCX downloads require tenant view permission, commercial standing and module access'
);

SELECT extensions.ok(
  (SELECT
     with_check LIKE '%documents:manage_templates%'
     AND with_check LIKE '%document_templates%'
     AND with_check LIKE '%tenant_id%'
     AND with_check LIKE '%version%'
   FROM pg_catalog.pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname='gfs_private_template_sources_upload'
     AND cmd='INSERT'),
  'DOCX uploads are restricted to a tenant-managed template and its exact version path'
);

SELECT * FROM extensions.finish();
ROLLBACK;
