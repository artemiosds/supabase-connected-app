-- Platform support authorization regression tests.
-- Run only against a disposable local Supabase database:
--   supabase start
--   supabase db reset --local
--   supabase test db
-- No live SMS2 users, tenants, or operational records are created here.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(40);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.platform_support_agents') IS NOT NULL,
  'support agents table exists'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.platform_support_assignments') IS NOT NULL,
  'support assignments table exists'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.platform_support_sessions') IS NOT NULL,
  'support sessions table exists'
);

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_support_agents'::regclass),
  'support agents has RLS enabled'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_support_assignments'::regclass),
  'support assignments has RLS enabled'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_support_sessions'::regclass),
  'support sessions has RLS enabled'
);
SELECT extensions.ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_support_agents'::regclass),
  'support agents enforces RLS even for table owners without BYPASSRLS'
);
SELECT extensions.ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_support_assignments'::regclass),
  'support assignments enforces RLS even for table owners without BYPASSRLS'
);
SELECT extensions.ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_support_sessions'::regclass),
  'support sessions enforces RLS even for table owners without BYPASSRLS'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND indexname='ux_platform_support_one_open_session'
      AND indexdef ILIKE '%UNIQUE%'
  ),
  'an actor can have at most one unclosed support session'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.platform_support_agents'::regclass
      AND conname='platform_support_agents_status_check'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%invited%'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%suspended%'
  ),
  'support account lifecycle includes invited, active and suspended states'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.platform_support_sessions'::regclass
      AND conname='platform_support_sessions_actions'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%suppliers:view%'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%suppliers:create%'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%suppliers:update%'
  ),
  'support sessions are restricted to view, create and update actions'
);

SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)') IS NOT NULL,
  'secure support invitation registration RPC exists'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)'::regprocedure),
  'support registration is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon',
    'public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)','EXECUTE'),
  'anonymous users cannot register support accounts'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated','public.list_my_platform_support_tenants()','EXECUTE'),
  'technical accounts cannot read tenant billing and commercial fields'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%email_confirmed_at%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.set_platform_support_agent_status(uuid,text)'::regprocedure),
  'Master cannot activate a technician before email confirmation'
);

SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.activate_my_platform_support_agent()') IS NOT NULL,
  'self-activation RPC exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.activate_my_platform_support_agent()','EXECUTE'),
  'anonymous users cannot activate support accounts'
);
SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.get_my_platform_support_status()') IS NOT NULL,
  'current-user support status RPC exists'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.get_my_platform_support_status()'::regprocedure),
  'support status RPC is hardened with pinned search_path'
);

SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='app_auth.has_active_supplier_support_session(uuid,text)'::regprocedure),
  'support permission helper is hardened with pinned search_path'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%platform_support_assignments%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%can_create_suppliers%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%can_update_suppliers%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='app_auth.has_active_supplier_support_session(uuid,text)'::regprocedure),
  'every support operation rechecks current assignment and individual action flags'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%has_active_supplier_support_session%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%tenant_memberships%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='app_auth.has_supplier_permission(uuid,text)'::regprocedure),
  'supplier authorization preserves municipal memberships and adds scoped sessions'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='suppliers'
      AND policyname='p_suppliers_select'
      AND qual ILIKE '%has_supplier_permission%'
  ),
  'supplier reads require the central tenant permission helper'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='suppliers'
      AND policyname='p_master_support_read_suppliers'
  ),
  'the former unscoped Master supplier read policy is absent'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.suppliers'::regclass
      AND tgname='trg_supplier_support_audit'
      AND NOT tgisinternal
  ),
  'supplier writes through support sessions have an audit trigger'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated','public.platform_support_sessions','INSERT')
    AND NOT has_table_privilege('authenticated','public.platform_support_sessions','UPDATE')
    AND NOT has_table_privilege('authenticated','public.platform_support_sessions','DELETE'),
  'clients cannot mutate support sessions directly outside controlled RPCs'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.tenant_memberships'::regclass
      AND tgname='trg_prevent_support_tenant_membership_overlap'
      AND NOT tgisinternal
  ),
  'support accounts cannot be assigned municipal tenant memberships'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.platform_admins'::regclass
      AND tgname='trg_prevent_support_master_role_overlap'
      AND NOT tgisinternal
  ),
  'support accounts cannot be promoted to platform Master'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.platform_support_agents'::regclass
      AND tgname='trg_prevent_support_agent_role_overlap'
      AND NOT tgisinternal
  ),
  'municipal and Master accounts cannot be enrolled as support technicians'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%platform_support_agents%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.list_tenant_admin_candidates()'::regprocedure),
  'Master candidate list excludes existing support technicians'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.fn_prevent_platform_support_role_overlap()'::regprocedure),
  'role-separation trigger is SECURITY DEFINER with pinned search_path'
);

-- Switch to a synthetic, unrelated authenticated identity. No Auth rows are created.
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
  app_auth.is_platform_admin(),
  false,
  'an unrelated authenticated account is not a platform administrator'
);
SELECT extensions.is(
  (SELECT is_agent FROM public.get_my_platform_support_status()),
  false,
  'an unrelated authenticated account is not a support technician'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.get_my_platform_support_status()),
  1,
  'support status only returns the current authenticated actor'
);
SELECT extensions.is(
  app_auth.has_active_supplier_support_session(
    '00000000-0000-4000-8000-000000000002'::uuid,
    'suppliers:view'
  ),
  false,
  'an account without a session cannot use supplier support permissions'
);
SELECT extensions.is(
  app_auth.has_supplier_permission(
    '00000000-0000-4000-8000-000000000002'::uuid,
    'suppliers:view'
  ),
  false,
  'an account without membership or support assignment cannot read suppliers'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.start_platform_support_session(
    '00000000-0000-4000-8000-000000000002'::uuid,
    'tentativa sem permissão'
  )$$,
  '42501',
  NULL,
  'an unrelated authenticated account cannot start a support session'
);
SELECT extensions.throws_ok(
  $$SELECT public.register_platform_support_agent(
    '00000000-0000-4000-8000-000000000003'::uuid,
    'fake@example.test',
    'Conta Não Autorizada',
    '00000000-0000-4000-8000-000000000002'::uuid,
    true,false,false
  )$$,
  '42501',
  NULL,
  'an unrelated authenticated account cannot invite support technicians'
);

SELECT * FROM extensions.finish();
ROLLBACK;
