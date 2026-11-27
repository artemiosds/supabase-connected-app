-- =============================================================================
-- Integrações Opcionais por Secretaria:
-- 1) PNCP (Envio Direto via API - Treinamento/Produção)
-- 2) Assinatura Eletrônica Gov.br (OAuth2/ICP/Prata-Ouro)
-- 3) Assistente AGU para ETP / Termo de Referência (IN SEGES 58/2022 e 81/2022)
-- =============================================================================

ALTER TABLE public.tenant_integration_settings
  ADD COLUMN IF NOT EXISTS pncp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pncp_environment text NOT NULL DEFAULT 'treinamento',
  ADD COLUMN IF NOT EXISTS pncp_login text,
  ADD COLUMN IF NOT EXISTS pncp_password_ciphertext text,
  ADD COLUMN IF NOT EXISTS pncp_unidade_compradora text,
  ADD COLUMN IF NOT EXISTS pncp_last_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS pncp_last_test_status text,
  ADD COLUMN IF NOT EXISTS govbr_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS govbr_environment text NOT NULL DEFAULT 'homologacao',
  ADD COLUMN IF NOT EXISTS govbr_client_id text,
  ADD COLUMN IF NOT EXISTS govbr_client_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS govbr_redirect_uri text,
  ADD COLUMN IF NOT EXISTS agu_assistant_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE public.tenant_integration_settings
    ADD CONSTRAINT tenant_integration_settings_pncp_env_check
      CHECK (pncp_environment = ANY (ARRAY['treinamento'::text, 'producao'::text]));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.tenant_integration_settings
    ADD CONSTRAINT tenant_integration_settings_govbr_env_check
      CHECK (govbr_environment = ANY (ARRAY['homologacao'::text, 'producao'::text]));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rastreabilidade opcional de publicação no PNCP em Contratos, Processos e PCA
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS pncp_control_number text,
  ADD COLUMN IF NOT EXISTS pncp_url text,
  ADD COLUMN IF NOT EXISTS pncp_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS pncp_environment text;

ALTER TABLE public.procurement_processes
  ADD COLUMN IF NOT EXISTS pncp_control_number text,
  ADD COLUMN IF NOT EXISTS pncp_url text,
  ADD COLUMN IF NOT EXISTS pncp_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS pncp_environment text;

ALTER TABLE public.annual_procurement_demands
  ADD COLUMN IF NOT EXISTS pncp_control_number text,
  ADD COLUMN IF NOT EXISTS pncp_url text,
  ADD COLUMN IF NOT EXISTS pncp_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS pncp_environment text;

-- Metadados opcionais de assinatura Gov.br em documentos gerados
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS govbr_signature_status text,
  ADD COLUMN IF NOT EXISTS govbr_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS govbr_signer_cpf_masked text,
  ADD COLUMN IF NOT EXISTS govbr_certificate_serial text;

-- Consulta pública segura (apenas flags booleanas sem expor segredos) para os módulos operacionais
CREATE OR REPLACE FUNCTION public.get_tenant_optional_integrations(p_tenant_id uuid)
RETURNS TABLE(
  pncp_enabled boolean,
  pncp_environment text,
  pncp_configured boolean,
  govbr_enabled boolean,
  govbr_environment text,
  govbr_configured boolean,
  agu_assistant_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    COALESCE(s.pncp_enabled, false),
    COALESCE(s.pncp_environment, 'treinamento'),
    COALESCE(s.pncp_enabled, false)
      AND NULLIF(pg_catalog.btrim(s.pncp_login), '') IS NOT NULL
      AND s.pncp_password_ciphertext IS NOT NULL,
    COALESCE(s.govbr_enabled, false),
    COALESCE(s.govbr_environment, 'homologacao'),
    COALESCE(s.govbr_enabled, false)
      AND NULLIF(pg_catalog.btrim(s.govbr_client_id), '') IS NOT NULL
      AND s.govbr_client_secret_ciphertext IS NOT NULL,
    COALESCE(s.agu_assistant_enabled, false)
  FROM (SELECT 1) AS _one
  LEFT JOIN public.tenant_integration_settings s
    ON s.tenant_id = p_tenant_id
  WHERE (
    app_auth.has_tenant_data_permission(p_tenant_id, 'documents:view')
    AND app_auth.is_tenant_in_good_standing(p_tenant_id)
  ) OR app_auth.is_platform_admin();
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_optional_integrations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_optional_integrations(uuid) TO authenticated;
