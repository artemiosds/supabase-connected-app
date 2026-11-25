BEGIN;

-- Fase 6 — Monitoramento inteligente e telemetria de segurança (somente leitura agregada).
-- Retorna apenas contadores e tipos de eventos sem expor credenciais, tokens, senhas ou PII.
CREATE OR REPLACE FUNCTION public.get_platform_security_signals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admins_total integer := 0;
  v_admins_with_mfa integer := 0;
  v_tables_without_rls integer := 0;
  v_tables_without_force_rls integer := 0;
  v_access_denied_24h integer := 0;
  v_access_denied_7d integer := 0;
  v_priv_changes_24h integer := 0;
  v_priv_changes_7d integer := 0;
  v_ai_failures_24h integer := 0;
  v_ai_total_24h integer := 0;
  v_ai_failures_7d integer := 0;
  v_active_support_sessions integer := 0;
  v_recent_sensitive jsonb := '[]'::jsonb;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao Administrador Master ativo.' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM auth.mfa_factors mf
        WHERE mf.user_id = pa.user_id
          AND mf.status = 'verified'
      )
    )::integer
  INTO v_admins_total, v_admins_with_mfa
  FROM public.platform_admins pa
  WHERE pa.is_active = true;

  SELECT
    count(*) FILTER (WHERE NOT c.relrowsecurity)::integer,
    count(*) FILTER (WHERE NOT c.relforcerowsecurity)::integer
  INTO v_tables_without_rls, v_tables_without_force_rls
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r';

  SELECT
    count(*) FILTER (
      WHERE ae.action = 'ACCESS_DENIED'
        AND ae.created_at >= now() - interval '24 hours'
    )::integer,
    count(*) FILTER (
      WHERE ae.action = 'ACCESS_DENIED'
    )::integer,
    count(*) FILTER (
      WHERE ae.created_at >= now() - interval '24 hours'
        AND (
          ae.entity IN (
            'platform_admins',
            'platform_staff_members',
            'platform_support_agents',
            'membership_roles',
            'tenant_roles',
            'tenant_role_permissions'
          )
          OR ae.action ILIKE '%ROLE%'
          OR ae.action ILIKE '%STAFF%'
        )
    )::integer,
    count(*) FILTER (
      WHERE ae.entity IN (
        'platform_admins',
        'platform_staff_members',
        'platform_support_agents',
        'membership_roles',
        'tenant_roles',
        'tenant_role_permissions'
      )
      OR ae.action ILIKE '%ROLE%'
      OR ae.action ILIKE '%STAFF%'
    )::integer
  INTO
    v_access_denied_24h,
    v_access_denied_7d,
    v_priv_changes_24h,
    v_priv_changes_7d
  FROM public.audit_events ae
  WHERE ae.created_at >= now() - interval '7 days';

  SELECT
    count(*) FILTER (
      WHERE u.status = 'failed'
        AND u.created_at >= now() - interval '24 hours'
    )::integer,
    count(*) FILTER (
      WHERE u.created_at >= now() - interval '24 hours'
    )::integer,
    count(*) FILTER (
      WHERE u.status = 'failed'
    )::integer
  INTO v_ai_failures_24h, v_ai_total_24h, v_ai_failures_7d
  FROM public.platform_ai_usage u
  WHERE u.created_at >= now() - interval '7 days';

  SELECT count(*)::integer
  INTO v_active_support_sessions
  FROM public.platform_support_sessions s
  WHERE s.ended_at IS NULL
    AND s.expires_at > now();

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sub.id,
        'action', sub.action,
        'entity', sub.entity,
        'tenant_id', sub.tenant_id,
        'created_at', sub.created_at
      )
      ORDER BY sub.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_recent_sensitive
  FROM (
    SELECT ae.id, ae.action, ae.entity, ae.tenant_id, ae.created_at
    FROM public.audit_events ae
    WHERE ae.action = 'ACCESS_DENIED'
      OR ae.entity IN (
        'platform_admins',
        'platform_staff_members',
        'platform_support_agents',
        'platform_payment_integrations',
        'membership_roles',
        'tenant_roles',
        'tenant_role_permissions',
        'google_drive'
      )
    ORDER BY ae.created_at DESC
    LIMIT 12
  ) sub;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'mfa', jsonb_build_object(
      'platform_admins_total', v_admins_total,
      'platform_admins_with_mfa', v_admins_with_mfa
    ),
    'rls', jsonb_build_object(
      'tables_without_rls', v_tables_without_rls,
      'tables_without_force_rls', v_tables_without_force_rls
    ),
    'events_24h', jsonb_build_object(
      'access_denied', v_access_denied_24h,
      'privilege_changes', v_priv_changes_24h,
      'ai_failures', v_ai_failures_24h,
      'ai_total_requests', v_ai_total_24h
    ),
    'events_7d', jsonb_build_object(
      'access_denied', v_access_denied_7d,
      'privilege_changes', v_priv_changes_7d,
      'ai_failures', v_ai_failures_7d
    ),
    'active_support_sessions', v_active_support_sessions,
    'recent_sensitive_events', v_recent_sensitive
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_security_signals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_security_signals() TO authenticated;

COMMENT ON FUNCTION public.get_platform_security_signals() IS
  'Telemetria agregada de cibersegurança para monitoramento contínuo do Administrador Master ativo (sem credenciais ou PII).';

COMMIT;
