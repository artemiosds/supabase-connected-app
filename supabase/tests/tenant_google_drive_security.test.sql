BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(17);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.tenant_drive_connections') IS NOT NULL,
  'tenant-specific Google Drive connections table exists'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.tenant_drive_oauth_states') IS NOT NULL,
  'single-use OAuth state table exists'
);
SELECT extensions.ok((
  SELECT c.relrowsecurity AND c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  WHERE c.oid='public.tenant_drive_connections'::regclass
), 'Drive connection table enforces RLS');
SELECT extensions.ok((
  SELECT c.relrowsecurity AND c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  WHERE c.oid='public.tenant_drive_oauth_states'::regclass
), 'OAuth state table enforces RLS');

SELECT extensions.ok(
  NOT has_table_privilege('anon','public.tenant_drive_connections','SELECT')
  AND NOT has_table_privilege('authenticated','public.tenant_drive_connections','SELECT'),
  'browser roles cannot read connection metadata directly'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.tenant_drive_oauth_states','SELECT')
  AND NOT has_table_privilege('authenticated','public.tenant_drive_oauth_states','SELECT'),
  'browser roles cannot read OAuth state or PKCE verifier'
);
SELECT extensions.ok(
  has_table_privilege('service_role','public.tenant_drive_connections','SELECT,INSERT,UPDATE,DELETE')
  AND has_table_privilege('service_role','public.tenant_drive_oauth_states','SELECT,INSERT,UPDATE,DELETE'),
  'service role can operate the private connection and state tables'
);

SELECT extensions.ok(
  has_function_privilege('authenticated','public.can_manage_tenant_drive(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.can_manage_tenant_drive(uuid)','EXECUTE'),
  'authenticated tenant users can evaluate the manager gate; anon cannot'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.get_tenant_drive_connection_status(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_tenant_drive_connection_status(uuid)','EXECUTE'),
  'connection status RPC is authenticated-only'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.create_tenant_drive_oauth_state(uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.create_tenant_drive_oauth_state(uuid,text,text)','EXECUTE'),
  'OAuth state creation RPC is authenticated-only'
);

SELECT extensions.ok(
  has_function_privilege('service_role','public.consume_tenant_drive_oauth_state(text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.consume_tenant_drive_oauth_state(text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.consume_tenant_drive_oauth_state(text)','EXECUTE'),
  'OAuth callback state consumption is service-role-only'
);
SELECT extensions.ok(
  has_function_privilege('service_role','public.save_tenant_drive_connection(text,text,text,boolean,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.save_tenant_drive_connection(text,text,text,boolean,text,text)','EXECUTE'),
  'connection persistence and Vault write are service-role-only'
);
SELECT extensions.ok(
  has_function_privilege('service_role','public.get_tenant_drive_refresh_token(uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.get_tenant_drive_refresh_token(uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_tenant_drive_refresh_token(uuid,uuid,text)','EXECUTE'),
  'refresh token retrieval is service-role-only'
);
SELECT extensions.ok(
  has_function_privilege('service_role','public.disconnect_tenant_drive(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.disconnect_tenant_drive(uuid,uuid)','EXECUTE'),
  'Drive disconnect and Vault deletion are service-role-only'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.permissions p WHERE p.code='org:edit'
  ),
  'existing tenant organization-edit permission is available for Drive administration'
);
SELECT extensions.ok((
  SELECT pg_catalog.strpos(p.prosrc, 'org:edit') > 0
    AND pg_catalog.strpos(p.prosrc, 'is_platform_admin') = 0
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='can_manage_tenant_drive'
),
  'Drive management requires the tenant permission and has no global Master bypass'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema='public' AND routine_name='save_tenant_drive_connection'
      AND security_type='DEFINER'
  ),
  'Vault persistence is implemented in a fixed-search-path security definer routine'
);

SELECT * FROM extensions.finish();
ROLLBACK;
