BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);

SELECT extensions.has_table('public', 'document_template_sources', 'private model sources have a metadata table');
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_template_sources'::regclass),
  'source metadata is RLS protected'
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

SELECT * FROM extensions.finish();
ROLLBACK;
