-- Regression test for Phase 6 security telemetry RPC:
-- ensures strict search_path, SECURITY DEFINER hardening, and privilege isolation.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_platform_security_signals()'::regprocedure
      AND p.prosecdef = true
      AND '' = ANY (p.proconfig)
  ),
  'get_platform_security_signals is SECURITY DEFINER with empty search_path'
);

SELECT extensions.is(
  pg_catalog.has_function_privilege('anon', 'public.get_platform_security_signals()'::regprocedure, 'EXECUTE'),
  false,
  'anon cannot execute get_platform_security_signals'
);

SELECT extensions.is(
  pg_catalog.has_function_privilege('public', 'public.get_platform_security_signals()'::regprocedure, 'EXECUTE'),
  false,
  'PUBLIC cannot execute get_platform_security_signals'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef('public.get_platform_security_signals()'::regprocedure) ILIKE '%is_platform_admin%',
  'get_platform_security_signals enforces app_auth.is_platform_admin()'
);

SELECT * FROM extensions.finish();
ROLLBACK;
