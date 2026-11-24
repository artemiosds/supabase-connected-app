BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

SELECT extensions.has_table('public', 'platform_plans', 'platform_plans catalog table exists');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.platform_plans'::regclass),
  'platform_plans enforces and forces RLS'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.platform_plans),
  4,
  'all four commercial tiers are seeded in platform_plans'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.platform_plans', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_plans', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.platform_plans', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.platform_plans', 'DELETE'),
  'authenticated and anon cannot write platform_plans directly'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.save_platform_plan(text, text, text, numeric, integer, numeric, bigint, jsonb, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.save_platform_plan(text, text, text, numeric, integer, numeric, bigint, jsonb, boolean)', 'EXECUTE'),
  'save_platform_plan is restricted to authenticated callers and blocks anon'
);

SELECT extensions.has_column('public', 'tenant_ai_settings', 'monthly_budget_usd', 'tenant_ai_settings has monthly_budget_usd');
SELECT extensions.has_column('public', 'tenant_ai_settings', 'monthly_token_limit', 'tenant_ai_settings has monthly_token_limit');

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.list_platform_tenant_ai_limits()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.list_platform_tenant_ai_limits()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.set_tenant_ai_limits(uuid, numeric, bigint)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.set_tenant_ai_limits(uuid, numeric, bigint)', 'EXECUTE'),
  'AI quota RPCs block anon and allow authenticated admin checks'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_ai_claim_usage(uuid, uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_claim_usage(uuid, uuid, text)', 'EXECUTE'),
  'platform_ai_claim_usage remains restricted to service_role'
);

-- Test backward-compatible 7-key modules AND 9-key modules with relatorios + pca
INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-4111-8111-111111111111', 'master-plan-test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, name, slug, status, created_by, commercial_status, enabled_modules)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'Teste Legado 7 Módulos',
  'teste-legado-7-modulos',
  'active',
  '11111111-1111-4111-8111-111111111111',
  'active',
  '{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":false,"auditoria":true}'::jsonb
);
SELECT extensions.ok(
  NOT app_auth.is_tenant_module_enabled('22222222-2222-4222-8222-222222222222', 'relatorios'),
  'legacy 7-key tenant insert still succeeds without relatorios key'
);

INSERT INTO public.tenants (id, name, slug, status, created_by, commercial_status, enabled_modules)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  'Teste Completo 9 Módulos',
  'teste-completo-9-modulos',
  'active',
  '11111111-1111-4111-8111-111111111111',
  'active',
  '{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":false,"auditoria":true,"relatorios":true,"pca":true}'::jsonb
);
SELECT extensions.ok(
  app_auth.is_tenant_module_enabled('33333333-3333-4333-8333-333333333333', 'relatorios')
    AND app_auth.is_tenant_module_enabled('33333333-3333-4333-8333-333333333333', 'pca'),
  'new 9-key tenant exposes relatorios and pca modules cleanly'
);

-- Non-platform admin cannot write save_platform_plan
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
SELECT extensions.throws_ok(
  $$SELECT public.save_platform_plan('basico','Hack','',0,1,null,null,'{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":false,"ged":false,"auditoria":true,"relatorios":true,"pca":false}'::jsonb,true)$$,
  '42501',
  NULL,
  'non-platform-admin authenticated user cannot update platform_plans'
);

SELECT * FROM extensions.finish();
ROLLBACK;
