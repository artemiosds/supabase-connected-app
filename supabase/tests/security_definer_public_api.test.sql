-- SECURITY DEFINER functions exposed to authenticated are intentional API
-- entry points. Keep their execution grants and authorization boundary pinned.
-- This suite guards against accidentally restoring PUBLIC/anon execution or
-- removing the fixed search_path / actor-scoped authorization checks.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);

SELECT extensions.ok(
  (SELECT count(*) > 0
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'the authenticated SECURITY DEFINER API surface is present'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT (p.proconfig @> ARRAY['search_path=""'])),
  0,
  'every authenticated SECURITY DEFINER function pins an empty search_path'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'no authenticated SECURITY DEFINER function is executable by anon'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL pg_catalog.aclexplode(
     COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
   ) acl
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND acl.grantee = 0
     AND acl.privilege_type = 'EXECUTE'),
  0,
  'no authenticated SECURITY DEFINER function inherits EXECUTE from PUBLIC'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_catalog.pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%'
     AND pg_catalog.pg_get_functiondef(p.oid) NOT ILIKE '%app_auth.%'),
  0,
  'every authenticated SECURITY DEFINER function contains an actor-scoped identity or authorization check'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.get_document_workflow_capabilities(uuid)'::regprocedure
  ) ILIKE '%app_auth.has_tenant_data_permission%'
  AND pg_catalog.pg_get_functiondef(
    'public.get_document_workflow_capabilities(uuid)'::regprocedure
  ) ILIKE '%app_auth.is_tenant_in_good_standing%'
  AND pg_catalog.pg_get_functiondef(
    'public.get_document_workflow_capabilities(uuid)'::regprocedure
  ) ILIKE '%app_auth.is_tenant_module_enabled%',
  'document workflow capabilities are scoped by permission, tenant standing and module availability'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.list_generated_document_workflows(uuid)'::regprocedure
  ) ILIKE '%app_auth.has_tenant_data_permission%'
  AND pg_catalog.pg_get_functiondef(
    'public.list_generated_document_workflows(uuid)'::regprocedure
  ) ILIKE '%app_auth.is_tenant_in_good_standing%'
  AND pg_catalog.pg_get_functiondef(
    'public.list_generated_document_workflows(uuid)'::regprocedure
  ) ILIKE '%app_auth.is_tenant_module_enabled%',
  'document workflow history is scoped by permission, tenant standing and module availability'
);

SELECT * FROM extensions.finish();
ROLLBACK;
