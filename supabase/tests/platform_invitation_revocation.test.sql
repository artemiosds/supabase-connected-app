-- Pending staff/support invitation revocation regression tests.
-- Run only on a disposable local Supabase database:
--   supabase start
--   supabase db reset --local
--   supabase test db
-- No Auth user or production row is created.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_constraintdef(oid) ILIKE '%revoked%'
   FROM pg_catalog.pg_constraint
   WHERE conrelid='public.platform_staff'::regclass
     AND conname='platform_staff_status_check'),
  'internal staff status accepts the revoked terminal state'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_constraintdef(oid) ILIKE '%revoked%'
   FROM pg_catalog.pg_constraint
   WHERE conrelid='public.platform_support_agents'::regclass
     AND conname='platform_support_agents_status_check'),
  'technical support status accepts the revoked terminal state'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_constraintdef(oid) ILIKE '%revoked%'
   FROM pg_catalog.pg_constraint
   WHERE conrelid='public.platform_staff'::regclass
     AND conname='platform_staff_activation_consistency'),
  'revoked internal invitations remain unactivated'
);

SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.activate_my_platform_staff()'::regprocedure)
    ILIKE '%v_status IN (''suspended'',''revoked'')%'),
  'a revoked internal invitation cannot self-activate'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.activate_my_platform_support_agent()'::regprocedure)
    ILIKE '%v_status IN (''suspended'',''revoked'')%'),
  'a revoked support invitation cannot self-activate'
);

SELECT extensions.ok(
  (SELECT prosecdef AND COALESCE(array_to_string(proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc
   WHERE oid='public.revoke_platform_staff_invitation(uuid)'::regprocedure),
  'internal invitation revocation is a hardened SECURITY DEFINER RPC'
);
SELECT extensions.ok(
  (SELECT prosecdef AND COALESCE(array_to_string(proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc
   WHERE oid='public.revoke_platform_support_invitation(uuid)'::regprocedure),
  'technical support invitation revocation is a hardened SECURITY DEFINER RPC'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.revoke_platform_staff_invitation(uuid)'::regprocedure)
    ILIKE '%app_auth.is_platform_admin()%'
    AND pg_catalog.pg_get_functiondef('public.revoke_platform_staff_invitation(uuid)'::regprocedure)
    ILIKE '%status <> ''invited''%'),
  'only the Master can revoke a still-pending internal invitation'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.revoke_platform_support_invitation(uuid)'::regprocedure)
    ILIKE '%app_auth.can_manage_platform_support_team()%'
    AND pg_catalog.pg_get_functiondef('public.revoke_platform_support_invitation(uuid)'::regprocedure)
    ILIKE '%status <> ''invited''%'),
  'only authorized support managers can revoke a still-pending support invitation'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.revoke_platform_support_invitation(uuid)'::regprocedure)
    ILIKE '%UPDATE public.platform_support_assignments%'
    AND pg_catalog.pg_get_functiondef('public.revoke_platform_support_invitation(uuid)'::regprocedure)
    ILIKE '%is_active=false%'),
  'revoking a support invitation disables any assignments'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.revoke_platform_staff_invitation(uuid)'::regprocedure)
    ILIKE '%auth_identity_preserved%'),
  'internal invitation revocation preserves the Auth identity'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.revoke_platform_support_invitation(uuid)'::regprocedure)
    ILIKE '%auth_identity_preserved%'),
  'support invitation revocation preserves the Auth identity'
);

SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.set_platform_staff_status(uuid,text)'::regprocedure)
    ILIKE '%v_current_status=''revoked''%'),
  'the internal staff status RPC rejects reactivation of revoked invitations'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef('public.set_platform_support_agent_status(uuid,text)'::regprocedure)
    ILIKE '%v_current_status=''revoked''%'),
  'the support status RPC rejects reactivation of revoked invitations'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon','public.revoke_platform_staff_invitation(uuid)','EXECUTE'),
  'anonymous users cannot revoke internal invitations'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.revoke_platform_support_invitation(uuid)','EXECUTE'),
  'anonymous users cannot revoke support invitations'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.revoke_platform_staff_invitation(uuid)','EXECUTE'),
  'authenticated callers may invoke internal revocation subject to Master authorization'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.revoke_platform_support_invitation(uuid)','EXECUTE'),
  'authenticated callers may invoke support revocation subject to support-manager authorization'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',
  true
);
SELECT extensions.throws_ok(
  $$SELECT public.revoke_platform_staff_invitation('00000000-0000-4000-8000-000000000001'::uuid)$$,
  '42501',NULL,
  'an unrelated authenticated account cannot revoke an internal invitation'
);
SELECT extensions.throws_ok(
  $$SELECT public.revoke_platform_support_invitation('00000000-0000-4000-8000-000000000001'::uuid)$$,
  '42501',NULL,
  'an unrelated authenticated account cannot revoke a support invitation'
);

SELECT * FROM extensions.finish();
ROLLBACK;
