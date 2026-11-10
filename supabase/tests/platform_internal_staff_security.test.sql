-- Platform internal staff RBAC regression tests.
-- Execute only on a disposable local Supabase database:
--   supabase start
--   supabase db reset --local
--   supabase test db
-- This test creates no Auth users, tenants or operational records.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(47);

SELECT extensions.ok(pg_catalog.to_regclass('public.platform_staff') IS NOT NULL,'platform staff identity table exists');
SELECT extensions.ok(pg_catalog.to_regclass('public.platform_staff_roles') IS NOT NULL,'platform staff roles table exists');
SELECT extensions.ok(pg_catalog.to_regclass('public.platform_staff_permissions') IS NOT NULL,'permission catalog exists');
SELECT extensions.ok(pg_catalog.to_regclass('public.platform_staff_role_permissions') IS NOT NULL,'role permission mapping exists');
SELECT extensions.ok(pg_catalog.to_regclass('public.platform_staff_role_assignments') IS NOT NULL,'staff role assignments exist');

SELECT extensions.ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff'::regclass),'staff identity has RLS enabled');
SELECT extensions.ok((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff'::regclass),'staff identity forces RLS');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_roles'::regclass),'staff roles have RLS enabled');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_permissions'::regclass),'permission catalog has RLS enabled');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_role_permissions'::regclass),'role permission map has RLS enabled');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.platform_staff_role_assignments'::regclass),'staff role assignments have RLS enabled');

SELECT extensions.ok(NOT has_table_privilege('authenticated','public.platform_staff','SELECT'),'authenticated users cannot read staff table directly');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.platform_staff','INSERT'),'authenticated users cannot create staff records directly');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.platform_staff_roles','SELECT'),'authenticated users cannot read staff roles directly');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.platform_staff_role_assignments','UPDATE'),'authenticated users cannot edit role assignments directly');

SELECT extensions.ok((SELECT count(*)>=5 FROM public.platform_staff_roles),'five baseline internal profiles are seeded');
SELECT extensions.is((SELECT count(*)::integer FROM public.platform_staff_permissions),7,'only implemented permissions are available in the permission catalog');

SELECT extensions.ok(pg_catalog.to_regprocedure('public.get_my_platform_staff_access()') IS NOT NULL,'current staff access RPC exists');
SELECT extensions.ok(pg_catalog.to_regprocedure('public.register_platform_staff(uuid,text,text,uuid[])') IS NOT NULL,'staff registration RPC exists');
SELECT extensions.ok(
 (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.can_invite_platform_staff(text)'::regprocedure),
 'invitation e-mail preflight is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.ok(
 (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%email_confirmed_at%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.register_platform_staff(uuid,text,text,uuid[])'::regprocedure),
 'registration rejects an already-confirmed Auth account'
);
SELECT extensions.ok(
 (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
  FROM pg_catalog.pg_proc p WHERE p.oid='app_auth.has_platform_staff_permission(text)'::regprocedure),
 'permission check is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.ok(
 (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
  FROM pg_catalog.pg_proc p WHERE p.oid='public.can_manage_platform_staff()'::regprocedure),
 'public staff permission probe is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.ok(
 (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
  FROM pg_catalog.pg_proc p WHERE p.oid='public.can_manage_platform_support_team()'::regprocedure),
 'public support permission probe is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.ok(
 (SELECT count(*)=4 FROM pg_catalog.pg_trigger
  WHERE tgname IN ('trg_prevent_platform_staff_overlap','trg_prevent_staff_membership_overlap',
   'trg_prevent_staff_master_overlap','trg_prevent_staff_support_overlap') AND NOT tgisinternal),
 'four identity-separation triggers protect staff, Master, support and tenant identities'
);
SELECT extensions.ok(
 (SELECT (tgtype & 8)=8 FROM pg_catalog.pg_trigger
  WHERE tgrelid='public.platform_staff'::regclass
    AND tgname='trg_prevent_platform_staff_overlap'),
 'internal staff records cannot be physically deleted'
);
SELECT extensions.ok(
 (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%can_manage_platform_support_team%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)'::regprocedure),
 'internal support managers use an explicit permission gate for technical invitations'
);
SELECT extensions.ok(
 (SELECT pg_catalog.pg_get_functiondef(p.oid) NOT ILIKE '%can_manage_platform_support_team%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.start_platform_support_session(uuid,text)'::regprocedure),
 'internal staff cannot receive the Master-only support session privilege'
);
SELECT extensions.ok(
 (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%dashboard.view%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.save_platform_staff_role(uuid,text,text,text,text[])'::regprocedure),
 'every internal profile must retain the base portal permission'
);
SELECT extensions.ok(
 (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%platform_staff%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.list_tenant_admin_candidates()'::regprocedure),
 'internal identities are excluded from municipal administrator candidates'
);
SELECT extensions.ok(
 (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%platform_staff%'
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.list_platform_support_candidates()'::regprocedure),
 'internal identities are excluded from technical support candidates'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

SELECT extensions.is(app_auth.is_platform_staff(),false,'unregistered identity is not internal staff');
SELECT extensions.is(app_auth.has_platform_staff_permission('clients.view'),false,'unregistered identity has no client permission');
SELECT extensions.is((SELECT is_staff FROM public.get_my_platform_staff_access()),false,'staff access RPC returns no authority for an unrelated identity');
SELECT extensions.is(public.can_manage_platform_staff(),false,'unrelated identity cannot manage internal staff');
SELECT extensions.is(app_auth.can_manage_platform_support_team(),false,'unrelated identity cannot manage technical support');

SELECT extensions.is((SELECT count(*)::integer FROM public.list_platform_staff()),0,'non-Master cannot list internal staff');
SELECT extensions.is((SELECT count(*)::integer FROM public.list_platform_staff_roles()),0,'non-Master cannot list staff role configuration');
SELECT extensions.throws_ok($$SELECT * FROM public.list_platform_staff_tenants()$$,'42501',NULL,'identity without staff permission cannot list clients');
SELECT extensions.throws_ok($$SELECT public.get_platform_staff_metrics()$$,'42501',NULL,'identity without metrics permission cannot read metrics');
SELECT extensions.throws_ok($$SELECT * FROM public.list_platform_staff_audit_events(100)$$,'42501',NULL,'identity without audit permission cannot read audit events');
SELECT extensions.throws_ok(
 $$SELECT public.can_invite_platform_staff('person@example.test')$$,
 '42501',NULL,'non-Master cannot test invitation e-mail availability'
);
SELECT extensions.ok(
 (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
  FROM pg_catalog.pg_proc p WHERE p.oid='public.can_invite_platform_staff(text)'::regprocedure),
 'invitation e-mail preflight is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.throws_ok(
 $$SELECT public.register_platform_staff('00000000-0000-4000-8000-000000000012'::uuid,'person@example.test','Pessoa Teste',ARRAY['00000000-0000-4000-8000-000000000013'::uuid])$$,
 '42501',NULL,'non-Master cannot invite staff'
);
SELECT extensions.throws_ok(
 $$SELECT public.set_platform_staff_status('00000000-0000-4000-8000-000000000012'::uuid,'suspended')$$,
 '42501',NULL,'non-Master cannot suspend staff'
);
SELECT extensions.throws_ok(
 $$SELECT public.set_platform_staff_roles('00000000-0000-4000-8000-000000000012'::uuid,ARRAY['00000000-0000-4000-8000-000000000013'::uuid])$$,
 '42501',NULL,'non-Master cannot change staff profiles'
);
SELECT extensions.throws_ok(
 $$SELECT public.save_platform_staff_role(NULL,'teste','Teste','Perfil de teste',ARRAY['dashboard.view'])$$,
 '42501',NULL,'non-Master cannot edit the permission matrix'
);

SELECT * FROM extensions.finish();
ROLLBACK;
