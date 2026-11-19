BEGIN;

CREATE TABLE public.contract_renewal_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  contract_id uuid NOT NULL,
  legal_regime text NOT NULL DEFAULT 'not_identified'
    CHECK (legal_regime IN ('lei_14133','lei_8666','lei_13303','special','not_identified')),
  contract_nature text NOT NULL DEFAULT 'unclassified'
    CHECK (contract_nature IN ('continuous_service','continuous_supply','scope','ata','special','other','unclassified')),
  legal_basis text,
  edital_allows_extension boolean NOT NULL DEFAULT false,
  contract_allows_extension boolean NOT NULL DEFAULT false,
  continuity_justification text,
  public_interest_justification text,
  execution_report text,
  vantajosidade_method text
    CHECK (vantajosidade_method IS NULL OR vantajosidade_method IN ('price_research','official_panel','negotiation','index','other')),
  current_period_value numeric(16,2) CHECK (current_period_value IS NULL OR current_period_value >= 0),
  market_reference_value numeric(16,2) CHECK (market_reference_value IS NULL OR market_reference_value >= 0),
  reference_source text,
  reference_date date,
  comparison_basis text,
  price_analysis text,
  price_advantage_attested boolean NOT NULL DEFAULT false,
  supplier_agreed boolean NOT NULL DEFAULT false,
  habilitation_confirmed boolean NOT NULL DEFAULT false,
  budget_confirmed boolean NOT NULL DEFAULT false,
  authority_approved boolean NOT NULL DEFAULT false,
  legal_review_status text NOT NULL DEFAULT 'pending'
    CHECK (legal_review_status IN ('pending','approved','not_required')),
  legal_review_reference text,
  accumulated_months integer CHECK (accumulated_months IS NULL OR accumulated_months BETWEEN 1 AND 120),
  proposed_months integer CHECK (proposed_months IS NULL OR proposed_months BETWEEN 1 AND 120),
  proposed_start_date date,
  proposed_end_date date,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  updated_by uuid NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_renewal_assessments_contract_fk
    FOREIGN KEY (tenant_id, contract_id)
    REFERENCES public.contracts(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT contract_renewal_assessments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT contract_renewal_assessments_contract_unique UNIQUE (tenant_id, contract_id),
  CONSTRAINT contract_renewal_assessments_proposed_dates_check
    CHECK (proposed_start_date IS NULL OR proposed_end_date IS NULL OR proposed_end_date > proposed_start_date)
);

CREATE TABLE public.contract_renewal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  item_key text NOT NULL CHECK (item_key IN (
    'classificacao_juridica',
    'previsao_edital',
    'previsao_contrato',
    'natureza_continua',
    'relatorio_execucao',
    'vantajosidade',
    'anuencia_contratada',
    'habilitacao',
    'dotacao',
    'autorizacao',
    'parecer_juridico'
  )),
  title text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  assigned_user_id uuid,
  due_date date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','not_applicable')),
  evidence_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_renewal_checklist_assessment_fk
    FOREIGN KEY (tenant_id, assessment_id)
    REFERENCES public.contract_renewal_assessments(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT contract_renewal_checklist_contract_fk
    FOREIGN KEY (tenant_id, contract_id)
    REFERENCES public.contracts(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT contract_renewal_checklist_assignee_fk
    FOREIGN KEY (tenant_id, assigned_user_id)
    REFERENCES public.tenant_memberships(tenant_id, user_id),
  CONSTRAINT contract_renewal_checklist_item_unique
    UNIQUE (tenant_id, assessment_id, item_key)
);

CREATE INDEX contract_renewal_assessments_tenant_contract_idx
  ON public.contract_renewal_assessments(tenant_id, contract_id);
CREATE INDEX contract_renewal_checklist_assignee_due_idx
  ON public.contract_renewal_checklist_items(tenant_id, assigned_user_id, status, due_date)
  WHERE assigned_user_id IS NOT NULL AND status IN ('pending','in_progress');

ALTER TABLE public.contract_renewal_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_renewal_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contract_renewal_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_renewal_checklist_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.contract_renewal_assessments, public.contract_renewal_checklist_items
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contract_renewal_assessments, public.contract_renewal_checklist_items
  TO authenticated;
GRANT ALL ON public.contract_renewal_assessments, public.contract_renewal_checklist_items
  TO service_role;

CREATE POLICY contract_renewal_assessments_select
  ON public.contract_renewal_assessments FOR SELECT TO authenticated
  USING (
    app_auth.has_tenant_data_permission(tenant_id, 'documents:view')
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id, 'contratos')
  );

CREATE POLICY contract_renewal_checklist_select
  ON public.contract_renewal_checklist_items FOR SELECT TO authenticated
  USING (
    app_auth.has_tenant_data_permission(tenant_id, 'documents:view')
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id, 'contratos')
  );

CREATE OR REPLACE FUNCTION public.fn_seed_contract_renewal_checklist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_manager uuid;
  v_inspector uuid;
  v_end_date date;
BEGIN
  SELECT c.manager_user_id, c.inspector_user_id, c.end_date
    INTO v_manager, v_inspector, v_end_date
  FROM public.contracts c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado para iniciar o checklist de renovação.';
  END IF;

  INSERT INTO public.contract_renewal_checklist_items (
    tenant_id, assessment_id, contract_id, item_key, title, is_required,
    assigned_user_id, due_date, created_by, updated_by
  )
  VALUES
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'classificacao_juridica', 'Classificação jurídica e regime aplicável', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'previsao_edital', 'Conferir previsão de prorrogação no edital', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'previsao_contrato', 'Conferir cláusula de prorrogação no contrato', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'natureza_continua', 'Justificar formalmente a natureza contínua', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'relatorio_execucao', 'Emitir relatório de execução e fiscalização', true, v_inspector, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'vantajosidade', 'Concluir comparativo e ateste de vantajosidade', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'anuencia_contratada', 'Obter manifestação expressa da contratada', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'habilitacao', 'Conferir manutenção das condições de habilitação', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'dotacao', 'Confirmar créditos e disponibilidade orçamentária', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'autorizacao', 'Obter autorização prévia da autoridade competente', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by),
    (NEW.tenant_id, NEW.id, NEW.contract_id, 'parecer_juridico', 'Obter parecer jurídico ou justificar a aplicação de parecer referencial/dispensa conforme norma local', true, v_manager, v_end_date - 30, NEW.created_by, NEW.updated_by)
  ON CONFLICT (tenant_id, assessment_id, item_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_seed_contract_renewal_checklist()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_seed_contract_renewal_checklist
  AFTER INSERT ON public.contract_renewal_assessments
  FOR EACH ROW EXECUTE FUNCTION public.fn_seed_contract_renewal_checklist();

CREATE OR REPLACE FUNCTION public.fn_guard_contract_renewal_assessment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria, contrato e dados de criação da análise são imutáveis.';
    END IF;
    NEW.updated_by := (SELECT auth.uid());
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_contract_renewal_checklist_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
       OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.item_key IS DISTINCT FROM OLD.item_key
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.is_required IS DISTINCT FROM OLD.is_required
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria, contrato e definição da providência são imutáveis.';
    END IF;
    NEW.updated_by := (SELECT auth.uid());
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_contract_renewal_assessment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_contract_renewal_checklist_item()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_contract_renewal_assessments_guard
  BEFORE INSERT OR UPDATE ON public.contract_renewal_assessments
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_contract_renewal_assessment();
CREATE TRIGGER trg_contract_renewal_assessments_audit
  AFTER INSERT OR UPDATE ON public.contract_renewal_assessments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();

CREATE TRIGGER trg_contract_renewal_checklist_guard
  BEFORE INSERT OR UPDATE ON public.contract_renewal_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_contract_renewal_checklist_item();
CREATE TRIGGER trg_contract_renewal_checklist_audit
  AFTER INSERT OR UPDATE ON public.contract_renewal_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();

CREATE OR REPLACE FUNCTION public.save_contract_renewal_assessment(
  p_tenant_id uuid,
  p_contract_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_id uuid;
BEGIN
  IF v_user_id IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'contratos') THEN
    RAISE EXCEPTION 'Sem permissão para instruir a renovação nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Os dados da análise de renovação são inválidos.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contracts c
    WHERE c.tenant_id = p_tenant_id
      AND c.id = p_contract_id
      AND c.status = 'vigente'
      AND c.instrument_type = 'contrato'
  ) THEN
    RAISE EXCEPTION 'Somente contratos vigentes podem receber análise de renovação.';
  END IF;

  INSERT INTO public.contract_renewal_assessments (
    tenant_id, contract_id, legal_regime, contract_nature, legal_basis,
    edital_allows_extension, contract_allows_extension,
    continuity_justification, public_interest_justification, execution_report,
    vantajosidade_method, current_period_value, market_reference_value,
    reference_source, reference_date, comparison_basis, price_analysis,
    price_advantage_attested, supplier_agreed, habilitation_confirmed,
    budget_confirmed, authority_approved, legal_review_status,
    legal_review_reference, accumulated_months, proposed_months,
    proposed_start_date, proposed_end_date, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    p_contract_id,
    COALESCE(NULLIF(p_payload->>'legal_regime', ''), 'not_identified'),
    COALESCE(NULLIF(p_payload->>'contract_nature', ''), 'unclassified'),
    NULLIF(btrim(p_payload->>'legal_basis'), ''),
    COALESCE(NULLIF(p_payload->>'edital_allows_extension', '')::boolean, false),
    COALESCE(NULLIF(p_payload->>'contract_allows_extension', '')::boolean, false),
    NULLIF(btrim(p_payload->>'continuity_justification'), ''),
    NULLIF(btrim(p_payload->>'public_interest_justification'), ''),
    NULLIF(btrim(p_payload->>'execution_report'), ''),
    NULLIF(p_payload->>'vantajosidade_method', ''),
    NULLIF(p_payload->>'current_period_value', '')::numeric,
    NULLIF(p_payload->>'market_reference_value', '')::numeric,
    NULLIF(btrim(p_payload->>'reference_source'), ''),
    NULLIF(p_payload->>'reference_date', '')::date,
    NULLIF(btrim(p_payload->>'comparison_basis'), ''),
    NULLIF(btrim(p_payload->>'price_analysis'), ''),
    COALESCE(NULLIF(p_payload->>'price_advantage_attested', '')::boolean, false),
    COALESCE(NULLIF(p_payload->>'supplier_agreed', '')::boolean, false),
    COALESCE(NULLIF(p_payload->>'habilitation_confirmed', '')::boolean, false),
    COALESCE(NULLIF(p_payload->>'budget_confirmed', '')::boolean, false),
    COALESCE(NULLIF(p_payload->>'authority_approved', '')::boolean, false),
    COALESCE(NULLIF(p_payload->>'legal_review_status', ''), 'pending'),
    NULLIF(btrim(p_payload->>'legal_review_reference'), ''),
    NULLIF(p_payload->>'accumulated_months', '')::integer,
    NULLIF(p_payload->>'proposed_months', '')::integer,
    NULLIF(p_payload->>'proposed_start_date', '')::date,
    NULLIF(p_payload->>'proposed_end_date', '')::date,
    NULLIF(btrim(p_payload->>'notes'), ''),
    v_user_id,
    v_user_id
  )
  ON CONFLICT (tenant_id, contract_id) DO UPDATE SET
    legal_regime = EXCLUDED.legal_regime,
    contract_nature = EXCLUDED.contract_nature,
    legal_basis = EXCLUDED.legal_basis,
    edital_allows_extension = EXCLUDED.edital_allows_extension,
    contract_allows_extension = EXCLUDED.contract_allows_extension,
    continuity_justification = EXCLUDED.continuity_justification,
    public_interest_justification = EXCLUDED.public_interest_justification,
    execution_report = EXCLUDED.execution_report,
    vantajosidade_method = EXCLUDED.vantajosidade_method,
    current_period_value = EXCLUDED.current_period_value,
    market_reference_value = EXCLUDED.market_reference_value,
    reference_source = EXCLUDED.reference_source,
    reference_date = EXCLUDED.reference_date,
    comparison_basis = EXCLUDED.comparison_basis,
    price_analysis = EXCLUDED.price_analysis,
    price_advantage_attested = EXCLUDED.price_advantage_attested,
    supplier_agreed = EXCLUDED.supplier_agreed,
    habilitation_confirmed = EXCLUDED.habilitation_confirmed,
    budget_confirmed = EXCLUDED.budget_confirmed,
    authority_approved = EXCLUDED.authority_approved,
    legal_review_status = EXCLUDED.legal_review_status,
    legal_review_reference = EXCLUDED.legal_review_reference,
    accumulated_months = EXCLUDED.accumulated_months,
    proposed_months = EXCLUDED.proposed_months,
    proposed_start_date = EXCLUDED.proposed_start_date,
    proposed_end_date = EXCLUDED.proposed_end_date,
    notes = EXCLUDED.notes,
    updated_by = v_user_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_contract_renewal_checklist_item(
  p_tenant_id uuid,
  p_contract_id uuid,
  p_item_key text,
  p_assigned_user_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_status text DEFAULT 'pending',
  p_evidence_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_item_id uuid;
  v_legal_status text;
  v_legal_reference text;
BEGIN
  IF v_user_id IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'contratos') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar o checklist de renovação nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending','in_progress','completed','not_applicable') THEN
    RAISE EXCEPTION 'Situação de checklist inválida.';
  END IF;

  IF p_assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = p_assigned_user_id
      AND tm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'O responsável selecionado não é membro ativo desta Secretaria.';
  END IF;

  IF p_status = 'completed' AND NULLIF(btrim(p_evidence_reference), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a referência do documento ou evidência antes de concluir esta providência.';
  END IF;

  IF p_status = 'not_applicable' AND p_item_key <> 'parecer_juridico' THEN
    RAISE EXCEPTION 'Somente a etapa de análise jurídica pode ser marcada como não aplicável.';
  END IF;

  IF p_item_key = 'parecer_juridico' AND p_status = 'not_applicable' THEN
    SELECT a.legal_review_status, a.legal_review_reference
      INTO v_legal_status, v_legal_reference
    FROM public.contract_renewal_assessments a
    WHERE a.tenant_id = p_tenant_id AND a.contract_id = p_contract_id;

    IF v_legal_status IS DISTINCT FROM 'not_required'
       OR NULLIF(btrim(v_legal_reference), '') IS NULL THEN
      RAISE EXCEPTION 'Registre na análise a justificativa normativa para não exigir parecer individualizado.';
    END IF;
  END IF;

  UPDATE public.contract_renewal_checklist_items i
  SET assigned_user_id = p_assigned_user_id,
      due_date = p_due_date,
      status = p_status,
      evidence_reference = NULLIF(btrim(p_evidence_reference), ''),
      notes = NULLIF(btrim(p_notes), ''),
      updated_by = v_user_id
  WHERE i.tenant_id = p_tenant_id
    AND i.contract_id = p_contract_id
    AND i.item_key = p_item_key
  RETURNING i.id INTO v_item_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'Providência não encontrada para este contrato.';
  END IF;

  RETURN v_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_contract_renewal_addendum(
  p_tenant_id uuid,
  p_contract_id uuid
)
RETURNS TABLE(can_generate boolean, blockers text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_contract public.contracts%ROWTYPE;
  v_assessment public.contract_renewal_assessments%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_required_count integer := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:view')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'contratos') THEN
    RAISE EXCEPTION 'Acesso não autorizado à validação de renovação.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create') THEN
    v_blockers := array_append(v_blockers, 'Seu perfil não possui permissão para gerar documentos.');
  END IF;

  SELECT c.* INTO v_contract
  FROM public.contracts c
  WHERE c.tenant_id = p_tenant_id AND c.id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado nesta Secretaria.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_contract.status <> 'vigente' THEN
    v_blockers := array_append(v_blockers, 'O contrato não está vigente.');
  END IF;
  IF v_contract.instrument_type <> 'contrato' THEN
    v_blockers := array_append(v_blockers, 'Atas de registro de preços não utilizam esta minuta de prorrogação contratual.');
  END IF;
  IF v_contract.end_date <= CURRENT_DATE THEN
    v_blockers := array_append(v_blockers, 'A vigência terminou ou termina hoje. A prorrogação deve ser formalizada antes do fim; não gere minuta retroativa.');
  END IF;

  SELECT a.* INTO v_assessment
  FROM public.contract_renewal_assessments a
  WHERE a.tenant_id = p_tenant_id AND a.contract_id = p_contract_id;

  IF NOT FOUND THEN
    v_blockers := array_append(v_blockers, 'A classificação jurídica e a análise de renovação ainda não foram preenchidas.');
    RETURN QUERY SELECT false, v_blockers;
    RETURN;
  END IF;

  IF v_assessment.legal_regime <> 'lei_14133' THEN
    v_blockers := array_append(v_blockers, 'O modelo disponível é específico para contratos regidos pela Lei nº 14.133/2021.');
  END IF;
  IF v_assessment.contract_nature NOT IN ('continuous_service','continuous_supply') THEN
    v_blockers := array_append(v_blockers, 'O art. 107 exige serviço ou fornecimento contínuo. Contratos por escopo, atas e regimes especiais exigem fluxo próprio.');
  END IF;
  IF NULLIF(btrim(v_assessment.legal_basis), '') IS NULL THEN
    v_blockers := array_append(v_blockers, 'Informe o fundamento legal e a cláusula aplicável.');
  END IF;
  IF NOT v_assessment.edital_allows_extension THEN
    v_blockers := array_append(v_blockers, 'Não foi confirmada a previsão de prorrogação no edital.');
  END IF;
  IF NOT v_assessment.contract_allows_extension THEN
    v_blockers := array_append(v_blockers, 'Não foi confirmada a previsão de prorrogação no contrato.');
  END IF;
  IF NULLIF(btrim(v_assessment.continuity_justification), '') IS NULL THEN
    v_blockers := array_append(v_blockers, 'Registre a justificativa da natureza contínua do objeto.');
  END IF;
  IF NULLIF(btrim(v_assessment.public_interest_justification), '') IS NULL THEN
    v_blockers := array_append(v_blockers, 'Registre por escrito o interesse público na continuidade.');
  END IF;
  IF NULLIF(btrim(v_assessment.execution_report), '') IS NULL THEN
    v_blockers := array_append(v_blockers, 'Inclua o relatório de execução e fiscalização do contrato.');
  END IF;
  IF v_assessment.vantajosidade_method IS NULL
     OR COALESCE(v_assessment.current_period_value, 0) <= 0
     OR COALESCE(v_assessment.market_reference_value, 0) <= 0
     OR NULLIF(btrim(v_assessment.reference_source), '') IS NULL
     OR v_assessment.reference_date IS NULL
     OR v_assessment.reference_date > CURRENT_DATE
     OR NULLIF(btrim(v_assessment.comparison_basis), '') IS NULL
     OR NULLIF(btrim(v_assessment.price_analysis), '') IS NULL
     OR NOT v_assessment.price_advantage_attested THEN
    v_blockers := array_append(v_blockers, 'Conclua o comparativo estruturado de preços e o ateste fundamentado de vantajosidade.');
  END IF;
  IF NOT v_assessment.supplier_agreed THEN
    v_blockers := array_append(v_blockers, 'Registre a manifestação expressa da contratada.');
  END IF;
  IF NOT v_assessment.habilitation_confirmed THEN
    v_blockers := array_append(v_blockers, 'Confirme a manutenção das condições de habilitação da contratada.');
  END IF;
  IF NOT v_assessment.budget_confirmed THEN
    v_blockers := array_append(v_blockers, 'Confirme os créditos e a disponibilidade orçamentária para o período.');
  END IF;
  IF NOT v_assessment.authority_approved THEN
    v_blockers := array_append(v_blockers, 'Registre a autorização prévia da autoridade competente.');
  END IF;
  IF v_assessment.legal_review_status = 'pending'
     OR NULLIF(btrim(v_assessment.legal_review_reference), '') IS NULL THEN
    v_blockers := array_append(v_blockers, 'Registre o parecer jurídico ou a justificativa de aplicação de parecer referencial/não exigência individualizada conforme a norma local.');
  END IF;
  IF v_assessment.accumulated_months IS NULL
     OR v_assessment.proposed_months IS NULL
     OR v_assessment.accumulated_months + v_assessment.proposed_months > 120 THEN
    v_blockers := array_append(v_blockers, 'Informe o prazo acumulado e o período proposto, respeitando o limite decenal do art. 107.');
  END IF;
  IF v_assessment.proposed_end_date IS NOT NULL
     AND v_assessment.proposed_end_date >
       (v_contract.start_date + interval '10 years' - interval '1 day')::date THEN
    v_blockers := array_append(v_blockers, 'O término proposto ultrapassa o limite máximo de dez anos contado do início do contrato.');
  END IF;
  IF v_assessment.proposed_start_date IS DISTINCT FROM (v_contract.end_date + 1) THEN
    v_blockers := array_append(v_blockers, 'A data inicial proposta deve ser o dia seguinte ao término da vigência atual, sem solução de continuidade.');
  END IF;
  IF v_assessment.proposed_end_date IS NULL
     OR v_assessment.proposed_start_date IS NULL
     OR v_assessment.proposed_end_date <= v_assessment.proposed_start_date THEN
    v_blockers := array_append(v_blockers, 'Informe um período futuro válido para a prorrogação.');
  ELSIF v_assessment.proposed_months IS NOT NULL
     AND v_assessment.proposed_end_date IS DISTINCT FROM
       (v_assessment.proposed_start_date + make_interval(months => v_assessment.proposed_months) - interval '1 day')::date THEN
    v_blockers := array_append(v_blockers, 'O período em meses deve corresponder às datas inicial e final propostas.');
  END IF;

  SELECT count(*) INTO v_required_count
  FROM public.contract_renewal_checklist_items i
  WHERE i.tenant_id = p_tenant_id
    AND i.contract_id = p_contract_id
    AND i.is_required;

  IF v_required_count < 11 THEN
    v_blockers := array_append(v_blockers, 'O checklist documental está incompleto ou não foi inicializado.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contract_renewal_checklist_items i
    WHERE i.tenant_id = p_tenant_id
      AND i.contract_id = p_contract_id
      AND i.is_required
      AND (
        i.assigned_user_id IS NULL
        OR i.due_date IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.tenant_memberships tm
          WHERE tm.tenant_id = i.tenant_id
            AND tm.user_id = i.assigned_user_id
            AND tm.status = 'active'
        )
      )
  ) THEN
    v_blockers := array_append(v_blockers, 'Atribua responsável ativo e prazo a todas as providências obrigatórias.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contract_renewal_checklist_items i
    WHERE i.tenant_id = p_tenant_id
      AND i.contract_id = p_contract_id
      AND i.is_required
      AND i.status <> 'completed'
      AND NOT (
        i.item_key = 'parecer_juridico'
        AND i.status = 'not_applicable'
        AND v_assessment.legal_review_status = 'not_required'
        AND NULLIF(btrim(i.evidence_reference), '') IS NOT NULL
      )
  ) THEN
    v_blockers := array_append(v_blockers, 'Existem providências documentais obrigatórias pendentes no checklist.');
  END IF;

  RETURN QUERY SELECT cardinality(v_blockers) = 0, v_blockers;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_contract_renewal_addendum()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_template_ok boolean;
  v_can_generate boolean;
  v_blockers text[];
  v_contract_process_id uuid;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'term_addendum_renewal' THEN
    RETURN NEW;
  END IF;

  IF NEW.template_id IS NULL OR NEW.contract_id IS NULL THEN
    RAISE EXCEPTION 'A minuta de prorrogação exige modelo e contrato vinculados.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.document_templates t
    WHERE t.tenant_id = NEW.tenant_id
      AND t.id = NEW.template_id
      AND t.template_type = 'term_addendum_renewal'
      AND t.is_active
  ) INTO v_template_ok;

  IF NOT v_template_ok THEN
    RAISE EXCEPTION 'Selecione um modelo ativo de termo aditivo de prorrogação desta Secretaria.';
  END IF;

  SELECT c.process_id INTO v_contract_process_id
  FROM public.contracts c
  WHERE c.tenant_id = NEW.tenant_id
    AND c.id = NEW.contract_id
    AND c.instrument_type = 'contrato';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O contrato vinculado não pertence à Secretaria ou não é um contrato elegível.';
  END IF;

  IF NEW.process_id IS DISTINCT FROM v_contract_process_id THEN
    RAISE EXCEPTION 'O processo vinculado ao documento deve ser o mesmo do contrato selecionado.';
  END IF;

  IF NEW.content_snapshot IS NULL
     OR btrim(NEW.content_snapshot) = ''
     OR (position('{{' in NEW.content_snapshot) > 0
         AND position('}}' in NEW.content_snapshot) > 0) THEN
    RAISE EXCEPTION 'A minuta possui campos automáticos ou complementares não preenchidos. Revise o conteúdo antes de gerar.';
  END IF;

  FOR v_variable IN
    SELECT value AS item
    FROM jsonb_array_elements(COALESCE(v_template_variables, '[]'::jsonb))
  LOOP
    IF v_variable.item->>'required' = 'true' THEN
      v_variable_key := v_variable.item->>'key';
      v_variable_value := NEW.variables_snapshot->>v_variable_key;
      IF v_variable_key IS NULL
         OR v_variable_value IS NULL
         OR btrim(v_variable_value) = ''
         OR v_variable_value LIKE '[PREENCHER:%' THEN
        RAISE EXCEPTION 'Campo obrigatório não preenchido na minuta de renovação: %.',
          COALESCE(v_variable.item->>'label', v_variable_key, 'campo sem identificador')
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  SELECT v.can_generate, v.blockers
    INTO v_can_generate, v_blockers
  FROM public.validate_contract_renewal_addendum(NEW.tenant_id, NEW.contract_id) v;

  IF NOT COALESCE(v_can_generate, false) THEN
    RAISE EXCEPTION 'A minuta de prorrogação foi bloqueada: %', array_to_string(COALESCE(v_blockers, ARRAY[]::text[]), ' | ')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_contract_renewal_assessment(uuid,uuid,jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_contract_renewal_assessment(uuid,uuid,jsonb)
  TO authenticated;

REVOKE ALL ON FUNCTION public.save_contract_renewal_checklist_item(uuid,uuid,text,uuid,date,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_contract_renewal_checklist_item(uuid,uuid,text,uuid,date,text,text,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.validate_contract_renewal_addendum(uuid,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.validate_contract_renewal_addendum(uuid,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.fn_guard_contract_renewal_addendum()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_guard_generated_documents_renewal_addendum
  BEFORE INSERT OR UPDATE OF document_type, contract_id, template_id
  ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_contract_renewal_addendum();

COMMIT;
