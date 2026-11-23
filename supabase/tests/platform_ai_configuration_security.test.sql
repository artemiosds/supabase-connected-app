BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.has_table('public', 'platform_ai_configuration', 'platform AI configuration metadata exists');
SELECT extensions.has_table('public', 'tenant_ai_settings', 'per-tenant AI feature settings exist');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.platform_ai_configuration'::regclass),
  'global AI configuration forces row-level security'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.tenant_ai_settings'::regclass),
  'tenant AI settings force row-level security'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'public.platform_admins', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.platform_admins', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.platform_admins', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.platform_admins', 'DELETE'),
  'the trusted backend can verify platform administrators with read-only access'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.platform_ai_configuration', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_ai_configuration', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.tenant_ai_settings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.tenant_ai_settings', 'SELECT'),
  'browser roles cannot read configuration or tenant feature flags directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_ai_get_api_key()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_get_api_key()', 'EXECUTE'),
  'browser roles cannot retrieve the provider secret'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_ai_set_global_enabled(uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_set_global_enabled(uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.platform_ai_set_tenant_settings(uuid, uuid, boolean, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_set_tenant_settings(uuid, uuid, boolean, jsonb)', 'EXECUTE'),
  'browser roles cannot bypass the authenticated Edge Function for AI configuration writes'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_ai_claim_usage(uuid, uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_ai_claim_usage(uuid, uuid, text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.platform_ai_claim_usage(uuid, uuid, text)', 'EXECUTE'),
  'only the trusted backend can claim an audited and rate-limited AI request'
);
SELECT extensions.ok(
  (SELECT count(*) = 1 FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'platform_ai_configuration'
     AND policyname = 'p_platform_ai_configuration_service_only'
     AND qual = 'false' AND with_check = 'false'),
  'global configuration has an explicit deny policy for API roles'
);
SELECT extensions.ok(
  (SELECT count(*) = 1 FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'tenant_ai_settings'
     AND policyname = 'p_tenant_ai_settings_service_only'
     AND qual = 'false' AND with_check = 'false'),
  'tenant settings have an explicit deny policy for API roles'
);

SELECT * FROM extensions.finish();
ROLLBACK;
