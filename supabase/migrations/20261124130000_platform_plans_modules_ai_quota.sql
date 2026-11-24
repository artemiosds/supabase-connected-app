-- =============================================================================
-- Frente 3 (Painel Master): Catálogo de Planos Configuráveis, Novos Módulos
-- (relatorios, pca) e Cota Mensal de IA por Secretaria
-- =============================================================================

-- 1. Tabela de planos comerciais configuráveis pela plataforma
CREATE TABLE IF NOT EXISTS public.platform_plans (
  id text PRIMARY KEY CHECK (id IN ('basico', 'profissional', 'enterprise', 'consorcio')),
  name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '',
  default_monthly_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (default_monthly_fee >= 0),
  default_max_users integer NOT NULL DEFAULT 20 CHECK (default_max_users >= 1 AND default_max_users <= 10000),
  default_ai_monthly_budget_usd numeric(12, 4)
    CHECK (default_ai_monthly_budget_usd IS NULL OR default_ai_monthly_budget_usd >= 0),
  default_ai_monthly_token_limit bigint
    CHECK (default_ai_monthly_token_limit IS NULL OR default_ai_monthly_token_limit >= 0),
  default_modules jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT platform_plans_default_modules_check CHECK (
    pg_catalog.jsonb_typeof(default_modules) = 'object'
    AND pg_catalog.jsonb_typeof(default_modules->'fornecedores') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'documentos') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'processos') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'contratos') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'modelos') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'ged') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'auditoria') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'relatorios') = 'boolean'
    AND pg_catalog.jsonb_typeof(default_modules->'pca') = 'boolean'
    AND (
      default_modules - ARRAY[
        'fornecedores', 'documentos', 'processos', 'contratos',
        'modelos', 'ged', 'auditoria', 'relatorios', 'pca'
      ]::text[]
    ) = '{}'::jsonb
  )
);

ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_plans FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_plans TO authenticated;

DROP POLICY IF EXISTS p_platform_plans_master_select ON public.platform_plans;
CREATE POLICY p_platform_plans_master_select
  ON public.platform_plans
  FOR SELECT
  TO authenticated
  USING (app_auth.is_platform_admin());

INSERT INTO public.platform_plans (
  id,
  name,
  description,
  default_monthly_fee,
  default_max_users,
  default_ai_monthly_budget_usd,
  default_ai_monthly_token_limit,
  default_modules,
  sort_order,
  is_active
)
VALUES
  (
    'basico',
    'Básico',
    'Essencial para pequenas secretarias iniciarem o controle de fornecedores e processos.',
    990.00,
    10,
    10.0000,
    2000000,
    '{"fornecedores": true, "documentos": true, "processos": true, "contratos": true, "modelos": false, "ged": false, "auditoria": true, "relatorios": true, "pca": false}'::jsonb,
    1,
    true
  ),
  (
    'profissional',
    'Profissional',
    'Plano padrão completo com modelos oficiais, PCA e central de relatórios & BI.',
    1990.00,
    25,
    30.0000,
    8000000,
    '{"fornecedores": true, "documentos": true, "processos": true, "contratos": true, "modelos": true, "ged": false, "auditoria": true, "relatorios": true, "pca": true}'::jsonb,
    2,
    true
  ),
  (
    'enterprise',
    'Enterprise',
    'Operação avançada com GED completo, maior limite de usuários e cota ampliada de IA.',
    3990.00,
    80,
    100.0000,
    30000000,
    '{"fornecedores": true, "documentos": true, "processos": true, "contratos": true, "modelos": true, "ged": true, "auditoria": true, "relatorios": true, "pca": true}'::jsonb,
    3,
    true
  ),
  (
    'consorcio',
    'Consórcio',
    'Estrutura dedicada para consórcios intermunicipais e redes com múltiplos gestores.',
    6500.00,
    200,
    200.0000,
    60000000,
    '{"fornecedores": true, "documentos": true, "processos": true, "contratos": true, "modelos": true, "ged": true, "auditoria": true, "relatorios": true, "pca": true}'::jsonb,
    4,
    true
  )
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_platform_plan(
  p_plan_id text,
  p_name text,
  p_description text,
  p_default_monthly_fee numeric,
  p_default_max_users integer,
  p_default_ai_monthly_budget_usd numeric,
  p_default_ai_monthly_token_limit bigint,
  p_default_modules jsonb,
  p_is_active boolean DEFAULT true
)
RETURNS public.platform_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.platform_plans;
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar planos comerciais.'
      USING ERRCODE = '42501';
  END IF;

  IF p_plan_id IS NULL OR p_plan_id NOT IN ('basico', 'profissional', 'enterprise', 'consorcio') THEN
    RAISE EXCEPTION 'Plano comercial inválido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_plans
  SET
    name = pg_catalog.btrim(p_name),
    description = COALESCE(pg_catalog.btrim(p_description), ''),
    default_monthly_fee = p_default_monthly_fee,
    default_max_users = p_default_max_users,
    default_ai_monthly_budget_usd = p_default_ai_monthly_budget_usd,
    default_ai_monthly_token_limit = p_default_ai_monthly_token_limit,
    default_modules = p_default_modules,
    is_active = COALESCE(p_is_active, true),
    updated_by = v_actor,
    updated_at = pg_catalog.now()
  WHERE id = p_plan_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Plano comercial não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL,
    v_actor,
    'PLATFORM_PLAN_UPDATED',
    'platform_plans',
    p_plan_id,
    pg_catalog.jsonb_build_object(
      'default_monthly_fee', v_row.default_monthly_fee,
      'default_max_users', v_row.default_max_users,
      'default_ai_monthly_budget_usd', v_row.default_ai_monthly_budget_usd,
      'default_ai_monthly_token_limit', v_row.default_ai_monthly_token_limit,
      'is_active', v_row.is_active
    ),
    pg_catalog.now()
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_platform_plan(
  text, text, text, numeric, integer, numeric, bigint, jsonb, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_platform_plan(
  text, text, text, numeric, integer, numeric, bigint, jsonb, boolean
) TO authenticated;

-- 2. Expandir módulos comerciais da plataforma (adicionando 'relatorios' e 'pca')
-- Mantendo compatibilidade retroativa com fixtures antigas que possuem apenas as 7 chaves originais.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_enabled_modules_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_enabled_modules_check CHECK (
  pg_catalog.jsonb_typeof(enabled_modules) = 'object'
  AND pg_catalog.jsonb_typeof(enabled_modules->'fornecedores') = 'boolean'
  AND pg_catalog.jsonb_typeof(enabled_modules->'documentos') = 'boolean'
  AND pg_catalog.jsonb_typeof(enabled_modules->'processos') = 'boolean'
  AND pg_catalog.jsonb_typeof(enabled_modules->'contratos') = 'boolean'
  AND pg_catalog.jsonb_typeof(enabled_modules->'modelos') = 'boolean'
  AND pg_catalog.jsonb_typeof(enabled_modules->'ged') = 'boolean'
  AND pg_catalog.jsonb_typeof(enabled_modules->'auditoria') = 'boolean'
  AND (NOT (enabled_modules ? 'relatorios') OR pg_catalog.jsonb_typeof(enabled_modules->'relatorios') = 'boolean')
  AND (NOT (enabled_modules ? 'pca') OR pg_catalog.jsonb_typeof(enabled_modules->'pca') = 'boolean')
  AND (
    enabled_modules - ARRAY[
      'fornecedores', 'documentos', 'processos', 'contratos',
      'modelos', 'ged', 'auditoria', 'relatorios', 'pca'
    ]::text[]
  ) = '{}'::jsonb
);

ALTER TABLE public.tenants
  ALTER COLUMN enabled_modules SET DEFAULT
    '{"fornecedores": true, "documentos": true, "processos": true, "contratos": true, "modelos": true, "ged": false, "auditoria": true, "relatorios": true, "pca": true}'::jsonb;

-- Garantir que os clientes já existentes em produção recebam relatorios = true e pca = true
-- (Desabilita temporariamente apenas a trigger de proteção de campos durante o backfill da migration)
ALTER TABLE public.tenants DISABLE TRIGGER trg_tenants_protect_fields;

UPDATE public.tenants
SET enabled_modules = enabled_modules
  || CASE WHEN NOT (enabled_modules ? 'relatorios') THEN '{"relatorios": true}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN NOT (enabled_modules ? 'pca') THEN '{"pca": true}'::jsonb ELSE '{}'::jsonb END
WHERE NOT (enabled_modules ? 'relatorios')
   OR NOT (enabled_modules ? 'pca');

ALTER TABLE public.tenants ENABLE TRIGGER trg_tenants_protect_fields;

CREATE OR REPLACE FUNCTION public.create_tenant_with_admin_commercial(
  p_name text,
  p_slug text,
  p_admin_user_id uuid,
  p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_tenant_id uuid;
  v_status text;
  v_plan text;
  v_modules jsonb;
  v_trial_start timestamptz;
  v_trial_end timestamptz;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o superadministrador global pode cadastrar clientes.';
  END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' THEN
    RAISE EXCEPTION 'Os dados institucionais e comerciais são obrigatórios.';
  END IF;

  v_status := COALESCE(NULLIF(p_details->>'commercial_status', ''), 'active');
  v_plan := COALESCE(NULLIF(p_details->>'plan_tier', ''), 'profissional');
  v_trial_start := NULLIF(p_details->>'trial_starts_at', '')::timestamptz;
  v_trial_end := NULLIF(p_details->>'trial_ends_at', '')::timestamptz;
  v_modules := COALESCE(
    p_details->'enabled_modules',
    '{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":false,"auditoria":true,"relatorios":true,"pca":true}'::jsonb
  );

  IF v_status NOT IN ('active', 'trial', 'blocked_billing', 'suspended', 'cancelled') THEN
    RAISE EXCEPTION 'Status comercial inválido.';
  END IF;
  IF v_plan NOT IN ('basico', 'profissional', 'enterprise', 'consorcio') THEN
    RAISE EXCEPTION 'Plano comercial inválido.';
  END IF;
  IF v_status = 'trial' AND (v_trial_start IS NULL OR v_trial_end IS NULL OR v_trial_start >= v_trial_end) THEN
    RAISE EXCEPTION 'Demonstração exige início e vencimento válidos.';
  END IF;
  IF jsonb_typeof(v_modules) <> 'object' THEN
    RAISE EXCEPTION 'A configuração de módulos precisa ser um objeto JSON.';
  END IF;

  v_result := public.create_tenant_with_admin(p_name, p_slug, p_admin_user_id);
  v_tenant_id := (v_result->>'tenant_id')::uuid;

  UPDATE public.tenants
  SET
    trade_name = NULLIF(pg_catalog.btrim(p_details->>'trade_name'), ''),
    cnpj = CASE
      WHEN NULLIF(pg_catalog.btrim(p_details->>'cnpj'), '') IS NULL THEN NULL
      ELSE public.normalize_cnpj(p_details->>'cnpj')
    END,
    municipality = NULLIF(pg_catalog.btrim(p_details->>'municipality'), ''),
    state = CASE
      WHEN NULLIF(pg_catalog.btrim(p_details->>'state'), '') IS NULL THEN NULL
      ELSE pg_catalog.upper(pg_catalog.btrim(p_details->>'state'))
    END,
    ibge_code = NULLIF(pg_catalog.btrim(p_details->>'ibge_code'), ''),
    manager_name = NULLIF(pg_catalog.btrim(p_details->>'manager_name'), ''),
    contact_email = NULLIF(pg_catalog.btrim(p_details->>'contact_email'), ''),
    contact_phone = NULLIF(pg_catalog.btrim(p_details->>'contact_phone'), ''),
    street = NULLIF(pg_catalog.btrim(p_details->>'street'), ''),
    commercial_status = v_status,
    plan_tier = v_plan,
    trial_starts_at = v_trial_start,
    trial_ends_at = v_trial_end,
    monthly_fee = COALESCE(NULLIF(p_details->>'monthly_fee', '')::numeric, 0),
    billing_day = COALESCE(NULLIF(p_details->>'billing_day', '')::integer, 10),
    billing_email = NULLIF(pg_catalog.btrim(p_details->>'billing_email'), ''),
    billing_contact = NULLIF(pg_catalog.btrim(p_details->>'billing_contact'), ''),
    enabled_modules = v_modules,
    max_users = COALESCE(NULLIF(p_details->>'max_users', '')::integer, 20),
    commercial_notes = NULLIF(pg_catalog.btrim(p_details->>'commercial_notes'), '')
  WHERE id = v_tenant_id;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'commercial_status', v_status,
    'plan_tier', v_plan
  );
END;
$function$;

-- 3. Cota mensal de IA por Secretaria em tenant_ai_settings + guardrail na claim_usage
ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS monthly_budget_usd numeric(12, 4)
    CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),
  ADD COLUMN IF NOT EXISTS monthly_token_limit bigint
    CHECK (monthly_token_limit IS NULL OR monthly_token_limit >= 0);

CREATE INDEX IF NOT EXISTS idx_platform_ai_usage_tenant_month_success
  ON public.platform_ai_usage (tenant_id, created_at DESC)
  WHERE status = 'success';

CREATE OR REPLACE FUNCTION public.list_platform_tenant_ai_limits()
RETURNS TABLE (
  tenant_id uuid,
  monthly_budget_usd numeric,
  monthly_token_limit bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode consultar cotas de IA.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.tenant_id,
    s.monthly_budget_usd,
    s.monthly_token_limit
  FROM public.tenant_ai_settings s;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_platform_tenant_ai_limits() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_platform_tenant_ai_limits() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_tenant_ai_limits(
  p_tenant_id uuid,
  p_monthly_budget_usd numeric DEFAULT NULL,
  p_monthly_token_limit bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar cotas de IA.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Secretaria não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_monthly_budget_usd IS NOT NULL AND p_monthly_budget_usd < 0 THEN
    RAISE EXCEPTION 'O orçamento mensal de IA não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_monthly_token_limit IS NOT NULL AND p_monthly_token_limit < 0 THEN
    RAISE EXCEPTION 'O limite mensal de tokens não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tenant_ai_settings (
    tenant_id,
    enabled,
    monthly_budget_usd,
    monthly_token_limit,
    updated_by,
    updated_at
  )
  VALUES (
    p_tenant_id,
    false,
    p_monthly_budget_usd,
    p_monthly_token_limit,
    v_actor,
    pg_catalog.now()
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET
    monthly_budget_usd = EXCLUDED.monthly_budget_usd,
    monthly_token_limit = EXCLUDED.monthly_token_limit,
    updated_by = v_actor,
    updated_at = pg_catalog.now();

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    p_tenant_id,
    v_actor,
    'TENANT_AI_LIMITS_UPDATED',
    'tenant_ai_settings',
    p_tenant_id::text,
    pg_catalog.jsonb_build_object(
      'monthly_budget_usd', p_monthly_budget_usd,
      'monthly_token_limit', p_monthly_token_limit
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id,
    'monthly_budget_usd', p_monthly_budget_usd,
    'monthly_token_limit', p_monthly_token_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_tenant_ai_limits(uuid, numeric, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_tenant_ai_limits(uuid, numeric, bigint) TO authenticated;

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
DECLARE
  v_usage_count bigint;
  v_budget_usd numeric;
  v_token_limit bigint;
  v_month_cost numeric;
  v_month_tokens bigint;
BEGIN
  IF p_feature IS NULL OR p_feature NOT IN (
    'assistant', 'documents', 'price_research', 'supplier_documents',
    'contract_monitoring', 'delivery_receiving', 'tasks', 'email_alerts'
  ) THEN
    RAISE EXCEPTION 'Recurso de IA inválido.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = p_actor_id
      AND tm.status = 'active'
      AND t.status = 'active'
      AND (
        t.commercial_status = 'active'
        OR (
          t.commercial_status = 'trial'
          AND t.trial_starts_at IS NOT NULL
          AND t.trial_starts_at <= pg_catalog.now()
          AND t.trial_ends_at IS NOT NULL
          AND t.trial_ends_at > pg_catalog.now()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Vínculo operacional com a Secretaria não encontrado.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_ai_configuration c
    JOIN public.tenant_ai_settings s ON s.tenant_id = p_tenant_id
    WHERE c.id = 1
      AND c.enabled = true
      AND c.status = 'connected'
      AND s.enabled = true
      AND s.features->p_feature = 'true'::jsonb
      AND EXISTS (
        SELECT 1
        FROM public.platform_ai_tenant_provider_access a
        JOIN public.platform_ai_providers p ON p.id = a.provider_id
        WHERE a.tenant_id = p_tenant_id
          AND a.is_allowed = true
          AND p.is_enabled = true
          AND p.status = 'connected'
      )
  ) THEN
    RAISE EXCEPTION 'Este recurso de IA não está habilitado para sua Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':' || p_actor_id::text, 0)
  );

  -- Verificar cota mensal configurada para a Secretaria (dólares / tokens)
  SELECT s.monthly_budget_usd, s.monthly_token_limit
  INTO v_budget_usd, v_token_limit
  FROM public.tenant_ai_settings s
  WHERE s.tenant_id = p_tenant_id;

  IF v_budget_usd IS NOT NULL OR v_token_limit IS NOT NULL THEN
    SELECT
      COALESCE(SUM(u.estimated_cost_usd), 0),
      COALESCE(SUM(COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0)), 0)::bigint
    INTO v_month_cost, v_month_tokens
    FROM public.platform_ai_usage u
    WHERE u.tenant_id = p_tenant_id
      AND u.status = 'success'
      AND u.created_at >= pg_catalog.date_trunc('month', pg_catalog.now());

    IF (v_budget_usd IS NOT NULL AND v_month_cost >= v_budget_usd)
       OR (v_token_limit IS NOT NULL AND v_month_tokens >= v_token_limit) THEN
      INSERT INTO public.audit_events (
        tenant_id, actor_id, action, entity, entity_id, details, created_at
      ) VALUES (
        p_tenant_id, p_actor_id, 'AI_ASSISTANT_QUOTA_EXCEEDED', 'ai_assistant', p_feature,
        pg_catalog.jsonb_build_object(
          'feature', p_feature,
          'month_cost_usd', v_month_cost,
          'monthly_budget_usd', v_budget_usd,
          'month_tokens', v_month_tokens,
          'monthly_token_limit', v_token_limit
        ),
        pg_catalog.now()
      );
      RETURN false;
    END IF;
  END IF;

  SELECT count(*) INTO v_usage_count
  FROM public.audit_events
  WHERE tenant_id = p_tenant_id
    AND actor_id = p_actor_id
    AND action = 'AI_ASSISTANT_REQUESTED'
    AND created_at >= pg_catalog.now() - interval '1 hour';

  IF v_usage_count >= 40 THEN
    INSERT INTO public.audit_events (
      tenant_id, actor_id, action, entity, entity_id, details, created_at
    ) VALUES (
      p_tenant_id, p_actor_id, 'AI_ASSISTANT_RATE_LIMITED', 'ai_assistant', p_feature,
      pg_catalog.jsonb_build_object('feature', p_feature), pg_catalog.now()
    );
    RETURN false;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    p_tenant_id, p_actor_id, 'AI_ASSISTANT_REQUESTED', 'ai_assistant', p_feature,
    pg_catalog.jsonb_build_object('feature', p_feature), pg_catalog.now()
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_ai_claim_usage(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_claim_usage(uuid, uuid, text) TO service_role;
