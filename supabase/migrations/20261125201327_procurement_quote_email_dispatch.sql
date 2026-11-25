ALTER TABLE public.procurement_quote_requests
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_sent_to text,
  ADD COLUMN IF NOT EXISTS email_provider text;

ALTER TABLE public.procurement_quote_requests
  DROP CONSTRAINT IF EXISTS chk_procurement_quote_requests_email_provider;

ALTER TABLE public.procurement_quote_requests
  ADD CONSTRAINT chk_procurement_quote_requests_email_provider
  CHECK (
    email_provider IS NULL
    OR email_provider IN ('smtp_gateway', 'resend', 'platform_resend')
  );

CREATE OR REPLACE FUNCTION public.can_dispatch_procurement_quote_email(
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (
      (SELECT app_auth.is_platform_admin())
      OR (
        app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
        AND app_auth.is_tenant_in_good_standing(p_tenant_id)
        AND app_auth.is_tenant_module_enabled(p_tenant_id, 'processos')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_dispatch_procurement_quote_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_dispatch_procurement_quote_email(uuid) TO authenticated;
