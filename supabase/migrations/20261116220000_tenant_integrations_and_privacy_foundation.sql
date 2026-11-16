-- Tenant-scoped integration configuration foundation.
-- Secrets are encrypted by the Edge Function and never readable by browser roles.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_integration_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  email_provider text NOT NULL DEFAULT 'none'
    CHECK (email_provider IN ('none','resend','smtp_gateway')),
  email_from_name text,
  email_from_address text,
  email_reply_to text,
  email_smtp_host text,
  email_smtp_port integer,
  email_smtp_security text NOT NULL DEFAULT 'tls'
    CHECK (email_smtp_security IN ('tls','starttls')),
  email_smtp_username text,
  email_smtp_secret_ciphertext text,
  email_api_secret_ciphertext text,
  email_domain_verified_at timestamptz,
  email_last_test_at timestamptz,
  email_last_test_status text
    CHECK (email_last_test_status IS NULL OR email_last_test_status IN ('success','failed','not_tested')),
  drive_enabled boolean NOT NULL DEFAULT false,
  drive_client_id text,
  drive_client_secret_ciphertext text,
  drive_refresh_token_ciphertext text,
  drive_root_folder_id text,
  drive_connected_at timestamptz,
  drive_last_sync_at timestamptz,
  retention_days integer NOT NULL DEFAULT 2555
    CHECK (retention_days BETWEEN 30 AND 36500),
  retention_policy_version text,
  retention_policy_text text,
  retention_approved_at timestamptz,
  retention_approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT tenant_integration_smtp_port_check
    CHECK (email_smtp_port IS NULL OR email_smtp_port BETWEEN 1 AND 65535),
  CONSTRAINT tenant_integration_email_address_check
    CHECK (email_from_address IS NULL OR email_from_address ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')
);

CREATE TABLE IF NOT EXISTS public.tenant_privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  requester_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_email text,
  request_type text NOT NULL CHECK (request_type IN ('access','correction','export','deletion','objection')),
  subject_description text NOT NULL CHECK (length(btrim(subject_description)) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','under_review','awaiting_identity','approved','rejected','completed')),
  legal_basis_review text,
  decision_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT tenant_privacy_request_review_consistency
    CHECK ((reviewed_at IS NULL AND reviewed_by IS NULL) OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_tenant_privacy_requests_tenant_status_created
  ON public.tenant_privacy_requests(tenant_id,status,created_at DESC);

ALTER TABLE public.tenant_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_integration_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_privacy_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_tenant_integration_settings_service_only
  ON public.tenant_integration_settings;
CREATE POLICY p_tenant_integration_settings_service_only
  ON public.tenant_integration_settings
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS p_tenant_privacy_requests_service_only
  ON public.tenant_privacy_requests;
CREATE POLICY p_tenant_privacy_requests_service_only
  ON public.tenant_privacy_requests
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.tenant_integration_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tenant_privacy_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tenant_integration_settings TO service_role;
GRANT ALL ON TABLE public.tenant_privacy_requests TO service_role;

COMMENT ON TABLE public.tenant_integration_settings IS
  'Tenant integration metadata. Secret columns contain AES-GCM ciphertext written/read only by trusted Edge Functions.';
COMMENT ON COLUMN public.tenant_integration_settings.email_smtp_secret_ciphertext IS
  'Encrypted SMTP password; never expose through PostgREST or client-side code.';
COMMENT ON COLUMN public.tenant_integration_settings.drive_client_secret_ciphertext IS
  'Encrypted Google OAuth client secret; never expose through PostgREST or client-side code.';
COMMENT ON COLUMN public.tenant_integration_settings.drive_refresh_token_ciphertext IS
  'Encrypted Google Drive refresh token; never expose through PostgREST or client-side code.';
COMMENT ON TABLE public.tenant_privacy_requests IS
  'LGPD data-subject requests. Deletion requests require a separate legal-basis review and are never auto-executed.';


CREATE TABLE IF NOT EXISTS public.tenant_drive_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}
),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_drive_oauth_states_expiry
  ON public.tenant_drive_oauth_states(expires_at);
ALTER TABLE public.tenant_drive_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_drive_oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_drive_oauth_states_service_only
  ON public.tenant_drive_oauth_states;
CREATE POLICY p_tenant_drive_oauth_states_service_only
  ON public.tenant_drive_oauth_states
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.tenant_drive_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tenant_drive_oauth_states TO service_role;
COMMENT ON TABLE public.tenant_drive_oauth_states IS
  'Single-use, hashed, short-lived OAuth state values for tenant Google Drive authorization.';

COMMIT;
