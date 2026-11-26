-- Fase C: Onboarding Automático de Novas Secretarias (Escala SaaS)
-- Provisiona papéis especializados da Lei nº 14.133/2021 (Pregoeiro, Fiscal de Contrato,
-- Controle Interno) e instala automaticamente os 6 modelos oficiais ativos do catálogo.

CREATE OR REPLACE FUNCTION public.apply_tenant_onboarding_defaults(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_modelos_enabled boolean := true;
  v_role_id uuid;
  v_roles_created integer := 0;
  v_templates_installed integer := 0;
  v_rec record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    app_auth.is_platform_admin()
    OR (
      app_auth.has_tenant_data_permission(p_tenant_id, 'roles:manage')
      AND app_auth.has_tenant_data_permission(p_tenant_id, 'documents:manage_templates')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aplicar o onboarding padrão nesta Secretaria.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE((t.enabled_modules->>'modelos')::boolean, true)
  INTO v_modelos_enabled
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secretaria não encontrada.';
  END IF;

  -- 1. Pregoeiro / Agente de Contratação
  SELECT tr.id INTO v_role_id
  FROM public.tenant_roles tr
  WHERE tr.tenant_id = p_tenant_id AND tr.slug = 'pregoeiro'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
    VALUES (
      p_tenant_id,
      'Pregoeiro / Agente de Contratação',
      'pregoeiro',
      'Condução de processos licitatórios, pesquisa de preços, aprovação de estimativas e portal de cotações',
      false
    )
    RETURNING id INTO v_role_id;
    v_roles_created := v_roles_created + 1;
  END IF;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.code IN (
    'org:view', 'users:view', 'procurement:approve_price',
    'suppliers:view', 'suppliers:create', 'suppliers:update',
    'documents:view', 'documents:create', 'documents:update', 'documents:approve', 'documents:sign',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- 2. Fiscal de Contrato
  SELECT tr.id INTO v_role_id
  FROM public.tenant_roles tr
  WHERE tr.tenant_id = p_tenant_id AND tr.slug = 'fiscal'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
    VALUES (
      p_tenant_id,
      'Fiscal de Contrato',
      'fiscal',
      'Acompanhamento de execução contratual, saldos, prorrogações, atestes e ocorrências',
      false
    )
    RETURNING id INTO v_role_id;
    v_roles_created := v_roles_created + 1;
  END IF;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.code IN (
    'org:view',
    'suppliers:view',
    'documents:view', 'documents:create', 'documents:update', 'documents:sign',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- 3. Controle Interno
  SELECT tr.id INTO v_role_id
  FROM public.tenant_roles tr
  WHERE tr.tenant_id = p_tenant_id AND tr.slug = 'controle_interno'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
    VALUES (
      p_tenant_id,
      'Controle Interno',
      'controle_interno',
      'Auditoria preventiva, conformidade Lei nº 14.133/2021 e conferência de dossiês TCE',
      false
    )
    RETURNING id INTO v_role_id;
    v_roles_created := v_roles_created + 1;
  END IF;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.code IN (
    'org:view', 'users:view',
    'suppliers:view',
    'documents:view',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- 4. Instalação automática dos modelos oficiais ativos do catálogo (quando módulo modelos ativo)
  IF v_modelos_enabled THEN
    FOR v_rec IN
      SELECT c.*
      FROM public.document_template_catalog c
      WHERE c.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.document_templates dt
          WHERE dt.tenant_id = p_tenant_id
            AND dt.catalog_template_id = c.id
        )
      ORDER BY c.template_code
    LOOP
      INSERT INTO public.document_templates (
        tenant_id,
        title,
        description,
        content,
        is_active,
        template_type,
        template_code,
        version,
        catalog_template_id,
        legal_basis,
        source_reference,
        variables_schema,
        change_summary,
        is_base_template
      )
      VALUES (
        p_tenant_id,
        v_rec.title,
        v_rec.description,
        v_rec.content,
        true,
        v_rec.template_type,
        v_rec.template_code,
        1,
        v_rec.id,
        v_rec.legal_basis,
        v_rec.source_reference,
        v_rec.variables_schema,
        'Instalado automaticamente no onboarding da Secretaria.',
        true
      );
      v_templates_installed := v_templates_installed + 1;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'roles_created', v_roles_created,
    'templates_installed', v_templates_installed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_tenant_onboarding_defaults(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.apply_tenant_onboarding_defaults(uuid)
  TO authenticated;

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
  v_onboarding jsonb;
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

  v_onboarding := public.apply_tenant_onboarding_defaults(v_tenant_id);

  RETURN v_result || pg_catalog.jsonb_build_object(
    'commercial_status', v_status,
    'plan_tier', v_plan,
    'onboarding', v_onboarding
  );
END;
$function$;
