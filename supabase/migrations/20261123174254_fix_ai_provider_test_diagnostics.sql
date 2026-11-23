-- Preserve provider availability on transient connectivity-test failures and persist diagnostics.
BEGIN;

ALTER TABLE public.platform_ai_providers
  ADD COLUMN IF NOT EXISTS last_test_error text,
  ADD COLUMN IF NOT EXISTS last_test_http_status integer
    CHECK (last_test_http_status IS NULL OR last_test_http_status BETWEEN 100 AND 599),
  ADD COLUMN IF NOT EXISTS last_test_error_code text,
  ADD COLUMN IF NOT EXISTS last_test_error_type text,
  ADD COLUMN IF NOT EXISTS last_test_retryable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_test_retry_after text;

CREATE OR REPLACE FUNCTION public.platform_ai_record_provider_test_result(
  p_actor_id uuid,
  p_provider_id uuid,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_type text DEFAULT NULL,
  p_retryable boolean DEFAULT false,
  p_retry_after text DEFAULT NULL
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
  v_error_message text := NULLIF(pg_catalog.left(pg_catalog.btrim(p_error_message), 500), '');
  v_error_code text := NULLIF(pg_catalog.left(pg_catalog.btrim(p_error_code), 120), '');
  v_error_type text := NULLIF(pg_catalog.left(pg_catalog.btrim(p_error_type), 120), '');
  v_retry_after text := NULLIF(pg_catalog.left(pg_catalog.btrim(p_retry_after), 120), '');
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode registrar testes de provedores.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('connected', 'failed', 'transient_error') THEN
    RAISE EXCEPTION 'Resultado de teste inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_http_status IS NOT NULL AND p_http_status NOT BETWEEN 100 AND 599 THEN
    RAISE EXCEPTION 'Código HTTP inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'transient_error' AND p_retryable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Falha transitória precisa estar marcada como recuperável.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
  FROM public.platform_ai_providers
  WHERE id = p_provider_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provedor não encontrado.'; END IF;

  IF p_status = 'connected' THEN
    UPDATE public.platform_ai_providers
    SET status = 'connected',
        is_enabled = true,
        last_test_at = pg_catalog.now(),
        last_test_error = NULL,
        last_test_http_status = NULL,
        last_test_error_code = NULL,
        last_test_error_type = NULL,
        last_test_retryable = false,
        last_test_retry_after = NULL,
        updated_by = p_actor_id,
        updated_at = pg_catalog.now()
    WHERE id = p_provider_id;
  ELSIF p_status = 'transient_error' THEN
    -- A 429, 5xx, timeout, falha de rede ou indisponibilidade do Vault não
    -- invalida credenciais nem remove o provedor da contingência.
    UPDATE public.platform_ai_providers
    SET last_test_at = pg_catalog.now(),
        last_test_error = v_error_message,
        last_test_http_status = p_http_status,
        last_test_error_code = v_error_code,
        last_test_error_type = v_error_type,
        last_test_retryable = true,
        last_test_retry_after = v_retry_after,
        updated_by = p_actor_id,
        updated_at = pg_catalog.now()
    WHERE id = p_provider_id;
  ELSE
    UPDATE public.platform_ai_providers
    SET status = 'failed',
        is_enabled = false,
        is_primary = false,
        last_test_at = pg_catalog.now(),
        last_test_error = v_error_message,
        last_test_http_status = p_http_status,
        last_test_error_code = v_error_code,
        last_test_error_type = v_error_type,
        last_test_retryable = false,
        last_test_retry_after = NULL,
        updated_by = p_actor_id,
        updated_at = pg_catalog.now()
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
        SET provider = v_fallback.provider,
            model = v_fallback.model,
            vault_secret_id = v_fallback.vault_secret_id,
            status = 'connected',
            updated_by = p_actor_id,
            updated_at = pg_catalog.now()
        WHERE id = 1;
        v_promoted := true;
      ELSE
        UPDATE public.platform_ai_configuration
        SET enabled = false,
            status = 'failed',
            updated_by = p_actor_id,
            updated_at = pg_catalog.now()
        WHERE id = 1;
        UPDATE public.tenant_ai_settings
        SET enabled = false, updated_by = p_actor_id, updated_at = pg_catalog.now()
        WHERE enabled = true;
      END IF;
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

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL,
    p_actor_id,
    'PLATFORM_AI_PROVIDER_TESTED',
    'platform_ai_providers',
    p_provider_id::text,
    pg_catalog.jsonb_build_object(
      'status', p_status,
      'fallback_promoted', v_promoted,
      'http_status', p_http_status,
      'error_code', v_error_code,
      'error_type', v_error_type,
      'retryable', p_retryable,
      'error_message', v_error_message
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'provider_id', p_provider_id,
    'status', p_status,
    'enabled', CASE
      WHEN p_status = 'connected' THEN true
      WHEN p_status = 'transient_error' THEN v_provider.is_enabled
      ELSE false
    END,
    'provider_preserved', p_status = 'transient_error',
    'fallback_promoted', v_promoted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_ai_record_provider_test_result(
  uuid, uuid, text, text, integer, text, text, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_record_provider_test_result(
  uuid, uuid, text, text, integer, text, text, boolean, text
) TO service_role;

COMMIT;
