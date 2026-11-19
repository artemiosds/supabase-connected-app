-- Segurança, isolamento por Secretaria e bloqueio de geração da renovação contínua.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

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
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%content_snapshot%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_renewal_addendum()'::regprocedure
  ) ILIKE '%position%',
  'the server refuses to save renewal drafts with unresolved template placeholders'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'contract_renewal_checklist_assignee_due_idx'
  ),
  'assigned renewal tasks have a tenant and due-date index'
);

SELECT * FROM extensions.finish();
ROLLBACK;
