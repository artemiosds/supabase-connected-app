-- Gerenciamento multiprovedor para a IA do Primus.
-- Mantém a configuração global legada como chave geral de ativação e migra a credencial OpenAI existente.
BEGIN;

ALTER TABLE public.platform_ai_configuration
  DROP CONSTRAINT IF EXISTS platform_ai_configuration_provider_check;
ALTER TABLE public.platform_ai_configuration
  ADD CONSTRAINT platform_ai_configuration_provider_check
  CHECK (provider IN ('openai', 'gemini', 'anthropic', 'azure_openai', 'openai_compatible'));
ALTER TABLE public.platform_ai_configuration
  DROP CONSTRAINT IF EXISTS platform_ai_configuration_model_check;
ALTER TABLE public.platform_ai_configuration
  ADD CONSTRAINT platform_ai_configuration_model_check
  CHECK (model IS NULL OR model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$');

CREATE TABLE IF NOT EXISTS public.platform_ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  provider text NOT NULL CHECK (
    provider IN ('openai', 'gemini', 'anthropic', 'azure_openai', 'openai_compatible')
  ),
  model text NOT NULL CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$'),
  api_base_url text,
  api_version text,
  vault_secret_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'credentials_saved'
    CHECK (status IN ('credentials_saved', 'connected', 'failed')),
  is_enabled boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  fallback_priority integer NOT NULL DEFAULT 100 CHECK (fallback_priority BETWEEN 1 AND 9999),
  input_cost_per_million numeric(14,6) CHECK (
    input_cost_per_million IS NULL OR input_cost_per_million >= 0
  ),
  output_cost_per_million numeric(14,6) CHECK (
    output_cost_per_million IS NULL OR output_cost_per_million >= 0
  ),
  last_test_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT platform_ai_providers_endpoint_check CHECK (
    (
      provider IN ('azure_openai', 'openai_compatible')
      AND api_base_url IS NOT NULL
      AND api_base_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~:/-]*)?$'
      AND split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1) <> 'localhost'
      AND split_part(split_part(api_base_url, '://', 2), '/', 1) !~ '^[0-9.]+(:[0-9]{1,5})?$'
      AND lower(split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1)) NOT LIKE '%.localhost'
      AND lower(split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1)) NOT LIKE '%.local'
      AND lower(split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1)) NOT LIKE '%.internal'
      AND lower(split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1)) NOT LIKE '%.test'
      AND lower(split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1)) NOT LIKE '%.localdomain'
      AND lower(split_part(split_part(split_part(api_base_url, '://', 2), '/', 1), ':', 1)) NOT LIKE '%.lan'
    )
    OR (
      provider NOT IN ('azure_openai', 'openai_compatible')
      AND api_base_url IS NULL
    )
  ),
  CONSTRAINT platform_ai_providers_state_check CHECK (
    (NOT is_enabled OR status = 'connected')
    AND (NOT is_primary OR (is_enabled AND status = 'connected'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_ai_providers_one_primary_idx
  ON public.platform_ai_providers (is_primary)
  WHERE is_primary;
CREATE INDEX IF NOT EXISTS platform_ai_providers_fallback_idx
  ON public.platform_ai_providers (is_enabled, status, fallback_priority, created_at);

CREATE TABLE IF NOT EXISTS public.platform_ai_tenant_provider_access (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.platform_ai_providers(id) ON DELETE RESTRICT,
  is_allowed boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, provider_id)
);

CREATE INDEX IF NOT EXISTS platform_ai_tenant_provider_access_allowed_idx
  ON public.platform_ai_tenant_provider_access (tenant_id, is_allowed)
  WHERE is_allowed;

CREATE TABLE IF NOT EXISTS public.platform_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider_id uuid REFERENCES public.platform_ai_providers(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature text NOT NULL CHECK (
    feature IN ('assistant', 'documents', 'price_research', 'supplier_documents',
      'contract_monitoring', 'delivery_receiving', 'tasks', 'email_alerts')
  ),
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_usd numeric(18,8) CHECK (
    estimated_cost_usd IS NULL OR estimated_cost_usd >= 0
  ),
  provider_http_status integer CHECK (
    provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599
  ),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS platform_ai_usage_created_at_idx
  ON public.platform_ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_ai_usage_tenant_created_idx
  ON public.platform_ai_usage (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_ai_usage_provider_created_idx
  ON public.platform_ai_usage (provider_id, created_at DESC);

ALTER TABLE public.platform_ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_providers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_tenant_provider_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_tenant_provider_access FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_usage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_platform_ai_providers_service_only ON public.platform_ai_providers;
CREATE POLICY p_platform_ai_providers_service_only
  ON public.platform_ai_providers AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS p_platform_ai_tenant_provider_access_service_only
  ON public.platform_ai_tenant_provider_access;
CREATE POLICY p_platform_ai_tenant_provider_access_service_only
  ON public.platform_ai_tenant_provider_access AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS p_platform_ai_usage_service_only ON public.platform_ai_usage;
CREATE POLICY p_platform_ai_usage_service_only
  ON public.platform_ai_usage AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON public.platform_ai_providers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_ai_tenant_provider_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_ai_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_ai_providers TO service_role;
GRANT ALL ON public.platform_ai_tenant_provider_access TO service_role;
GRANT SELECT, INSERT ON public.platform_ai_usage TO service_role;

COMMENT ON TABLE public.platform_ai_providers IS
  'Master-managed AI provider endpoints and metadata. API credentials remain in Supabase Vault.';
COMMENT ON TABLE public.platform_ai_tenant_provider_access IS
  'Explicit allow-list of AI providers available to each tenant.';
COMMENT ON TABLE public.platform_ai_usage IS
  'Token and estimated-cost telemetry by tenant and provider; never stores prompts or responses.';

INSERT INTO public.platform_ai_configuration (id, provider, enabled, status)
VALUES (1, 'openai', false, 'not_configured')
ON CONFLICT (id) DO NOTHING;

-- Preserve the existing OpenAI integration and its Vault secret without returning the secret to the client.
INSERT INTO public.platform_ai_providers (
  name, provider, model, api_base_url, api_version, vault_secret_id,
  status, is_enabled, is_primary, fallback_priority, last_test_at,
  created_by, updated_by, created_at, updated_at
)
SELECT
  'OpenAI (configuração existente)', 'openai', c.model, NULL, NULL, c.vault_secret_id,
  CASE WHEN c.status = 'connected' THEN 'connected'
    WHEN c.status = 'failed' THEN 'failed' ELSE 'credentials_saved' END,
  c.status = 'connected',
  c.status = 'connected',
  100,
  c.last_test_at,
  c.updated_by,
  c.updated_by,
  c.updated_at,
  c.updated_at
FROM public.platform_ai_configuration c
WHERE c.id = 1
  AND c.model IS NOT NULL
  AND c.vault_secret_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_ai_providers p
    WHERE p.provider = 'openai' AND p.vault_secret_id = c.vault_secret_id
  );

INSERT INTO public.platform_ai_tenant_provider_access (
  tenant_id, provider_id, is_allowed, updated_by
)
SELECT s.tenant_id, p.id, true, s.updated_by
FROM public.tenant_ai_settings s
CROSS JOIN public.platform_ai_providers p
WHERE s.enabled = true
  AND p.is_enabled = true
  AND p.status = 'connected'
ON CONFLICT (tenant_id, provider_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.platform_ai_get_provider_api_key(p_provider_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ds.decrypted_secret
  FROM public.platform_ai_providers p
  JOIN vault.decrypted_secrets ds ON ds.id = p.vault_secret_id
  WHERE p.id = p_provider_id
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_save_provider(
  p_actor_id uuid,
  p_provider_id uuid,
  p_name text,
  p_provider text,
  p_model text,
  p_api_base_url text,
  p_api_version text,
  p_api_key text,
  p_input_cost_per_million numeric,
  p_output_cost_per_million numeric,
  p_fallback_priority integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.platform_ai_providers%ROWTYPE;
  v_provider_id uuid;
  v_secret_id uuid;
  v_exists boolean := false;
  v_needs_test boolean := true;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar provedores de IA.'
      USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Informe um nome válido para o provedor.';
  END IF;
  IF p_provider NOT IN ('openai', 'gemini', 'anthropic', 'azure_openai', 'openai_compatible') THEN
    RAISE EXCEPTION 'Tipo de provedor não suportado.';
  END IF;
  IF p_model IS NULL OR p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' THEN
    RAISE EXCEPTION 'Informe um identificador de modelo válido.';
  END IF;
  IF p_provider IN ('azure_openai', 'openai_compatible') THEN
    IF p_api_base_url IS NULL
      OR p_api_base_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~:/-]*)?$'
      OR split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1) = 'localhost'
      OR split_part(split_part(p_api_base_url, '://', 2), '/', 1) ~ '^[0-9.]+(:[0-9]{1,5})?$'
      OR lower(split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1)) LIKE '%.localhost'
      OR lower(split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1)) LIKE '%.local'
      OR lower(split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1)) LIKE '%.internal'
      OR lower(split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1)) LIKE '%.test'
      OR lower(split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1)) LIKE '%.localdomain'
      OR lower(split_part(split_part(split_part(p_api_base_url, '://', 2), '/', 1), ':', 1)) LIKE '%.lan'
    THEN
      RAISE EXCEPTION 'Informe uma URL HTTPS válida para o endpoint do provedor.';
    END IF;
  ELSIF p_api_base_url IS NOT NULL THEN
    RAISE EXCEPTION 'Este provedor utiliza endpoint oficial e não aceita URL personalizada.';
  END IF;
  IF p_provider = 'azure_openai' AND (
    p_api_version IS NULL OR p_api_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-preview)?$'
  ) THEN
    RAISE EXCEPTION 'Informe uma versão de API válida para o Azure OpenAI.';
  END IF;
  IF p_input_cost_per_million IS NOT NULL AND p_input_cost_per_million < 0
    OR p_output_cost_per_million IS NOT NULL AND p_output_cost_per_million < 0
  THEN
    RAISE EXCEPTION 'Os preços por milhão de tokens não podem ser negativos.';
  END IF;
  IF p_fallback_priority IS NULL OR p_fallback_priority NOT BETWEEN 1 AND 9999 THEN
    RAISE EXCEPTION 'A prioridade de alternativa deve estar entre 1 e 9999.';
  END IF;
  IF p_api_key IS NOT NULL AND (
    length(pg_catalog.btrim(p_api_key)) < 20 OR length(p_api_key) > 1000
  ) THEN
    RAISE EXCEPTION 'A credencial informada tem tamanho inválido.';
  END IF;

  IF p_provider_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.platform_ai_providers
    WHERE id = p_provider_id
    FOR UPDATE;
    v_exists := FOUND;
    IF NOT v_exists THEN RAISE EXCEPTION 'Provedor não encontrado.'; END IF;
  END IF;

  v_secret_id := CASE WHEN v_exists THEN v_existing.vault_secret_id ELSE NULL END;
  IF v_exists THEN
    v_provider_id := p_provider_id;
  ELSE
    v_provider_id := gen_random_uuid();
  END IF;
  IF p_api_key IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      v_secret_id := vault.create_secret(
        pg_catalog.btrim(p_api_key),
        'gfs_platform_ai_' || p_provider || '_' || pg_catalog.replace(v_provider_id::text, '-', ''),
        'API credential for Primus AI provider ' || p_name || '.',
        NULL
      );
    ELSE
      PERFORM vault.update_secret(
        v_secret_id,
        pg_catalog.btrim(p_api_key),
        'gfs_platform_ai_' || p_provider || '_' || pg_catalog.replace(v_provider_id::text, '-', ''),
        'API credential for Primus AI provider ' || p_name || '.',
        NULL
      );
    END IF;
  ELSIF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'Informe a chave de API para cadastrar este provedor.';
  END IF;

  IF v_exists THEN
    v_needs_test :=
      p_api_key IS NOT NULL
      OR p_provider IS DISTINCT FROM v_existing.provider
      OR p_model IS DISTINCT FROM v_existing.model
      OR p_api_base_url IS DISTINCT FROM v_existing.api_base_url
      OR p_api_version IS DISTINCT FROM v_existing.api_version;

    IF v_needs_test AND v_existing.is_primary THEN
      UPDATE public.platform_ai_configuration
      SET enabled = false, status = 'credentials_saved', updated_by = p_actor_id,
          updated_at = pg_catalog.now()
      WHERE id = 1;
      UPDATE public.tenant_ai_settings
      SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
      WHERE enabled = true;
    END IF;

    IF v_needs_test THEN
      UPDATE public.platform_ai_tenant_provider_access
      SET is_allowed = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
      WHERE provider_id = p_provider_id AND is_allowed = true;
      UPDATE public.tenant_ai_settings s
      SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
      WHERE s.enabled = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.platform_ai_tenant_provider_access a
          JOIN public.platform_ai_providers p ON p.id = a.provider_id
          WHERE a.tenant_id = s.tenant_id
            AND a.is_allowed = true
            AND p.id <> p_provider_id
            AND p.is_enabled = true
            AND p.status = 'connected'
        );
    END IF;

    UPDATE public.platform_ai_providers
    SET name = pg_catalog.btrim(p_name),
        provider = p_provider,
        model = p_model,
        api_base_url = NULLIF(pg_catalog.btrim(p_api_base_url), ''),
        api_version = CASE WHEN p_provider = 'azure_openai' THEN p_api_version ELSE NULL END,
        vault_secret_id = v_secret_id,
        status = CASE WHEN v_needs_test THEN 'credentials_saved' ELSE v_existing.status END,
        is_enabled = CASE WHEN v_needs_test THEN false ELSE v_existing.is_enabled END,
        is_primary = CASE WHEN v_needs_test THEN false ELSE v_existing.is_primary END,
        fallback_priority = p_fallback_priority,
        input_cost_per_million = p_input_cost_per_million,
        output_cost_per_million = p_output_cost_per_million,
        updated_by = p_actor_id,
        updated_at = pg_catalog.now()
    WHERE id = p_provider_id
    RETURNING id INTO v_provider_id;
  ELSE
    INSERT INTO public.platform_ai_providers (
      id, name, provider, model, api_base_url, api_version, vault_secret_id,
      status, is_enabled, is_primary, fallback_priority,
      input_cost_per_million, output_cost_per_million, created_by, updated_by
    ) VALUES (
      v_provider_id, pg_catalog.btrim(p_name), p_provider, p_model,
      NULLIF(pg_catalog.btrim(p_api_base_url), ''),
      CASE WHEN p_provider = 'azure_openai' THEN p_api_version ELSE NULL END,
      v_secret_id, 'credentials_saved', false, false, p_fallback_priority,
      p_input_cost_per_million, p_output_cost_per_million, p_actor_id, p_actor_id
    )
    RETURNING id INTO v_provider_id;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL, p_actor_id, 'PLATFORM_AI_PROVIDER_SAVED', 'platform_ai_providers', v_provider_id::text,
    pg_catalog.jsonb_build_object(
      'provider', p_provider, 'model', p_model, 'credential_updated', p_api_key IS NOT NULL,
      'requires_test', v_needs_test
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'provider_id', v_provider_id,
    'status', CASE WHEN v_needs_test THEN 'credentials_saved' ELSE v_existing.status END,
    'requires_test', v_needs_test
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_update_provider_test_status(
  p_actor_id uuid,
  p_provider_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_provider public.platform_ai_providers%ROWTYPE;
  v_fallback public.platform_ai_providers%ROWTYPE;
  v_promoted boolean := false;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode testar provedores.'
      USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('connected', 'failed') THEN
    RAISE EXCEPTION 'Resultado de teste inválido.';
  END IF;

  SELECT * INTO v_provider
  FROM public.platform_ai_providers
  WHERE id = p_provider_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provedor não encontrado.'; END IF;

  IF p_status = 'connected' THEN
    UPDATE public.platform_ai_providers
    SET status = 'connected', is_enabled = true, last_test_at = pg_catalog.now(),
        updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE id = p_provider_id;
  ELSE
    UPDATE public.platform_ai_providers
    SET status = 'failed', is_enabled = false, is_primary = false,
        last_test_at = pg_catalog.now(), updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE id = p_provider_id;
    UPDATE public.platform_ai_tenant_provider_access
    SET is_allowed = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE provider_id = p_provider_id AND is_allowed = true;

    IF v_provider.is_primary THEN
      SELECT * INTO v_fallback
      FROM public.platform_ai_providers
      WHERE id <> p_provider_id AND is_enabled = true AND status = 'connected'
      ORDER BY fallback_priority ASC, created_at ASC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.platform_ai_providers SET is_primary = false WHERE is_primary = true;
        UPDATE public.platform_ai_providers SET is_primary = true WHERE id = v_fallback.id;
        UPDATE public.platform_ai_configuration
        SET provider = v_fallback.provider, model = v_fallback.model,
            vault_secret_id = v_fallback.vault_secret_id, status = 'connected',
            updated_by = p_actor_id, updated_at = pg_catalog.now()
        WHERE id = 1;
        v_promoted := true;
      ELSE
        UPDATE public.platform_ai_configuration
        SET enabled = false, status = 'failed', updated_by = p_actor_id,
            updated_at = pg_catalog.now()
        WHERE id = 1;
        UPDATE public.tenant_ai_settings
        SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
        WHERE enabled = true;
      END IF;
      UPDATE public.tenant_ai_settings s
      SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
      WHERE s.enabled = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.platform_ai_tenant_provider_access a
          JOIN public.platform_ai_providers p ON p.id = a.provider_id
          WHERE a.tenant_id = s.tenant_id
            AND a.is_allowed = true
            AND p.is_enabled = true
            AND p.status = 'connected'
        );
    END IF;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL, p_actor_id, 'PLATFORM_AI_PROVIDER_TESTED', 'platform_ai_providers', p_provider_id::text,
    pg_catalog.jsonb_build_object('status', p_status, 'fallback_promoted', v_promoted),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'provider_id', p_provider_id, 'status', p_status, 'enabled', p_status = 'connected',
    'fallback_promoted', v_promoted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_primary_provider(
  p_actor_id uuid,
  p_provider_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_provider public.platform_ai_providers%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode definir o provedor principal.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider
  FROM public.platform_ai_providers
  WHERE id = p_provider_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_provider.is_enabled OR v_provider.status <> 'connected' THEN
    RAISE EXCEPTION 'Teste e habilite o provedor antes de defini-lo como principal.';
  END IF;

  UPDATE public.platform_ai_providers
  SET is_primary = false, fallback_priority = 1,
      updated_by = p_actor_id, updated_at = pg_catalog.now()
  WHERE is_primary = true AND id <> p_provider_id;

  UPDATE public.platform_ai_providers
  SET is_primary = true, fallback_priority = 1,
      updated_by = p_actor_id, updated_at = pg_catalog.now()
  WHERE id = p_provider_id;

  UPDATE public.platform_ai_configuration
  SET provider = v_provider.provider, model = v_provider.model,
      vault_secret_id = v_provider.vault_secret_id, status = 'connected',
      updated_by = p_actor_id, updated_at = pg_catalog.now()
  WHERE id = 1;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL, p_actor_id, 'PLATFORM_AI_PRIMARY_PROVIDER_CHANGED', 'platform_ai_providers',
    p_provider_id::text,
    pg_catalog.jsonb_build_object('provider', v_provider.provider, 'model', v_provider.model),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object('provider_id', p_provider_id, 'primary', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_provider_enabled(
  p_actor_id uuid,
  p_provider_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_provider public.platform_ai_providers%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode habilitar provedores.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.platform_ai_providers
  WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provedor não encontrado.'; END IF;
  IF p_enabled AND v_provider.status <> 'connected' THEN
    RAISE EXCEPTION 'Teste a conexão antes de habilitar este provedor.';
  END IF;
  IF NOT p_enabled AND v_provider.is_primary THEN
    RAISE EXCEPTION 'Defina outro provedor principal antes de desabilitar este.';
  END IF;

  UPDATE public.platform_ai_providers
  SET is_enabled = p_enabled, updated_by = p_actor_id, updated_at = pg_catalog.now()
  WHERE id = p_provider_id;
  IF NOT p_enabled THEN
    UPDATE public.platform_ai_tenant_provider_access
    SET is_allowed = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE provider_id = p_provider_id AND is_allowed = true;
    UPDATE public.tenant_ai_settings s
    SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE s.enabled = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.platform_ai_tenant_provider_access a
        JOIN public.platform_ai_providers p ON p.id = a.provider_id
        WHERE a.tenant_id = s.tenant_id
          AND a.is_allowed = true
          AND p.is_enabled = true
          AND p.status = 'connected'
      );
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL, p_actor_id, CASE WHEN p_enabled THEN 'PLATFORM_AI_PROVIDER_ENABLED'
      ELSE 'PLATFORM_AI_PROVIDER_DISABLED' END,
    'platform_ai_providers', p_provider_id::text,
    pg_catalog.jsonb_build_object('enabled', p_enabled), pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object('provider_id', p_provider_id, 'enabled', p_enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_provider_priority(
  p_actor_id uuid,
  p_provider_id uuid,
  p_priority integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_provider public.platform_ai_providers%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode ordenar alternativas.'
      USING ERRCODE = '42501';
  END IF;
  IF p_priority IS NULL OR p_priority NOT BETWEEN 1 AND 9999 THEN
    RAISE EXCEPTION 'A prioridade deve estar entre 1 e 9999.';
  END IF;
  SELECT * INTO v_provider FROM public.platform_ai_providers
  WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND OR v_provider.is_primary OR NOT v_provider.is_enabled
    OR v_provider.status <> 'connected' THEN
    RAISE EXCEPTION 'Somente provedores alternativos conectados podem ter prioridade alterada.';
  END IF;
  UPDATE public.platform_ai_providers
  SET fallback_priority = p_priority, updated_by = p_actor_id, updated_at = pg_catalog.now()
  WHERE id = p_provider_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL, p_actor_id, 'PLATFORM_AI_PROVIDER_PRIORITY_CHANGED', 'platform_ai_providers',
    p_provider_id::text, pg_catalog.jsonb_build_object('priority', p_priority), pg_catalog.now()
  );
  RETURN pg_catalog.jsonb_build_object('provider_id', p_provider_id, 'priority', p_priority);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_tenant_providers(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_provider_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_selected_count integer := COALESCE(pg_catalog.cardinality(p_provider_ids), 0);
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode liberar provedores por Secretaria.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Secretaria não encontrada.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_provider_ids, ARRAY[]::uuid[])) AS selected(provider_id)
    LEFT JOIN public.platform_ai_providers p ON p.id = selected.provider_id
    WHERE p.id IS NULL OR p.is_enabled = false OR p.status <> 'connected'
  ) THEN
    RAISE EXCEPTION 'A lista contém provedor inexistente, desabilitado ou sem conexão validada.';
  END IF;
  IF v_selected_count <> (
    SELECT count(DISTINCT selected.provider_id)
    FROM unnest(COALESCE(p_provider_ids, ARRAY[]::uuid[])) AS selected(provider_id)
  ) THEN
    RAISE EXCEPTION 'A lista de provedores contém identificadores duplicados.';
  END IF;
  IF v_selected_count = 0 AND EXISTS (
    SELECT 1 FROM public.tenant_ai_settings s
    WHERE s.tenant_id = p_tenant_id AND s.enabled = true
  ) THEN
    RAISE EXCEPTION 'Libere ao menos um provedor antes de manter a IA ativa nesta Secretaria.';
  END IF;

  INSERT INTO public.platform_ai_tenant_provider_access (
    tenant_id, provider_id, is_allowed, updated_by, updated_at
  )
  SELECT p_tenant_id, p.id,
    p.id = ANY(COALESCE(p_provider_ids, ARRAY[]::uuid[])),
    p_actor_id, pg_catalog.now()
  FROM public.platform_ai_providers p
  ON CONFLICT (tenant_id, provider_id) DO UPDATE
  SET is_allowed = EXCLUDED.is_allowed,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    p_tenant_id, p_actor_id, 'TENANT_AI_PROVIDERS_UPDATED', 'platform_ai_tenant_provider_access',
    p_tenant_id::text,
    pg_catalog.jsonb_build_object('allowed_provider_ids', COALESCE(p_provider_ids, ARRAY[]::uuid[])),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id, 'allowed_provider_count', v_selected_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_global_enabled(
  p_actor_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_primary public.platform_ai_providers%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode ativar a IA.'
      USING ERRCODE = '42501';
  END IF;
  IF p_enabled THEN
    SELECT * INTO v_primary
    FROM public.platform_ai_providers
    WHERE is_primary = true AND is_enabled = true AND status = 'connected'
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Defina um provedor principal com conexão validada antes de ativar a IA.';
    END IF;
    UPDATE public.platform_ai_configuration
    SET provider = v_primary.provider, model = v_primary.model,
        vault_secret_id = v_primary.vault_secret_id, status = 'connected',
        enabled = true, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE id = 1;
  ELSE
    UPDATE public.platform_ai_configuration
    SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE id = 1;
    UPDATE public.tenant_ai_settings
    SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE enabled = true;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL, p_actor_id, CASE WHEN p_enabled THEN 'PLATFORM_AI_ENABLED' ELSE 'PLATFORM_AI_DISABLED' END,
    'platform_ai_configuration', '1',
    pg_catalog.jsonb_build_object('enabled', p_enabled), pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object('enabled', p_enabled, 'status', CASE WHEN p_enabled THEN 'connected' ELSE 'disabled' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_ai_get_provider_api_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_save_provider(uuid, uuid, text, text, text, text, text, text, numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_update_provider_test_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_primary_provider(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_provider_enabled(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_provider_priority(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_tenant_providers(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_global_enabled(uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.platform_ai_get_provider_api_key(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_save_provider(uuid, uuid, text, text, text, text, text, text, numeric, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_update_provider_test_status(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_primary_provider(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_provider_enabled(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_provider_priority(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_tenant_providers(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_global_enabled(uuid, boolean) TO service_role;

COMMIT;
