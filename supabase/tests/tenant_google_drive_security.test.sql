BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.tenant_google_drive_connections') IS NOT NULL,
  'per-tenant Google Drive connection metadata table exists'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.tenant_google_drive_oauth_states') IS NOT NULL,
  'hashed single-use OAuth state table exists'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
   WHERE oid='public.tenant_google_drive_connections'::regclass),
  'Drive connection metadata uses RLS'
);
SELECT extensions.ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class
   WHERE oid='public.tenant_google_drive_connections'::regclass),
  'Drive connection metadata forces RLS'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
   WHERE oid='public.tenant_google_drive_oauth_states'::regclass),
  'OAuth state table uses and forces RLS'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.tenant_google_drive_connections','SELECT')
  AND NOT has_table_privilege('authenticated','public.tenant_google_drive_connections','SELECT')
  AND NOT has_table_privilege('authenticated','public.tenant_google_drive_connections','INSERT,UPDATE,DELETE'),
  'client roles have no direct access to Drive connection metadata'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.tenant_google_drive_oauth_states','SELECT')
  AND NOT has_table_privilege('authenticated','public.tenant_google_drive_oauth_states','SELECT')
  AND NOT has_table_privilege('authenticated','public.tenant_google_drive_oauth_states','INSERT,UPDATE,DELETE'),
  'client roles have no direct access to OAuth state'
);
SELECT extensions.ok(
  has_table_privilege('service_role','public.tenant_google_drive_connections','SELECT,INSERT,UPDATE,DELETE')
  AND has_table_privilege('service_role','public.tenant_google_drive_oauth_states','SELECT,INSERT,UPDATE,DELETE'),
  'service role can access connection and state rows for trusted callbacks'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.idx_tenant_google_drive_oauth_states_expiry') IS NOT NULL,
  'expired OAuth state cleanup has a partial index'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.is_tenant_google_drive_oauth_actor_authorized(uuid,uuid)'::regprocedure),
  'OAuth callback revalidation RPC is SECURITY DEFINER with fixed search_path'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.is_tenant_google_drive_oauth_actor_authorized(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.is_tenant_google_drive_oauth_actor_authorized(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.is_tenant_google_drive_oauth_actor_authorized(uuid,uuid)','EXECUTE'),
  'only service role can run the OAuth callback permission probe'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.complete_tenant_google_drive_connection(uuid,uuid,text,text,text[],text,text,text,text,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.complete_tenant_google_drive_connection(uuid,uuid,text,text,text[],text,text,text,text,timestamptz)','EXECUTE')
  AND has_function_privilege('service_role','public.complete_tenant_google_drive_connection(uuid,uuid,text,text,text[],text,text,text,text,timestamptz)','EXECUTE'),
  'only service role can store OAuth tokens and complete a connection'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.get_tenant_google_drive_credentials(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.get_tenant_google_drive_credentials(uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.get_tenant_google_drive_credentials(uuid)','EXECUTE'),
  'only service role can retrieve decrypted Drive tokens'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.update_tenant_google_drive_access_token(uuid,text,timestamptz,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.update_tenant_google_drive_access_token(uuid,text,timestamptz,text)','EXECUTE')
  AND has_function_privilege('service_role','public.update_tenant_google_drive_access_token(uuid,text,timestamptz,text)','EXECUTE'),
  'only service role can rotate Drive tokens'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.get_tenant_google_drive_status(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_tenant_google_drive_status(uuid)','EXECUTE'),
  'authenticated users can see connection status but anonymous users cannot'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated','public.disconnect_tenant_google_drive(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.disconnect_tenant_google_drive(uuid,uuid)','EXECUTE'),
  'only the trusted disconnect backend can delete stored OAuth tokens'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.complete_tenant_google_drive_connection(uuid,uuid,text,text,text[],text,text,text,text,timestamptz)'::regprocedure),
  'OAuth completion function is SECURITY DEFINER with fixed search_path'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%vault.create_secret%'
       AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%vault.update_secret%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.complete_tenant_google_drive_connection(uuid,uuid,text,text,text[],text,text,text,text,timestamptz)'::regprocedure),
  'OAuth completion stores access and refresh tokens using Supabase Vault'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%vault.decrypted_secrets%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.get_tenant_google_drive_credentials(uuid)'::regprocedure),
  'decrypted tokens are read only by the service-role credential RPC'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%is_tenant_google_drive_oauth_actor_authorized%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.disconnect_tenant_google_drive(uuid,uuid)'::regprocedure),
  'disconnect revalidates the tenant administrator before deleting Vault secrets'
);

SELECT * FROM extensions.finish();
ROLLBACK;
