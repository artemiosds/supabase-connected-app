-- Securely remove an AI provider and its Vault credential while preserving usage history.
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_ai_delete_provider(
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
  v_configuration public.platform_ai_configuration%ROWTYPE;
  v_fallback public.platform_ai_providers%ROWTYPE;
  v_replaces_primary boolean := false;
  v_primary_replaced boolean := false;
  v_global_disabled boolean := false;
  v_secret_deleted boolean := false;
  v_secret_delete_count integer := 0;
  v_usage_records_preserved bigint := 0;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = p_actor_id AND pa.is_active
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode excluir provedores de IA.'
      USING ERRCODE = '42501';
  END IF;

  IF p_provider_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um provedor válido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
  FROM public.platform_ai_providers
  WHERE id = p_provider_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O provedor selecionado não existe ou já foi excluído.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_configuration
  FROM public.platform_ai_configuration
  WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A configuração global de IA não foi encontrada.';
  END IF;

  v_replaces_primary :=
    v_provider.is_primary
    OR v_configuration.vault_secret_id = v_provider.vault_secret_id;

  IF v_replaces_primary THEN
    SELECT * INTO v_fallback
    FROM public.platform_ai_providers
    WHERE id <> p_provider_id
      AND is_enabled = true
      AND status = 'connected'
    ORDER BY is_primary DESC, fallback_priority ASC, created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.platform_ai_providers
      SET is_primary = false,
          updated_at = pg_catalog.now()
      WHERE is_primary = true AND id <> v_fallback.id;

      UPDATE public.platform_ai_providers
      SET is_primary = true,
          fallback_priority = 1,
          updated_by = p_actor_id,
          updated_at = pg_catalog.now()
      WHERE id = v_fallback.id;

      UPDATE public.platform_ai_configuration
      SET provider = v_fallback.provider,
          model = v_fallback.model,
          vault_secret_id = v_fallback.vault_secret_id,
          status = 'connected',
          last_test_at = v_fallback.last_test_at,
          updated_by = p_actor_id,
          updated_at = pg_catalog.now()
      WHERE id = 1;

      v_primary_replaced := true;
    ELSE
      UPDATE public.platform_ai_providers
      SET is_primary = false,
          updated_by = p_actor_id,
          updated_at = pg_catalog.now()
      WHERE id = p_provider_id;

      UPDATE public.platform_ai_configuration
      SET provider = 'openai',
          model = NULL,
          vault_secret_id = NULL,
          enabled = false,
          status = 'not_configured',
          last_test_at = NULL,
          updated_by = p_actor_id,
          updated_at = pg_catalog.now()
      WHERE id = 1;

      UPDATE public.tenant_ai_settings
      SET enabled = false,
          updated_by = p_actor_id,
          updated_at = pg_catalog.now()
      WHERE enabled = true;

      v_global_disabled := true;
    END IF;
  END IF;

  SELECT count(*) INTO v_usage_records_preserved
  FROM public.platform_ai_usage
  WHERE provider_id = p_provider_id;

  -- Remove tenant allow-list references before deleting the provider (FK is RESTRICT).
  DELETE FROM public.platform_ai_tenant_provider_access
  WHERE provider_id = p_provider_id;

  -- Historical usage rows are retained; their provider_id is set to NULL by FK.
  DELETE FROM public.platform_ai_providers
  WHERE id = p_provider_id;

  -- A tenant cannot remain enabled if the deleted provider was its last usable option.
  UPDATE public.tenant_ai_settings s
  SET enabled = false,
      updated_by = p_actor_id,
      updated_at = pg_catalog.now()
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

  -- Delete the Vault secret only when no other provider or global config references it.
  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_ai_providers p
    WHERE p.vault_secret_id = v_provider.vault_secret_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.platform_ai_configuration c
    WHERE c.vault_secret_id = v_provider.vault_secret_id
  ) THEN
    DELETE FROM vault.secrets
    WHERE id = v_provider.vault_secret_id;
    GET DIAGNOSTICS v_secret_delete_count = ROW_COUNT;
    v_secret_deleted := v_secret_delete_count > 0;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_id,
    action,
    entity,
    entity_id,
    details,
    created_at
  ) VALUES (
    NULL,
    p_actor_id,
    'PLATFORM_AI_PROVIDER_DELETED',
    'platform_ai_providers',
    p_provider_id::text,
    pg_catalog.jsonb_build_object(
      'name', v_provider.name,
      'provider', v_provider.provider,
      'model', v_provider.model,
      'was_primary', v_provider.is_primary,
      'primary_replaced', v_primary_replaced,
      'global_disabled', v_global_disabled,
      'vault_secret_deleted', v_secret_deleted,
      'usage_records_preserved', v_usage_records_preserved
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'provider_id', p_provider_id,
    'deleted', true,
    'vault_secret_deleted', v_secret_deleted,
    'primary_replaced', v_primary_replaced,
    'global_disabled', v_global_disabled,
    'usage_records_preserved', v_usage_records_preserved
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_ai_delete_provider(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_delete_provider(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.platform_ai_delete_provider(uuid, uuid) IS
  'Deletes a Master-managed AI provider, cleans up its Vault secret and tenant allow-list, promotes a healthy fallback when needed, and preserves usage history.';

COMMIT;
