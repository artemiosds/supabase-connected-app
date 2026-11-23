BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_tenant uuid;
  v_primary jsonb;
  v_fallback jsonb;
  v_unused jsonb;
  v_primary_id uuid;
  v_fallback_id uuid;
  v_unused_id uuid;
  v_primary_secret uuid;
  v_fallback_secret uuid;
  v_unused_secret uuid;
  v_result jsonb;
  v_configuration_model text;
  v_configuration_enabled boolean;
  v_configuration_status text;
  v_tenant_enabled boolean;
  v_provider_primary boolean;
  v_provider_count integer;
  v_usage_count integer;
  v_usage_unlinked integer;
  v_secret_count integer;
BEGIN
  SELECT user_id INTO v_actor
  FROM public.platform_admins
  WHERE is_active = true
  LIMIT 1;

  SELECT id INTO v_tenant
  FROM public.tenants
  WHERE status = 'active'
    AND (
      commercial_status = 'active'
      OR (
        commercial_status = 'trial'
        AND trial_starts_at IS NOT NULL
        AND trial_starts_at <= pg_catalog.now()
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at > pg_catalog.now()
      )
    )
  LIMIT 1;

  IF v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Active test principals unavailable.';
  END IF;

  v_primary := public.platform_ai_save_provider(
    v_actor, NULL, 'Delete fixture primary', 'openai_compatible',
    'delete-fixture-primary', 'https://delete-fixture.example.com/v1', NULL,
    'synthetic-delete-primary-credential-123456789', 0, 0, 100
  );
  v_primary_id := (v_primary->>'provider_id')::uuid;

  v_fallback := public.platform_ai_save_provider(
    v_actor, NULL, 'Delete fixture fallback', 'openai_compatible',
    'delete-fixture-fallback', 'https://delete-fixture.example.com/v1', NULL,
    'synthetic-delete-fallback-credential-123456789', 0, 0, 100
  );
  v_fallback_id := (v_fallback->>'provider_id')::uuid;

  v_unused := public.platform_ai_save_provider(
    v_actor, NULL, 'Delete fixture unused', 'openai_compatible',
    'delete-fixture-unused', 'https://delete-fixture.example.com/v1', NULL,
    'synthetic-delete-unused-credential-123456789', 0, 0, 100
  );
  v_unused_id := (v_unused->>'provider_id')::uuid;

  SELECT vault_secret_id INTO v_primary_secret
  FROM public.platform_ai_providers WHERE id = v_primary_id;
  SELECT vault_secret_id INTO v_fallback_secret
  FROM public.platform_ai_providers WHERE id = v_fallback_id;
  SELECT vault_secret_id INTO v_unused_secret
  FROM public.platform_ai_providers WHERE id = v_unused_id;

  -- Isolate this transaction from real providers and tenants.
  UPDATE public.platform_ai_providers
  SET is_enabled = false, is_primary = false
  WHERE id NOT IN (v_primary_id, v_fallback_id, v_unused_id);

  PERFORM public.platform_ai_record_provider_test_result(
    v_actor, v_primary_id, 'connected', NULL, NULL, NULL, NULL, false, NULL
  );
  PERFORM public.platform_ai_record_provider_test_result(
    v_actor, v_fallback_id, 'connected', NULL, NULL, NULL, NULL, false, NULL
  );
  PERFORM public.platform_ai_record_provider_test_result(
    v_actor, v_unused_id, 'connected', NULL, NULL, NULL, NULL, false, NULL
  );

  PERFORM public.platform_ai_set_primary_provider(v_actor, v_primary_id);
  PERFORM public.platform_ai_set_provider_priority(v_actor, v_fallback_id, 10);
  PERFORM public.platform_ai_set_provider_priority(v_actor, v_unused_id, 20);
  PERFORM public.platform_ai_set_tenant_providers(
    v_actor, v_tenant, ARRAY[v_primary_id, v_fallback_id]
  );
  PERFORM public.platform_ai_set_global_enabled(v_actor, true);
  PERFORM public.platform_ai_set_tenant_settings(
    v_actor, v_tenant, true, '{"assistant":true}'::jsonb
  );

  INSERT INTO public.platform_ai_usage (
    tenant_id, provider_id, actor_id, feature, model, status,
    input_tokens, output_tokens, estimated_cost_usd
  ) VALUES
    (v_tenant, v_primary_id, v_actor, 'assistant', 'delete-fixture-primary', 'success', 10, 5, 0.01),
    (v_tenant, v_fallback_id, v_actor, 'assistant', 'delete-fixture-fallback', 'success', 10, 5, 0.01),
    (v_tenant, v_unused_id, v_actor, 'assistant', 'delete-fixture-unused', 'success', 10, 5, 0.01);

  -- Removing a non-primary provider must not disturb the current primary.
  v_result := public.platform_ai_delete_provider(v_actor, v_unused_id);

  SELECT model, enabled, status
  INTO v_configuration_model, v_configuration_enabled, v_configuration_status
  FROM public.platform_ai_configuration
  WHERE id = 1;

  SELECT is_primary INTO v_provider_primary
  FROM public.platform_ai_providers WHERE id = v_primary_id;

  SELECT count(*) INTO v_secret_count
  FROM vault.secrets WHERE id = v_unused_secret;

  IF v_result->>'deleted' IS DISTINCT FROM 'true'
    OR v_configuration_model IS DISTINCT FROM 'delete-fixture-primary'
    OR v_configuration_enabled IS DISTINCT FROM true
    OR v_configuration_status IS DISTINCT FROM 'connected'
    OR v_provider_primary IS DISTINCT FROM true
    OR v_secret_count <> 0
  THEN
    RAISE EXCEPTION 'Deleting a non-primary provider changed the active primary or failed to remove its secret.';
  END IF;

  -- Removing the primary must promote the connected alternative automatically.
  v_result := public.platform_ai_delete_provider(v_actor, v_primary_id);

  SELECT model, enabled, status
  INTO v_configuration_model, v_configuration_enabled, v_configuration_status
  FROM public.platform_ai_configuration
  WHERE id = 1;

  SELECT is_primary INTO v_provider_primary
  FROM public.platform_ai_providers WHERE id = v_fallback_id;

  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings WHERE tenant_id = v_tenant;

  SELECT count(*) INTO v_secret_count
  FROM vault.secrets WHERE id = v_primary_secret;

  IF v_result->>'primary_replaced' IS DISTINCT FROM 'true'
    OR v_configuration_model IS DISTINCT FROM 'delete-fixture-fallback'
    OR v_configuration_enabled IS DISTINCT FROM true
    OR v_configuration_status IS DISTINCT FROM 'connected'
    OR v_provider_primary IS DISTINCT FROM true
    OR v_tenant_enabled IS DISTINCT FROM true
    OR v_secret_count <> 0
  THEN
    RAISE EXCEPTION 'Deleting the primary failed to promote the connected fallback or preserve tenant access.';
  END IF;

  -- Removing the last connected provider must safely disable AI and clear the global secret reference.
  v_result := public.platform_ai_delete_provider(v_actor, v_fallback_id);

  SELECT model, vault_secret_id, enabled, status
  INTO v_configuration_model, v_primary_secret, v_configuration_enabled, v_configuration_status
  FROM public.platform_ai_configuration
  WHERE id = 1;

  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings WHERE tenant_id = v_tenant;

  SELECT count(*) INTO v_provider_count
  FROM public.platform_ai_providers
  WHERE id IN (v_primary_id, v_fallback_id, v_unused_id);

  SELECT count(*) INTO v_usage_count
  FROM public.platform_ai_usage
  WHERE model LIKE 'delete-fixture-%';

  SELECT count(*) INTO v_usage_unlinked
  FROM public.platform_ai_usage
  WHERE model LIKE 'delete-fixture-%' AND provider_id IS NULL;

  SELECT count(*) INTO v_secret_count
  FROM vault.secrets
  WHERE id IN (v_primary_secret, v_primary_secret, v_fallback_secret, v_unused_secret);

  IF v_result->>'global_disabled' IS DISTINCT FROM 'true'
    OR v_configuration_model IS NOT NULL
    OR v_primary_secret IS NOT NULL
    OR v_configuration_enabled IS DISTINCT FROM false
    OR v_configuration_status IS DISTINCT FROM 'not_configured'
    OR v_tenant_enabled IS DISTINCT FROM false
    OR v_provider_count <> 0
    OR v_usage_count <> 3
    OR v_usage_unlinked <> 3
    OR v_secret_count <> 0
  THEN
    RAISE EXCEPTION 'Deleting the last provider failed to disable AI, remove credentials, or preserve usage history.';
  END IF;
END
$test$;

ROLLBACK;
