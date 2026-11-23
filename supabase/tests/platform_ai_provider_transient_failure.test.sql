BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_tenant uuid;
  v_saved jsonb;
  v_provider_id uuid;
  v_provider_status text;
  v_provider_enabled boolean;
  v_provider_primary boolean;
  v_access_allowed boolean;
  v_tenant_enabled boolean;
  v_global_enabled boolean;
  v_error text;
  v_http_status integer;
  v_retryable boolean;
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
    v_actor,
    NULL,
    'Transient failure fixture rollback',
    'openai_compatible',
    'test-transient',
    'https://transient-fixture.example.com/v1',
    NULL,
    'synthetic-transient-fixture-credential-123456',
    0,
    0,
    100
  );
  v_provider_id := (v_saved->>'provider_id')::uuid;

  -- Isolate this fixture from any real provider so the permanent-failure
  -- assertion deterministically exercises the no-fallback branch.
  UPDATE public.platform_ai_providers
  SET is_enabled = false, is_primary = false
  WHERE id <> v_provider_id;

  PERFORM public.platform_ai_update_provider_test_status(v_actor, v_provider_id, 'connected');
  PERFORM public.platform_ai_set_primary_provider(v_actor, v_provider_id);
  PERFORM public.platform_ai_set_tenant_providers(v_actor, v_tenant, ARRAY[v_provider_id]);
  PERFORM public.platform_ai_set_global_enabled(v_actor, true);
  PERFORM public.platform_ai_set_tenant_settings(
    v_actor, v_tenant, true, '{"assistant":true}'::jsonb
  );

  PERFORM public.platform_ai_record_provider_test_result(
    v_actor,
    v_provider_id,
    'transient_error',
    'Rate limit exceeded',
    429,
    'rate_limited',
    'rate_limit_exceeded',
    true,
    '30'
  );

  SELECT status, is_enabled, is_primary, last_test_error,
         last_test_http_status, last_test_retryable
  INTO v_provider_status, v_provider_enabled, v_provider_primary, v_error,
       v_http_status, v_retryable
  FROM public.platform_ai_providers
  WHERE id = v_provider_id;

  SELECT is_allowed INTO v_access_allowed
  FROM public.platform_ai_tenant_provider_access
  WHERE tenant_id = v_tenant AND provider_id = v_provider_id;

  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings
  WHERE tenant_id = v_tenant;

  SELECT enabled INTO v_global_enabled
  FROM public.platform_ai_configuration
  WHERE id = 1;

  IF v_provider_status <> 'connected'
    OR v_provider_enabled IS DISTINCT FROM true
    OR v_provider_primary IS DISTINCT FROM true
    OR v_access_allowed IS DISTINCT FROM true
    OR v_tenant_enabled IS DISTINCT FROM true
    OR v_global_enabled IS DISTINCT FROM true
    OR v_error <> 'Rate limit exceeded'
    OR v_http_status <> 429
    OR v_retryable IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'Transient 429 incorrectly disabled the provider or failed to persist diagnostics.';
  END IF;

  PERFORM public.platform_ai_record_provider_test_result(
    v_actor,
    v_provider_id,
    'failed',
    'Invalid API key',
    401,
    'invalid_api_key',
    'authentication_error',
    false,
    NULL
  );

  SELECT status, is_enabled, is_primary
  INTO v_provider_status, v_provider_enabled, v_provider_primary
  FROM public.platform_ai_providers
  WHERE id = v_provider_id;

  SELECT is_allowed INTO v_access_allowed
  FROM public.platform_ai_tenant_provider_access
  WHERE tenant_id = v_tenant AND provider_id = v_provider_id;

  SELECT enabled INTO v_tenant_enabled
  FROM public.tenant_ai_settings
  WHERE tenant_id = v_tenant;

  SELECT enabled INTO v_global_enabled
  FROM public.platform_ai_configuration
  WHERE id = 1;

  IF v_provider_status <> 'failed'
    OR v_provider_enabled IS DISTINCT FROM false
    OR v_provider_primary IS DISTINCT FROM false
    OR v_access_allowed IS DISTINCT FROM false
    OR v_tenant_enabled IS DISTINCT FROM false
    OR v_global_enabled IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'Permanent 401 did not disable the invalid provider and its dependent access.';
  END IF;
END
$test$;

ROLLBACK;
