BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_tenant uuid;
  v_saved jsonb;
  v_primary_id uuid;
  v_fallback_id uuid;
  v_isolated_id uuid;
  v_secret text;
  v_primary_after uuid;
  v_global_enabled boolean;
  v_tenant_enabled boolean;
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

  v_saved := public.platform_ai_save_provider(
    v_actor, NULL, 'Primary fixture rollback', 'openai',
    'test-primary', NULL, NULL,
    'synthetic-primary-fixture-credential-123456',
    0.10, 0.40, 100
  );
  v_primary_id := (v_saved->>'provider_id')::uuid;

  v_saved := public.platform_ai_save_provider(
    v_actor, NULL, 'Fallback fixture rollback', 'openai',
    'test-fallback', NULL, NULL,
    'synthetic-fallback-fixture-credential-123456',
    0.20, 0.80, 20
  );
  v_fallback_id := (v_saved->>'provider_id')::uuid;

  v_saved := public.platform_ai_save_provider(
    v_actor, NULL, 'Isolated fixture rollback', 'openai',
    'test-isolated', NULL, NULL,
    'synthetic-isolated-fixture-credential-123456',
    0.30, 1.20, 30
  );
  v_isolated_id := (v_saved->>'provider_id')::uuid;

  v_secret := public.platform_ai_get_provider_api_key(v_primary_id);
  IF v_secret <> 'synthetic-primary-fixture-credential-123456' THEN
    RAISE EXCEPTION 'Vault credential round-trip failed.';
  END IF;

  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_primary_id, 'connected');
  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_fallback_id, 'connected');
  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_isolated_id, 'connected');
  PERFORM public.platform_ai_set_primary_provider(v_actor, v_primary_id);
  PERFORM public.platform_ai_set_global_enabled(v_actor, true);

  -- A failed non-primary provider must disable a tenant when it was the only
  -- provider authorized for that tenant.
  PERFORM public.platform_ai_set_tenant_providers(v_actor, v_tenant, ARRAY[v_isolated_id]);
  PERFORM public.platform_ai_set_tenant_settings(
    v_actor, v_tenant, true, '{"assistant":true}'::jsonb
  );
  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_isolated_id, 'failed');

  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings
  WHERE tenant_id = v_tenant;
  IF v_tenant_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Tenant remained enabled after its only authorized non-primary provider failed.';
  END IF;

  -- A failed primary must promote an authorized fallback and keep that tenant online.
  PERFORM public.platform_ai_set_tenant_providers(
    v_actor, v_tenant, ARRAY[v_primary_id, v_fallback_id]
  );
  PERFORM public.platform_ai_set_tenant_settings(
    v_actor, v_tenant, true, '{"assistant":true}'::jsonb
  );
  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_primary_id, 'failed');

  SELECT id INTO v_primary_after
  FROM public.platform_ai_providers
  WHERE is_primary = true;
  SELECT enabled INTO v_global_enabled
  FROM public.platform_ai_configuration
  WHERE id = 1;
  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings
  WHERE tenant_id = v_tenant;

  IF v_primary_after IS DISTINCT FROM v_fallback_id
    OR v_global_enabled IS DISTINCT FROM true
    OR v_tenant_enabled IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'Primary failure did not preserve service through the authorized fallback.';
  END IF;

  -- If the last healthy provider fails, both global and tenant AI must stop.
  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_fallback_id, 'failed');
  SELECT enabled INTO v_global_enabled
  FROM public.platform_ai_configuration
  WHERE id = 1;
  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings
  WHERE tenant_id = v_tenant;

  IF v_global_enabled IS DISTINCT FROM false OR v_tenant_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AI remained enabled after all authorized providers failed.';
  END IF;
END
$test$;

ROLLBACK;
