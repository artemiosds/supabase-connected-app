BEGIN;

-- Frente 7: Outbox e trilha de auditoria idempotente para alertas de cobrança, trial e cotas.
CREATE TABLE public.platform_commercial_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.platform_invoices(id) ON DELETE CASCADE,
  alert_kind text NOT NULL CHECK (
    alert_kind IN (
      'invoice_upcoming',
      'invoice_overdue',
      'trial_expiring',
      'ai_quota_warning',
      'ai_quota_exceeded',
      'user_limit_warning',
      'user_limit_reached'
    )
  ),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium')),
  recipient_email text NOT NULL,
  recipient_scope text NOT NULL CHECK (recipient_scope IN ('tenant_billing', 'platform_admin')),
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_commercial_alerts_tenant_created
  ON public.platform_commercial_alerts (tenant_id, created_at DESC);

CREATE INDEX idx_platform_commercial_alerts_invoice
  ON public.platform_commercial_alerts (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX idx_platform_commercial_alerts_status_created
  ON public.platform_commercial_alerts (status, created_at DESC);

ALTER TABLE public.platform_commercial_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_commercial_alerts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_commercial_alerts FROM PUBLIC, anon;
GRANT SELECT ON public.platform_commercial_alerts TO authenticated;
GRANT ALL ON public.platform_commercial_alerts TO service_role;

CREATE POLICY p_platform_commercial_alerts_select
  ON public.platform_commercial_alerts
  FOR SELECT
  TO authenticated
  USING (app_auth.is_platform_admin());

-- Coleta todos os candidatos elegíveis ainda não enviados com sucesso para a chave de deduplicação.
CREATE OR REPLACE FUNCTION public.list_platform_commercial_alert_candidates(
  p_today date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_month_key text;
  v_admin_emails text[];
  v_candidates jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao Administrador Master ativo.' USING ERRCODE = '42501';
  END IF;

  v_month_key := to_char(p_today, 'YYYY-MM');
  v_month_start := date_trunc('month', p_today::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  v_month_end := (date_trunc('month', p_today::timestamp) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  SELECT COALESCE(
    array_agg(DISTINCT lower(btrim(u.email))) FILTER (WHERE u.email IS NOT NULL AND btrim(u.email) <> ''),
    ARRAY[]::text[]
  )
  INTO v_admin_emails
  FROM public.platform_admins pa
  JOIN auth.users u ON u.id = pa.user_id
  WHERE pa.is_active = true
    AND u.email_confirmed_at IS NOT NULL;

  WITH raw_candidates AS (
    -- 1. Faturas pendentes vencendo em até 5 dias
    SELECT
      t.id AS tenant_id,
      COALESCE(NULLIF(btrim(t.trade_name), ''), t.name) AS tenant_name,
      inv.id AS invoice_id,
      'invoice_upcoming'::text AS alert_kind,
      'medium'::text AS severity,
      COALESCE(NULLIF(lower(btrim(t.billing_email)), ''), NULLIF(lower(btrim(t.contact_email)), '')) AS recipient_email,
      'tenant_billing'::text AS recipient_scope,
      ('invoice_upcoming:' || inv.id::text || ':' || inv.due_date::text) AS dedupe_key,
      jsonb_build_object(
        'reference_month', inv.reference_month,
        'amount', inv.amount,
        'due_date', inv.due_date::text,
        'payment_url', inv.payment_url
      ) AS metadata
    FROM public.platform_invoices inv
    JOIN public.tenants t ON t.id = inv.tenant_id
    WHERE inv.status = 'pending'
      AND inv.due_date BETWEEN p_today AND (p_today + 5)
      AND t.commercial_status IN ('active', 'trial')

    UNION ALL

    -- 2. Faturas vencidas (status overdue ou pending já vencida)
    SELECT
      t.id AS tenant_id,
      COALESCE(NULLIF(btrim(t.trade_name), ''), t.name) AS tenant_name,
      inv.id AS invoice_id,
      'invoice_overdue'::text AS alert_kind,
      'critical'::text AS severity,
      COALESCE(NULLIF(lower(btrim(t.billing_email)), ''), NULLIF(lower(btrim(t.contact_email)), '')) AS recipient_email,
      'tenant_billing'::text AS recipient_scope,
      ('invoice_overdue:' || inv.id::text || ':' || v_month_key) AS dedupe_key,
      jsonb_build_object(
        'reference_month', inv.reference_month,
        'amount', inv.amount,
        'due_date', inv.due_date::text,
        'days_overdue', (p_today - inv.due_date),
        'payment_url', inv.payment_url
      ) AS metadata
    FROM public.platform_invoices inv
    JOIN public.tenants t ON t.id = inv.tenant_id
    WHERE (inv.status = 'overdue' OR (inv.status = 'pending' AND inv.due_date < p_today))
      AND t.commercial_status IN ('active', 'trial', 'blocked_billing')

    UNION ALL

    -- 3. Período trial encerrando em até 3 dias
    SELECT
      t.id AS tenant_id,
      COALESCE(NULLIF(btrim(t.trade_name), ''), t.name) AS tenant_name,
      NULL::uuid AS invoice_id,
      'trial_expiring'::text AS alert_kind,
      'high'::text AS severity,
      COALESCE(NULLIF(lower(btrim(t.billing_email)), ''), NULLIF(lower(btrim(t.contact_email)), '')) AS recipient_email,
      'tenant_billing'::text AS recipient_scope,
      ('trial_expiring:' || t.id::text || ':' || (t.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date::text) AS dedupe_key,
      jsonb_build_object(
        'plan_tier', t.plan_tier,
        'trial_ends_on', (t.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date::text,
        'days_remaining', ((t.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date - p_today)
      ) AS metadata
    FROM public.tenants t
    WHERE t.commercial_status = 'trial'
      AND t.trial_ends_at IS NOT NULL
      AND (t.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_today AND (p_today + 3)

    UNION ALL

    -- 4. Cota mensal de IA >= 80% ou >= 100%
    SELECT
      t.id AS tenant_id,
      COALESCE(NULLIF(btrim(t.trade_name), ''), t.name) AS tenant_name,
      NULL::uuid AS invoice_id,
      CASE WHEN exceeded THEN 'ai_quota_exceeded' ELSE 'ai_quota_warning' END AS alert_kind,
      CASE WHEN exceeded THEN 'critical' ELSE 'high' END AS severity,
      COALESCE(NULLIF(lower(btrim(t.contact_email)), ''), v_admin_emails[1]) AS recipient_email,
      'platform_admin'::text AS recipient_scope,
      (CASE WHEN exceeded THEN 'ai_quota_exceeded:' ELSE 'ai_quota_warning:' END || t.id::text || ':' || v_month_key) AS dedupe_key,
      jsonb_build_object(
        'reference_month', v_month_key,
        'used_cost_usd', used_cost_usd,
        'budget_usd', monthly_budget_usd,
        'used_tokens', used_tokens,
        'token_limit', monthly_token_limit,
        'admin_emails', to_jsonb(v_admin_emails)
      ) AS metadata
    FROM (
      SELECT
        ais.tenant_id,
        ais.monthly_budget_usd,
        ais.monthly_token_limit,
        COALESCE(SUM(u.estimated_cost_usd), 0)::numeric AS used_cost_usd,
        COALESCE(SUM(COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0)), 0)::bigint AS used_tokens,
        (
          (ais.monthly_budget_usd IS NOT NULL AND ais.monthly_budget_usd > 0 AND COALESCE(SUM(u.estimated_cost_usd), 0) >= ais.monthly_budget_usd)
          OR (ais.monthly_token_limit IS NOT NULL AND ais.monthly_token_limit > 0 AND COALESCE(SUM(COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0)), 0) >= ais.monthly_token_limit)
        ) AS exceeded,
        (
          (ais.monthly_budget_usd IS NOT NULL AND ais.monthly_budget_usd > 0 AND COALESCE(SUM(u.estimated_cost_usd), 0) >= ais.monthly_budget_usd * 0.8)
          OR (ais.monthly_token_limit IS NOT NULL AND ais.monthly_token_limit > 0 AND COALESCE(SUM(COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0)), 0) >= ais.monthly_token_limit * 0.8)
        ) AS near_limit
      FROM public.tenant_ai_settings ais
      LEFT JOIN public.platform_ai_usage u
        ON u.tenant_id = ais.tenant_id
        AND u.status = 'success'
        AND u.created_at >= v_month_start
        AND u.created_at < v_month_end
      WHERE ais.enabled = true
        AND (ais.monthly_budget_usd IS NOT NULL OR ais.monthly_token_limit IS NOT NULL)
      GROUP BY ais.tenant_id, ais.monthly_budget_usd, ais.monthly_token_limit
    ) ai_stats
    JOIN public.tenants t ON t.id = ai_stats.tenant_id
    WHERE t.commercial_status IN ('active', 'trial')
      AND (ai_stats.exceeded OR ai_stats.near_limit)

    UNION ALL

    -- 5. Limite de usuários ativos >= 80% ou >= 100%
    SELECT
      t.id AS tenant_id,
      COALESCE(NULLIF(btrim(t.trade_name), ''), t.name) AS tenant_name,
      NULL::uuid AS invoice_id,
      CASE WHEN active_users >= t.max_users THEN 'user_limit_reached' ELSE 'user_limit_warning' END AS alert_kind,
      CASE WHEN active_users >= t.max_users THEN 'high' ELSE 'medium' END AS severity,
      COALESCE(NULLIF(lower(btrim(t.contact_email)), ''), v_admin_emails[1]) AS recipient_email,
      'platform_admin'::text AS recipient_scope,
      (CASE WHEN active_users >= t.max_users THEN 'user_limit_reached:' ELSE 'user_limit_warning:' END || t.id::text || ':' || v_month_key) AS dedupe_key,
      jsonb_build_object(
        'reference_month', v_month_key,
        'active_users', active_users,
        'max_users', t.max_users,
        'admin_emails', to_jsonb(v_admin_emails)
      ) AS metadata
    FROM public.tenants t
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS active_users
      FROM public.tenant_memberships tm
      WHERE tm.tenant_id = t.id
        AND tm.status = 'active'
    ) m
    WHERE t.commercial_status IN ('active', 'trial')
      AND t.max_users > 0
      AND m.active_users >= ceil(t.max_users * 0.8)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'tenant_id', rc.tenant_id,
        'tenant_name', rc.tenant_name,
        'invoice_id', rc.invoice_id,
        'alert_kind', rc.alert_kind,
        'severity', rc.severity,
        'recipient_email', rc.recipient_email,
        'recipient_scope', rc.recipient_scope,
        'dedupe_key', rc.dedupe_key,
        'metadata', rc.metadata
      )
      ORDER BY
        CASE rc.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
        rc.tenant_name
    ),
    '[]'::jsonb
  )
  INTO v_candidates
  FROM raw_candidates rc
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.platform_commercial_alerts existing
    WHERE existing.dedupe_key = rc.dedupe_key
      AND existing.status = 'sent'
  );

  RETURN v_candidates;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_commercial_alert_candidates(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_commercial_alert_candidates(date) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_platform_commercial_alert_candidates(date) IS
  'Lista candidatos idempotentes de alertas comerciais (faturas a vencer/vencidas, trial expirando, cota de IA e limite de usuários).';

COMMIT;
