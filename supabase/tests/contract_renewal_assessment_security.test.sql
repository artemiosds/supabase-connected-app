-- Segurança, isolamento por Secretaria e bloqueio de geração da renovação contínua.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(28);

SELECT extensions.ok(
  to_regclass('public.contract_renewal_assessments') IS NOT NULL,
  'the renewal assessment table exists'
);

SELECT extensions.ok(
  to_regclass('public.contract_renewal_checklist_items') IS NOT NULL,
  'the assigned renewal checklist table exists'
);

SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.contract_renewal_assessments'::regclass),
  'renewal assessments enforce row-level security'
);

SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.contract_renewal_checklist_items'::regclass),
  'renewal checklist items enforce row-level security'
);

SELECT extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.contract_renewal_assessments', 'SELECT')
  AND pg_catalog.has_table_privilege('authenticated', 'public.contract_renewal_checklist_items', 'SELECT'),
  'authenticated users can read renewal data through tenant-scoped policies'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.contract_renewal_assessments', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.contract_renewal_assessments', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.contract_renewal_checklist_items', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.contract_renewal_checklist_items', 'UPDATE'),
  'authenticated users cannot bypass the renewal write RPCs'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_renewal_assessments'
      AND policyname = 'contract_renewal_assessments_select'
      AND cmd = 'SELECT'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_renewal_checklist_items'
      AND policyname = 'contract_renewal_checklist_select'
      AND cmd = 'SELECT'
  ),
  'both renewal tables have explicit tenant-scoped read policies'
);

SELECT extensions.ok(
  (
    SELECT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.save_contract_renewal_assessment(uuid,uuid,jsonb)'::regprocedure
  ),
  'assessment writes use a restricted SECURITY DEFINER RPC with an empty search_path'
);

SELECT extensions.ok(
  (
    SELECT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.save_contract_renewal_checklist_item(uuid,uuid,text,uuid,date,text,text,text)'::regprocedure
  ),
  'checklist updates use a restricted SECURITY DEFINER RPC with an empty search_path'
);

SELECT extensions.ok(
  (
    SELECT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.validate_contract_renewal_addendum(uuid,uuid)'::regprocedure
  ),
  'renewal validation is actor-scoped and cannot be called by anon or PUBLIC'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.validate_contract_renewal_addendum(uuid,uuid)'::regprocedure
  ) ILIKE '%app_auth.has_tenant_data_permission%'
  AND pg_catalog.pg_get_functiondef(
    'public.validate_contract_renewal_addendum(uuid,uuid)'::regprocedure
  ) ILIKE '%app_auth.is_tenant_in_good_standing%'
  AND pg_catalog.pg_get_functiondef(
    'public.validate_contract_renewal_addendum(uuid,uuid)'::regprocedure
  ) ILIKE '%app_auth.is_tenant_module_enabled%'
  AND pg_catalog.pg_get_functiondef(
    'public.validate_contract_renewal_addendum(uuid,uuid)'::regprocedure
  ) ILIKE '%CURRENT_DATE%',
  'server validation checks permission, tenant standing, module access and contract dates'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.generated_documents'::regclass
      AND t.tgname = 'trg_guard_generated_documents_renewal_addendum'
      AND NOT t.tgisinternal
      AND t.tgfoid = 'public.fn_guard_contract_renewal_addendum()'::regprocedure
  )
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%validate_contract_renewal_addendum%',
  'document insertion is blocked by the authoritative server-side renewal validator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.contract_renewal_assessments'::regclass
      AND t.tgname = 'trg_seed_contract_renewal_checklist'
      AND NOT t.tgisinternal
  ),
  'creating an assessment initializes the assigned documentary checklist'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.generated_documents'::regclass
      AND t.tgname = 'trg_guard_generated_documents_renewal_addendum'
      AND NOT t.tgisinternal
      AND pg_catalog.pg_get_triggerdef(t.oid) ILIKE '%variables_snapshot%'
      AND pg_catalog.pg_get_triggerdef(t.oid) ILIKE '%content_snapshot%'
      AND pg_catalog.pg_get_triggerdef(t.oid) ILIKE '%process_id%'
  ),
  'the server revalidates renewal draft content and relationship edits, not only initial insertion'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%OLD.document_type%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%template_type = ''term_addendum_renewal''%',
  'the server prevents renewal drafts from being reclassified and prevents using the renewal template as a generic document'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_guard_contract_renewal_addendum'
      AND p.prosecdef
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%app_auth.has_tenant_data_permission%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%auth.uid()%'
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'the trigger uses a locked-down SECURITY DEFINER function and rechecks tenant permissions before reading template metadata'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%app_auth.is_platform_admin()%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%auth.role()%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%service_role%',
  'the trigger preserves trusted platform-admin and service-role handling for ordinary documents'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%content_snapshot%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%position%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%variables_schema%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%required%',
  'the server blocks unresolved placeholders and missing required template variables'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'contract_renewal_checklist_assignee_due_idx'
  ),
  'assigned renewal tasks have a tenant and due-date index'
);

-- Synthetic tenants and users prove that the new RLS policies isolate
-- assessment and checklist rows, not only that the policies exist.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('61000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','renewal-a@example.invalid','',pg_catalog.now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Renewal Tenant A"}'::jsonb,pg_catalog.now(),pg_catalog.now()),
  ('61000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','renewal-b@example.invalid','',pg_catalog.now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{"full_name":"Renewal Tenant B"}'::jsonb,pg_catalog.now(),pg_catalog.now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles(id, full_name) VALUES
  ('61000000-0000-4000-8000-000000000001','Renewal Tenant A'),
  ('61000000-0000-4000-8000-000000000002','Renewal Tenant B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants(id,name,slug,status,created_by,commercial_status,enabled_modules)
VALUES
  ('62000000-0000-4000-8000-000000000001','Renewal Tenant A','renewal-tenant-a','active',
   '61000000-0000-4000-8000-000000000001','active',
   '{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":true,"auditoria":true}'::jsonb),
  ('62000000-0000-4000-8000-000000000002','Renewal Tenant B','renewal-tenant-b','active',
   '61000000-0000-4000-8000-000000000002','active',
   '{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":true,"auditoria":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.permissions(code,name,description,module)
VALUES
  ('documents:view','View documents','Renewal RLS test permission','documents'),
  ('documents:update','Update documents','Renewal RLS test permission','documents'),
  ('documents:create','Create documents','Renewal RLS test permission','documents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_roles(id,tenant_id,name,slug,description,is_system)
VALUES
  ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Renewal A','renewal-a','Test only',false),
  ('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','Renewal B','renewal-b','Test only',false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM public.tenant_roles r
CROSS JOIN public.permissions p
WHERE r.id IN (
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000002'
)
AND p.code IN ('documents:view','documents:update','documents:create')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_memberships(id,tenant_id,user_id,status)
VALUES
  ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','active'),
  ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_roles(membership_id,role_id,tenant_id)
VALUES
  ('64000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001'),
  ('64000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

INSERT INTO public.contracts (
  id, tenant_id, number, object, start_date, end_date, status,
  instrument_type, total_value, manager_user_id, inspector_user_id,
  created_by, updated_by
) VALUES (
  '65000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  'REN-A-001','Synthetic continuous service A',
  CURRENT_DATE - 365,CURRENT_DATE + 60,'vigente','contrato',1000,
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001'
);

INSERT INTO public.contract_renewal_assessments (
  tenant_id, contract_id, legal_regime, contract_nature, created_by, updated_by
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001',
  'lei_14133','continuous_service',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001'
);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

INSERT INTO public.contracts (
  id, tenant_id, number, object, start_date, end_date, status,
  instrument_type, total_value, manager_user_id, inspector_user_id,
  created_by, updated_by
) VALUES (
  '65000000-0000-4000-8000-000000000002',
  '62000000-0000-4000-8000-000000000002',
  'REN-B-001','Synthetic continuous service B',
  CURRENT_DATE - 365,CURRENT_DATE + 60,'vigente','contrato',2000,
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002'
);

INSERT INTO public.contract_renewal_assessments (
  tenant_id, contract_id, legal_regime, contract_nature, created_by, updated_by
) VALUES (
  '62000000-0000-4000-8000-000000000002',
  '65000000-0000-4000-8000-000000000002',
  'lei_14133','continuous_service',
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_assessments),1,
  'tenant A reads its own renewal assessment only'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_assessments
   WHERE tenant_id='62000000-0000-4000-8000-000000000002'),0,
  'tenant A cannot read tenant B renewal assessment'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_checklist_items),11,
  'tenant A reads its own eleven checklist items'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_checklist_items
   WHERE tenant_id='62000000-0000-4000-8000-000000000002'),0,
  'tenant A cannot read tenant B checklist items'
);

SELECT extensions.ok(
  (
    SELECT NOT v.can_generate AND cardinality(v.blockers) > 0
    FROM public.validate_contract_renewal_addendum(
      '62000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001'
    ) v
  ),
  'the server validator blocks a draft while legal evidence and required checklist items are pending'
);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_assessments),1,
  'tenant B reads its own renewal assessment only'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_assessments
   WHERE tenant_id='62000000-0000-4000-8000-000000000001'),0,
  'tenant B cannot read tenant A renewal assessment'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_checklist_items),11,
  'tenant B reads its own eleven checklist items'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.contract_renewal_checklist_items
   WHERE tenant_id='62000000-0000-4000-8000-000000000001'),0,
  'tenant B cannot read tenant A checklist items'
);

RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
