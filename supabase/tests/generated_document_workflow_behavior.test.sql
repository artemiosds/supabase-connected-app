-- Behavioral approval workflow regression using synthetic tenant identities only.
-- The transaction rolls back all fixtures and must run on disposable local Supabase.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES
 ('61000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-author@example.invalid','',pg_catalog.now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Synthetic Author"}'::jsonb,pg_catalog.now(),pg_catalog.now()),
 ('61000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-approver@example.invalid','',pg_catalog.now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Synthetic Approver"}'::jsonb,pg_catalog.now(),pg_catalog.now()),
 ('61000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-reader@example.invalid','',pg_catalog.now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Synthetic Reader"}'::jsonb,pg_catalog.now(),pg_catalog.now())
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.profiles(id,full_name) VALUES
 ('61000000-0000-4000-8000-000000000001','Synthetic Author'),
 ('61000000-0000-4000-8000-000000000002','Synthetic Approver'),
 ('61000000-0000-4000-8000-000000000003','Synthetic Reader')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.tenants(id,name,slug,status,created_by,commercial_status,enabled_modules)
VALUES
 ('62000000-0000-4000-8000-000000000001','Synthetic Workflow Tenant A','synthetic-workflow-a','active','61000000-0000-4000-8000-000000000001','active','{"documentos":true}'::jsonb),
 ('62000000-0000-4000-8000-000000000002','Synthetic Workflow Tenant B','synthetic-workflow-b','active','61000000-0000-4000-8000-000000000002','active','{"documentos":true}'::jsonb)
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.permissions(code,name,description,module)
VALUES
 ('documents:view','View documents','Synthetic workflow test','documents'),
 ('documents:create','Create documents','Synthetic workflow test','documents'),
 ('documents:approve','Approve documents','Synthetic workflow test','documents')
ON CONFLICT(code) DO NOTHING;

INSERT INTO public.tenant_roles(id,tenant_id,name,slug,description,is_system)
VALUES
 ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Workflow Author','workflow-author','Test only',false),
 ('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','Workflow Approver','workflow-approver','Test only',false),
 ('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','Workflow Reader','workflow-reader','Test only',false)
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r CROSS JOIN public.permissions p
WHERE (r.id='63000000-0000-4000-8000-000000000001' AND p.code IN ('documents:view','documents:create','documents:approve'))
 OR (r.id='63000000-0000-4000-8000-000000000002' AND p.code IN ('documents:view','documents:approve'))
 OR (r.id='63000000-0000-4000-8000-000000000003' AND p.code='documents:view')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_memberships(id,tenant_id,user_id,status)
VALUES
 ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','active'),
 ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','active'),
 ('64000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','active')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.membership_roles(membership_id,role_id,tenant_id)
VALUES
 ('64000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001'),
 ('64000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001'),
 ('64000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO public.generated_documents(id,tenant_id,title,content_snapshot,status,created_by,updated_by)
VALUES
 ('65000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Workflow approval fixture','Conteúdo completo para aprovação.','draft','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001'),
 ('65000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','Workflow rejection fixture','Conteúdo completo para devolução.','draft','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001'),
 ('65000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','Workflow permission fixture','Conteúdo completo para permissão.','draft','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001'),
 ('65000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000002','Workflow cross-tenant fixture','Conteúdo completo para isolamento.','draft','61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

SELECT extensions.is(
 public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','submit',NULL),
 'pending_approval','author can submit a complete draft for approval'
);
SELECT extensions.throws_ok(
 $test$SELECT public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','approve',NULL)$test$,
 'P0001',NULL,'the author cannot approve their own submission'
);

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.throws_ok(
 $test$SELECT public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','approve',NULL)$test$,
 '42501',NULL,'a reader without approval permission cannot approve'
);
SELECT extensions.throws_ok(
 $test$SELECT public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000003','submit',NULL)$test$,
 '42501',NULL,'a reader without create permission cannot submit'
);

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT extensions.is(
 public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','approve',NULL),
 'approved','a distinct authorized reviewer can approve the submitted document'
);

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.is(
 public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002','submit',NULL),
 'pending_approval','author can submit a second draft for review'
);

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT extensions.throws_ok(
 $test$SELECT public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002','reject','Não')$test$,
 'P0001',NULL,'rejection requires a reason of at least five characters'
);
SELECT extensions.is(
 public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002','reject','Falta documento fiscal.'),
 'rejected','an authorized reviewer can reject with a reason'
);
SELECT extensions.throws_ok(
 $test$SELECT public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002','approve',NULL)$test$,
 'P0001',NULL,'a rejected document cannot be approved without a new submission'
);

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.throws_ok(
 $test$SELECT public.transition_generated_document_workflow('62000000-0000-4000-8000-000000000002','65000000-0000-4000-8000-000000000004','submit',NULL)$test$,
 '42501',NULL,'a tenant user cannot submit a document belonging to another tenant'
);

SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT extensions.is(
 (SELECT count(*)::integer FROM public.generated_document_workflows
  WHERE tenant_id='62000000-0000-4000-8000-000000000001'
    AND ((document_id='65000000-0000-4000-8000-000000000001' AND status='approved')
      OR (document_id='65000000-0000-4000-8000-000000000002' AND status='rejected'))),
 2,'approved and rejected decisions persist with their correct workflow states'
);
SELECT extensions.is(
 (SELECT count(*)::integer FROM public.generated_document_workflow_events
  WHERE tenant_id='62000000-0000-4000-8000-000000000001'
    AND document_id IN ('65000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002')),
 6,'submission and decisions produce a complete immutable event trail'
);

SELECT * FROM extensions.finish();
ROLLBACK;
