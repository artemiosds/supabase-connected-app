BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(19);

SELECT extensions.has_table('public', 'platform_ai_providers', 'AI provider registry exists');
SELECT extensions.has_table('public', 'platform_ai_tenant_provider_access', 'per-tenant provider allow-list exists');
SELECT extensions.has_table('public', 'platform_ai_usage', 'per-tenant AI usage telemetry exists');

SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.platform_ai_providers'::regclass),
  'provider registry forces row-level security'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.platform_ai_tenant_provider_access'::regclass),
  'tenant provider allow-list forces row-level security'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.platform_ai_usage'::regclass),
  'AI usage telemetry forces row-level security'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.platform_ai_providers', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_ai_providers', 'SELECT'),
  'browser roles cannot read provider metadata or credential references'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.platform_ai_tenant_provider_access', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_ai_tenant_provider_access', 'SELECT'),
  'browser roles cannot read provider allow-lists directly'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.platform_ai_usage', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_ai_usage', 'SELECT'),
  'browser roles cannot read usage and cost telemetry directly'
);

SELECT extensions.ok(
  has_table_privilege('service_role', 'public.platform_ai_providers', 'SELECT')
    AND has_table_privilege('service_role', 'public.platform_ai_providers', 'INSERT')
    AND has_table_privilege('service_role', 'public.platform_ai_providers', 'UPDATE'),
  'trusted backend can manage provider metadata'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'public.platform_ai_tenant_provider_access', 'SELECT')
    AND has_table_privilege('service_role', 'public.platform_ai_tenant_provider_access', 'INSERT')
    AND has_table_privilege('service_role', 'public.platform_ai_tenant_provider_access', 'UPDATE'),
  'trusted backend can manage per-tenant provider permissions'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'public.platform_ai_usage', 'SELECT')
    AND has_table_privilege('service_role', 'public.platform_ai_usage', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.platform_ai_usage', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.platform_ai_usage', 'DELETE'),
  'trusted backend can append and read usage telemetry but cannot rewrite history'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_ai_get_provider_api_key(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_get_provider_api_key(uuid)', 'EXECUTE'),
  'browser roles cannot retrieve provider API keys'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'public.platform_ai_get_provider_api_key(uuid)', 'EXECUTE'),
  'only trusted backend can retrieve provider API keys'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'public.platform_ai_save_provider(uuid, uuid, text, text, text, text, text, text, numeric, numeric, integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.platform_ai_update_provider_test_status(uuid, uuid, text)', 'EXECUTE'),
  'trusted backend can save providers and record their connection tests'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'public.platform_ai_set_tenant_providers(uuid, uuid, uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_set_tenant_providers(uuid, uuid, uuid[])', 'EXECUTE'),
  'only trusted backend can change per-tenant provider permissions'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'platform_ai_providers'
      AND indexname = 'platform_ai_providers_one_primary_idx'
  ),
  'database enforces at most one global primary provider'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.platform_ai_configuration'::regclass
      AND conname = 'platform_ai_configuration_provider_check'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%gemini%'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%anthropic%'
  ),
  'legacy global switch accepts all supported provider identifiers'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.platform_ai_providers'::regclass
      AND conname = 'platform_ai_providers_endpoint_check'
  ),
  'custom endpoints are constrained at the database layer'
);

SELECT * FROM extensions.finish();
ROLLBACK;
