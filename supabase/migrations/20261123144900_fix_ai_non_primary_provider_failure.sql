-- Disable tenant AI when a failed non-primary provider was its only authorized provider.
BEGIN;

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
    END IF;

    -- This check also covers failures of non-primary providers that were the
    -- only provider explicitly authorized for a tenant.
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

REVOKE ALL ON FUNCTION public.platform_ai_update_provider_test_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_update_provider_test_status(uuid, uuid, text)
  TO service_role;

COMMIT;
