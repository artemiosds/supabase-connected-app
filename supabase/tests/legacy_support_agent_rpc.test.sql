BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);

SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.add_platform_support_agent(uuid,text)') IS NOT NULL,
  'legacy support RPC remains present for controlled future cleanup'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.add_platform_support_agent(uuid,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.add_platform_support_agent(uuid,text)'::regprocedure,
    'EXECUTE'
  ),
  'legacy support RPC is not executable by API roles'
);

SELECT extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)'::regprocedure,
    'EXECUTE'
  ),
  'the guarded invitation lifecycle RPC remains available'
);

SELECT * FROM extensions.finish();
ROLLBACK;
