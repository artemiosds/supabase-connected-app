-- Behavioral isolation tests for immutable DOCX source metadata and private Storage.
-- All fixtures are synthetic and rolled back; run only in disposable local Supabase.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('51000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','doc-source-a@example.invalid','',pg_catalog.now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Synthetic DOCX A"}'::jsonb,pg_catalog.now(),pg_catalog.now()),
  ('51000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','doc-source-b@example.invalid','',pg_catalog.now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Synthetic DOCX B"}'::jsonb,pg_catalog.now(),pg_catalog.now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles(id, full_name) VALUES
 ('51000000-0000-4000-8000-000000000001','Synthetic DOCX A'),
 ('51000000-0000-4000-8000-000000000002','Synthetic DOCX B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants(id,name,slug,status,created_by,commercial_status,enabled_modules)
VALUES
 ('52000000-0000-4000-8000-000000000001','Synthetic DOCX Tenant A','synthetic-docx-a','active','51000000-0000-4000-8000-000000000001','active','{"modelos":true}'::jsonb),
 ('52000000-0000-4000-8000-000000000002','Synthetic DOCX Tenant B','synthetic-docx-b','active','51000000-0000-4000-8000-000000000002','active','{"modelos":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.permissions(code,name,description,module)
VALUES
 ('documents:view','View documents','Synthetic DOCX test permission','documents'),
 ('documents:manage_templates','Manage templates','Synthetic DOCX test permission','documents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_roles(id,tenant_id,name,slug,description,is_system)
VALUES
 ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','DOCX A','docx-a','Test only',false),
 ('53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000002','DOCX B','docx-b','Test only',false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r CROSS JOIN public.permissions p
WHERE r.id IN ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002')
 AND p.code IN ('documents:view','documents:manage_templates')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_memberships(id,tenant_id,user_id,status)
VALUES
 ('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','active'),
 ('54000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_roles(membership_id,role_id,tenant_id)
VALUES
 ('54000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001'),
 ('54000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

-- Seed templates; their version-history trigger creates immutable version 1.
INSERT INTO public.document_templates(tenant_id,title,content,created_by,updated_by)
VALUES
 ('52000000-0000-4000-8000-000000000001','Synthetic template A','A source fixture','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001'),
 ('52000000-0000-4000-8000-000000000002','Synthetic template B','B source fixture','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002');

-- Private objects and tenant B source are seeded by the test owner, not production.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
VALUES
 ('gfs-private-documents','52000000-0000-4000-8000-000000000001/template-sources/55000000-0000-4000-8000-000000000001/v1/56000000-0000-4000-8000-000000000001.docx','51000000-0000-4000-8000-000000000001','{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":128}'::jsonb),
 ('gfs-private-documents','52000000-0000-4000-8000-000000000002/template-sources/55000000-0000-4000-8000-000000000002/v1/56000000-0000-4000-8000-000000000002.docx','51000000-0000-4000-8000-000000000002','{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":128}'::jsonb);

INSERT INTO public.document_template_sources(tenant_id,template_id,version,storage_path,file_name,file_size,created_by)
VALUES (
 '52000000-0000-4000-8000-000000000002',
 (SELECT id FROM public.document_templates WHERE tenant_id='52000000-0000-4000-8000-000000000002'),
 1,
 '52000000-0000-4000-8000-000000000002/template-sources/55000000-0000-4000-8000-000000000002/v1/56000000-0000-4000-8000-000000000002.docx',
 'tenant-b.docx',128,'51000000-0000-4000-8000-000000000002'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

SELECT extensions.is(
 (SELECT count(*)::integer FROM public.document_template_sources),0,
 'tenant A cannot read tenant B DOCX source metadata'
);

SELECT extensions.lives_ok(
 $test$INSERT INTO public.document_template_sources(tenant_id,template_id,version,storage_path,file_name,file_size)
 SELECT '52000000-0000-4000-8000-000000000001',t.id,1,
  '52000000-0000-4000-8000-000000000001/template-sources/55000000-0000-4000-8000-000000000001/v1/56000000-0000-4000-8000-000000000001.docx',
  'tenant-a.docx',128
 FROM public.document_templates t WHERE t.tenant_id='52000000-0000-4000-8000-000000000001'$test$,
 'tenant A can attach a private DOCX to its own archived template version'
);

SELECT extensions.is(
 (SELECT count(*)::integer FROM public.document_template_sources
  WHERE tenant_id='52000000-0000-4000-8000-000000000001'),1,
 'tenant A can read its own DOCX source metadata'
);

SELECT extensions.is(
 (SELECT count(*)::integer FROM storage.objects
  WHERE name LIKE '52000000-0000-4000-8000-000000000001/%'),1,
 'tenant A can download its linked private DOCX object'
);

SELECT extensions.is(
 (SELECT count(*)::integer FROM storage.objects
  WHERE name LIKE '52000000-0000-4000-8000-000000000002/%'),0,
 'tenant A cannot download tenant B private DOCX object'
);

SELECT extensions.throws_ok(
 $test$INSERT INTO public.document_template_sources(tenant_id,template_id,version,storage_path,file_name,file_size)
 SELECT '52000000-0000-4000-8000-000000000002',t.id,1,
  '52000000-0000-4000-8000-000000000002/template-sources/55000000-0000-4000-8000-000000000002/v1/56000000-0000-4000-8000-000000000002.docx',
  'cross-tenant.docx',128
 FROM public.document_templates t WHERE t.tenant_id='52000000-0000-4000-8000-000000000002'$test$,
 '42501',NULL,
 'tenant A cannot register a DOCX source against tenant B template'
);

SELECT extensions.ok(
 NOT pg_catalog.has_table_privilege('authenticated','public.document_template_sources','UPDATE')
 AND NOT pg_catalog.has_table_privilege('authenticated','public.document_template_sources','DELETE'),
 'DOCX source metadata is immutable through the authenticated API'
);

SELECT extensions.ok(
 (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
  WHERE oid='public.document_template_sources'::regclass),
 'DOCX source metadata forces row-level security'
);

SELECT * FROM extensions.finish();
ROLLBACK;
