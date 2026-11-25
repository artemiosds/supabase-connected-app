BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.get_platform_tenant_usage_ranking()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_platform_tenant_usage_ranking()', 'EXECUTE'),
  'get_platform_tenant_usage_ranking blocks anon and enforces admin check for authenticated'
);

INSERT INTO auth.users (id, email)
VALUES ('66666666-6666-4666-8666-666666666666', 'ranking-test@example.com')
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.get_platform_tenant_usage_ranking()$$,
  '42501',
  NULL,
  'non-platform-admin cannot query tenant usage ranking'
);

SELECT extensions.ok(
  true,
  'pgTAP ranking security verification completed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
