-- Activation and feature-permission smoke test using existing connected providers.
-- Every change, audit row and claim is rolled back; no model API is invoked.
BEGIN;

DO $activation$
DECLARE
  v_admin uuid;
  v_tenant uuid;
  v_member uuid;
  v_provider uuid;
  v_flags jsonb;
  v_name text;
  v_claimed boolean;
  v_ready boolean;
BEGIN
  SELECT user_id INTO v_admin
  FROM public.platform_admins WHERE is_active = true LIMIT 1;

  SELECT id INTO v_tenant
  FROM public.tenants
  WHERE status = 'active'
    AND (
      commercial_status = 'active'
      OR (
        commercial_status = 'trial' AND trial_starts_at <= pg_catalog.now()
        AND trial_ends_at > pg_catalog.now()
      )
    ) LIMIT 1;

  SELECT user_id INTO v_member
  FROM public.tenant_memberships
  WHERE tenant_id = v_tenant AND status = 'active' LIMIT 1;

  SELECT p.id INTO v_provider
  FROM public.platform_ai_providers p
  JOIN public.platform_ai_tenant_provider_access a
    ON a.provider_id = p.id
  WHERE a.tenant_id = v_tenant
    AND a.is_allowed = true
    AND p.status = 'connected' AND p.is_enabled = true
  ORDER BY p.created_at LIMIT 1;

  IF v_admin IS NULL OR v_tenant IS NULL OR v_member IS NULL OR v_provider IS NULL THEN
    RAISE EXCEPTION 'Missing connected authorized provider, active tenant or test principal.';
  END IF;

  v_flags := '{
    "assistant": true,
    "documents": true,
    "price_research": true,
    "supplier_documents": true,
    "contract_monitoring": true,
    "delivery_receiving": true,
    "tasks": true,
    "email_alerts": true
  }'::jsonb;

  -- Capabilities must be configurable while the global AI switch is off.
  PERFORM public.platform_ai_set_tenant_settings(v_admin, v_tenant, false, v_flags);
  IF NOT EXISTS(
    SELECT 1 FROM public.tenant_ai_settings
    WHERE tenant_id = v_tenant
      AND enabled = false
      AND features @> v_flags
  ) THEN RAISE EXCEPTION 'Offline feature configuration did not persist.'; END IF;

  PERFORM public.platform_ai_set_primary_provider(v_admin, v_provider);
  PERFORM public.platform_ai_set_global_enabled(v_admin, true);
  PERFORM public.platform_ai_set_tenant_settings(v_admin, v_tenant, true, v_flags);

  SELECT c.enabled AND c.status = 'connected'
    AND s.enabled AND s.features @> v_flags
    AND EXISTS(
      SELECT 1
      FROM public.platform_ai_tenant_provider_access a
      JOIN public.platform_ai_providers p ON p.id = a.provider_id
      WHERE a.tenant_id = v_tenant
        AND a.is_allowed = true
        AND p.is_enabled = true
        AND p.status = 'connected'
    )
  INTO v_ready
  FROM public.platform_ai_configuration c
  JOIN public.tenant_ai_settings s ON s.tenant_id = v_tenant
  WHERE c.id = 1;

  IF v_ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Tenant activation preconditions were not satisfied.';
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'assistant','documents','price_research','supplier_documents',
    'contract_monitoring','delivery_receiving','tasks','email_alerts'
  ] LOOP
    SELECT public.platform_ai_claim_usage(v_tenant, v_member, v_name) INTO v_claimed;
    IF v_claimed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Feature % could not claim its permitted usage.', v_name;
    END IF;
  END LOOP;
END;
$activation$;

ROLLBACK;
