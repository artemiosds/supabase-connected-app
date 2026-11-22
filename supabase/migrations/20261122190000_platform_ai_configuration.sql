-- Configuração global da IA e habilitação controlada por Secretaria.
-- Chaves privadas são guardadas exclusivamente no Supabase Vault.
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_ai_configuration (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider text NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai')),
  model text,
  vault_secret_id uuid,
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'credentials_saved', 'connected', 'failed')),
  last_test_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (model IS NULL OR model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  CHECK (NOT enabled OR (status = 'connected' AND vault_secret_id IS NOT NULL AND model IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.tenant_ai_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  features jsonb NOT NULL DEFAULT '{
    "assistant": false,
    "documents": false,
    "price_research": false,
    "supplier_documents": false,
    "contract_monitoring": false,
    "delivery_receiving": false,
    "tasks": false,
    "email_alerts": false
  }'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT tenant_ai_settings_features_check CHECK (
    pg_catalog.jsonb_typeof(features) = 'object'
    AND features - ARRAY[
      'assistant', 'documents', 'price_research', 'supplier_documents',
      'contract_monitoring', 'delivery_receiving', 'tasks', 'email_alerts'
    ]::text[] = '{}'::jsonb
    AND (features->'assistant' IS NULL OR pg_catalog.jsonb_typeof(features->'assistant') = 'boolean')
    AND (features->'documents' IS NULL OR pg_catalog.jsonb_typeof(features->'documents') = 'boolean')
    AND (features->'price_research' IS NULL OR pg_catalog.jsonb_typeof(features->'price_research') = 'boolean')
    AND (features->'supplier_documents' IS NULL OR pg_catalog.jsonb_typeof(features->'supplier_documents') = 'boolean')
    AND (features->'contract_monitoring' IS NULL OR pg_catalog.jsonb_typeof(features->'contract_monitoring') = 'boolean')
    AND (features->'delivery_receiving' IS NULL OR pg_catalog.jsonb_typeof(features->'delivery_receiving') = 'boolean')
    AND (features->'tasks' IS NULL OR pg_catalog.jsonb_typeof(features->'tasks') = 'boolean')
    AND (features->'email_alerts' IS NULL OR pg_catalog.jsonb_typeof(features->'email_alerts') = 'boolean')
  )
);

ALTER TABLE public.platform_ai_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_configuration FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_ai_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_platform_ai_configuration_service_only ON public.platform_ai_configuration;
CREATE POLICY p_platform_ai_configuration_service_only
  ON public.platform_ai_configuration AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS p_tenant_ai_settings_service_only ON public.tenant_ai_settings;
CREATE POLICY p_tenant_ai_settings_service_only
  ON public.tenant_ai_settings AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON public.platform_ai_configuration FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tenant_ai_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_ai_configuration TO service_role;
GRANT ALL ON public.tenant_ai_settings TO service_role;

COMMENT ON TABLE public.platform_ai_configuration IS
  'Single platform-owned AI provider configuration. API credentials are held only in Vault.';
COMMENT ON TABLE public.tenant_ai_settings IS
  'Per-tenant AI feature flags controlled by an active platform administrator.';

CREATE OR REPLACE FUNCTION public.platform_ai_save_configuration(
  p_actor_id uuid,
  p_model text,
  p_api_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.platform_ai_configuration%ROWTYPE;
  v_secret_id uuid;
  v_secret_updated boolean := false;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar a IA.' USING ERRCODE = '42501';
  END IF;
  IF p_model IS NULL OR p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' THEN
    RAISE EXCEPTION 'Informe um identificador válido de modelo.';
  END IF;
  IF p_api_key IS NOT NULL AND (length(pg_catalog.btrim(p_api_key)) < 20 OR length(p_api_key) > 500) THEN
    RAISE EXCEPTION 'A credencial informada tem formato ou tamanho inválido.';
  END IF;

  SELECT * INTO v_existing FROM public.platform_ai_configuration WHERE id = 1 FOR UPDATE;
  v_secret_id := v_existing.vault_secret_id;
  IF p_api_key IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      v_secret_id := vault.create_secret(pg_catalog.btrim(p_api_key), 'gfs_platform_ai_openai_api_key', 'OpenAI API key for Primus AI services.', NULL);
    ELSE
      PERFORM vault.update_secret(v_secret_id, pg_catalog.btrim(p_api_key), 'gfs_platform_ai_openai_api_key', 'OpenAI API key for Primus AI services.', NULL);
    END IF;
    v_secret_updated := true;
  ELSIF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'Cadastre a credencial do provedor antes de salvar a configuração.';
  END IF;

  INSERT INTO public.platform_ai_configuration (
    id, provider, model, vault_secret_id, enabled, status, last_test_at, updated_by, updated_at
  ) VALUES (
    1, 'openai', p_model, v_secret_id, false, 'credentials_saved', NULL, p_actor_id, pg_catalog.now()
  )
  ON CONFLICT (id) DO UPDATE SET
    provider = 'openai', model = EXCLUDED.model, vault_secret_id = EXCLUDED.vault_secret_id,
    enabled = false, status = 'credentials_saved', last_test_at = NULL,
    updated_by = p_actor_id, updated_at = pg_catalog.now();

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (NULL, p_actor_id, 'PLATFORM_AI_CONFIGURATION_SAVED', 'platform_ai_configuration', '1',
    pg_catalog.jsonb_build_object('provider', 'openai', 'model', p_model,
      'credential_updated', v_secret_updated, 'enabled', false), pg_catalog.now());
  RETURN pg_catalog.jsonb_build_object('saved', true, 'provider', 'openai', 'model', p_model,
    'credential_updated', v_secret_updated, 'status', 'credentials_saved', 'enabled', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_get_api_key()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ds.decrypted_secret
  FROM public.platform_ai_configuration c
  JOIN vault.decrypted_secrets ds ON ds.id = c.vault_secret_id
  WHERE c.id = 1 AND c.vault_secret_id IS NOT NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_connection_status(
  p_actor_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_row public.platform_ai_configuration%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode testar a IA.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('connected', 'failed') THEN RAISE EXCEPTION 'Status de conexão inválido.'; END IF;
  UPDATE public.platform_ai_configuration SET status = p_status, last_test_at = pg_catalog.now(),
    enabled = CASE WHEN p_status = 'failed' THEN false ELSE enabled END,
    updated_by = p_actor_id, updated_at = pg_catalog.now()
  WHERE id = 1 AND vault_secret_id IS NOT NULL AND model IS NOT NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configure primeiro o modelo e a credencial.'; END IF;
  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (NULL, p_actor_id, 'PLATFORM_AI_CONNECTION_TESTED', 'platform_ai_configuration', '1',
    pg_catalog.jsonb_build_object('status', p_status), pg_catalog.now());
  RETURN pg_catalog.jsonb_build_object('status', v_row.status, 'last_test_at', v_row.last_test_at,
    'enabled', v_row.enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_global_enabled(p_actor_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_row public.platform_ai_configuration%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode ativar a IA.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.platform_ai_configuration SET enabled = p_enabled, updated_by = p_actor_id,
    updated_at = pg_catalog.now()
  WHERE id = 1 AND (NOT p_enabled OR (status = 'connected' AND vault_secret_id IS NOT NULL AND model IS NOT NULL))
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Teste e salve uma credencial válida antes de ativar a IA.'; END IF;
  IF NOT p_enabled THEN
    UPDATE public.tenant_ai_settings SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE enabled;
  END IF;
  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (NULL, p_actor_id, CASE WHEN p_enabled THEN 'PLATFORM_AI_ENABLED' ELSE 'PLATFORM_AI_DISABLED' END,
    'platform_ai_configuration', '1', pg_catalog.jsonb_build_object('enabled', p_enabled), pg_catalog.now());
  RETURN pg_catalog.jsonb_build_object('enabled', v_row.enabled, 'status', v_row.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_set_tenant_settings(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_enabled boolean,
  p_features jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_features jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar IA por Secretaria.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Secretaria não encontrada.';
  END IF;
  IF p_enabled AND NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.status = 'active'
      AND (
        t.commercial_status = 'active'
        OR (t.commercial_status = 'trial'
          AND t.trial_starts_at IS NOT NULL AND t.trial_starts_at <= pg_catalog.now()
          AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at > pg_catalog.now())
      )
  ) THEN RAISE EXCEPTION 'A Secretaria precisa estar operacional ou em período de demonstração válido.'; END IF;
  IF p_features IS NULL OR pg_catalog.jsonb_typeof(p_features) <> 'object'
    OR p_features - ARRAY['assistant','documents','price_research','supplier_documents',
      'contract_monitoring','delivery_receiving','tasks','email_alerts']::text[] <> '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_each(p_features) e WHERE pg_catalog.jsonb_typeof(e.value) <> 'boolean'
    )
  THEN RAISE EXCEPTION 'A lista de recursos de IA contém valores inválidos.'; END IF;
  IF p_enabled AND NOT EXISTS (
    SELECT 1 FROM public.platform_ai_configuration c
    WHERE c.id = 1 AND c.enabled AND c.status = 'connected'
  ) THEN RAISE EXCEPTION 'A IA global precisa estar ativa e testada.'; END IF;

  v_features := '{
    "assistant": false, "documents": false, "price_research": false,
    "supplier_documents": false, "contract_monitoring": false,
    "delivery_receiving": false, "tasks": false, "email_alerts": false
  }'::jsonb || p_features;
  INSERT INTO public.tenant_ai_settings (tenant_id, enabled, features, updated_by, updated_at)
  VALUES (p_tenant_id, p_enabled, v_features, p_actor_id, pg_catalog.now())
  ON CONFLICT (tenant_id) DO UPDATE SET enabled = EXCLUDED.enabled, features = EXCLUDED.features,
    updated_by = p_actor_id, updated_at = pg_catalog.now();
  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (p_tenant_id, p_actor_id, 'TENANT_AI_SETTINGS_UPDATED', 'tenant_ai_settings', p_tenant_id::text,
    pg_catalog.jsonb_build_object('enabled', p_enabled, 'features', v_features), pg_catalog.now());
  RETURN pg_catalog.jsonb_build_object('tenant_id', p_tenant_id, 'enabled', p_enabled, 'features', v_features);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_claim_usage(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_usage_count bigint;
BEGIN
  IF p_feature NOT IN ('assistant','documents','price_research','supplier_documents',
      'contract_monitoring','delivery_receiving','tasks','email_alerts') THEN
    RAISE EXCEPTION 'Recurso de IA inválido.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_actor_id AND tm.status = 'active'
      AND t.status = 'active'
      AND (t.commercial_status = 'active'
        OR (t.commercial_status = 'trial'
          AND t.trial_starts_at IS NOT NULL AND t.trial_starts_at <= pg_catalog.now()
          AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at > pg_catalog.now()))
  ) THEN RAISE EXCEPTION 'Vínculo operacional com a Secretaria não encontrado.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_ai_configuration c
    JOIN public.tenant_ai_settings s ON s.tenant_id = p_tenant_id
    WHERE c.id = 1 AND c.enabled AND c.status = 'connected'
      AND s.enabled AND s.features->p_feature = 'true'::jsonb
  ) THEN RAISE EXCEPTION 'Este recurso de IA foi desativado.' USING ERRCODE = '42501'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':' || p_actor_id::text, 0)
  );
  SELECT count(*) INTO v_usage_count FROM public.audit_events
  WHERE tenant_id = p_tenant_id AND actor_id = p_actor_id
    AND action = 'AI_ASSISTANT_REQUESTED'
    AND created_at >= pg_catalog.now() - interval '1 hour';
  IF v_usage_count >= 40 THEN
    INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
    VALUES (p_tenant_id, p_actor_id, 'AI_ASSISTANT_RATE_LIMITED', 'ai_assistant', p_feature,
      pg_catalog.jsonb_build_object('feature', p_feature), pg_catalog.now());
    RETURN false;
  END IF;
  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (p_tenant_id, p_actor_id, 'AI_ASSISTANT_REQUESTED', 'ai_assistant', p_feature,
    pg_catalog.jsonb_build_object('feature', p_feature), pg_catalog.now());
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_ai_save_configuration(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_get_api_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_connection_status(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_global_enabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_set_tenant_settings(uuid, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_ai_claim_usage(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_save_configuration(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_get_api_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_connection_status(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_global_enabled(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_set_tenant_settings(uuid, uuid, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_ai_claim_usage(uuid, uuid, text) TO service_role;

COMMIT;
