BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

SELECT extensions.has_table('public','tenant_integration_settings',
  'tenant integration settings table exists');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid='public.tenant_integration_settings'::regclass),
  'integration settings force row-level security');
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated','public.tenant_integration_settings','SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_integration_settings','INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_integration_settings','UPDATE')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_integration_settings','DELETE'),
  'browser role has no direct access to encrypted integration settings');
SELECT extensions.ok(
  pg_catalog.has_table_privilege('service_role','public.tenant_integration_settings','SELECT')
  AND pg_catalog.has_table_privilege('service_role','public.tenant_integration_settings','INSERT')
  AND pg_catalog.has_table_privilege('service_role','public.tenant_integration_settings','UPDATE'),
  'trusted Edge Functions can manage integration settings');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.tenant_integration_settings'::regclass
      AND attname='email_smtp_secret_ciphertext' AND NOT attisdropped)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.tenant_integration_settings'::regclass
      AND attname='drive_client_secret_ciphertext' AND NOT attisdropped)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.tenant_integration_settings'::regclass
      AND attname='drive_refresh_token_ciphertext' AND NOT attisdropped),
  'SMTP and Google Drive credentials have dedicated ciphertext-only columns');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.tenant_integration_settings'::regclass
      AND conname='tenant_integration_smtp_port_check')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.tenant_integration_settings'::regclass
      AND conname='tenant_integration_email_address_check'),
  'email configuration validates port and sender address');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.tenant_integration_settings'::regclass
      AND conname='tenant_integration_email_domain_check'),
  'institutional sender domain has a database validation constraint');
SELECT extensions.has_table('public','tenant_privacy_requests',
  'LGPD data-subject request register exists');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid='public.tenant_privacy_requests'::regclass),
  'privacy requests force row-level security');
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated','public.tenant_privacy_requests','SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_privacy_requests','INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_privacy_requests','UPDATE')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_privacy_requests','DELETE'),
  'privacy request records are not directly accessible to browser roles');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.tenant_privacy_requests'::regclass
      AND conname='tenant_privacy_request_review_consistency'),
  'privacy decisions require reviewer identity and timestamp together');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.tenant_privacy_requests'::regclass
      AND conname LIKE '%request_type%')
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.tenant_privacy_requests'::regclass
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%access%correction%export%deletion%objection%'),
  'privacy request type is restricted to supported LGPD actions');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND indexname='idx_tenant_privacy_requests_tenant_status_created'),
  'privacy requests have tenant-scoped status and chronology index');


SELECT extensions.has_table('public','tenant_drive_oauth_states',
  'Google Drive OAuth state table exists');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid='public.tenant_drive_oauth_states'::regclass)
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_drive_oauth_states','SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated','public.tenant_drive_oauth_states','INSERT'),
  'OAuth state and encrypted PKCE verifier are server-only');

SELECT * FROM extensions.finish();
ROLLBACK;
