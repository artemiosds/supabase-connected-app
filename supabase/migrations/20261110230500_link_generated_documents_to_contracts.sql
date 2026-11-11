-- Link generated documents to the contract that they support.
-- Tenant-scoped foreign keys and triggers prevent cross-Secretaria or mismatched links.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS contract_id uuid;

-- Replace single-column references with tenant-preserving relationships.
ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_supplier_id_fkey;
ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_template_id_fkey;

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_supplier_tenant_fk
  FOREIGN KEY (tenant_id, supplier_id)
  REFERENCES public.suppliers (tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_template_tenant_fk
  FOREIGN KEY (template_id, tenant_id)
  REFERENCES public.document_templates (id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_contract_tenant_fk
  FOREIGN KEY (tenant_id, contract_id)
  REFERENCES public.contracts (tenant_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_generated_documents_contract
  ON public.generated_documents (tenant_id, contract_id)
  WHERE contract_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_guard_generated_document_contract_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_contract public.contracts%ROWTYPE;
BEGIN
  IF NEW.contract_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO v_contract
  FROM public.contracts c
  WHERE c.id = NEW.contract_id
    AND c.tenant_id = NEW.tenant_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O contrato selecionado não pertence a esta Secretaria.';
  END IF;

  IF NEW.process_id IS DISTINCT FROM v_contract.process_id THEN
    RAISE EXCEPTION 'O documento e o contrato precisam estar vinculados ao mesmo processo.';
  END IF;

  IF NEW.supplier_id IS NULL THEN
    NEW.supplier_id := v_contract.supplier_id;
  ELSIF NEW.supplier_id IS DISTINCT FROM v_contract.supplier_id THEN
    RAISE EXCEPTION 'O fornecedor do documento precisa ser o mesmo fornecedor cadastrado no contrato.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_generated_documents_contract_link
  ON public.generated_documents;
CREATE TRIGGER trg_generated_documents_contract_link
  BEFORE INSERT OR UPDATE OF tenant_id, contract_id, process_id, supplier_id
  ON public.generated_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_generated_document_contract_link();

-- A contract's supplier/process identity cannot be changed after quotes or documents
-- have been linked. Other contract fields remain editable and audited as before.
CREATE OR REPLACE FUNCTION public.fn_guard_contract_linked_relationships()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.process_id IS DISTINCT FROM OLD.process_id THEN
    IF EXISTS (
      SELECT 1
      FROM public.procurement_price_quotes q
      WHERE q.tenant_id = OLD.tenant_id
        AND q.contract_id = OLD.id
    ) OR EXISTS (
      SELECT 1
      FROM public.generated_documents d
      WHERE d.tenant_id = OLD.tenant_id
        AND d.contract_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Não é possível trocar o fornecedor ou processo de um contrato já relacionado a cotações ou documentos.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_contracts_linked_relationship_guard ON public.contracts;
CREATE TRIGGER trg_contracts_linked_relationship_guard
  BEFORE UPDATE OF supplier_id, process_id
  ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_contract_linked_relationships();

-- Process-based generation accepts a reserved contract_id in p_overrides.
-- The value is validated and removed from the variable snapshot before rendering.
CREATE OR REPLACE FUNCTION public.generate_document_from_process(
  p_process_id uuid,
  p_template_id uuid,
  p_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  p public.procurement_processes%ROWTYPE;
  t public.document_templates%ROWTYPE;
  v_contract public.contracts%ROWTYPE;
  org record;
  new_id uuid;
  v_contract_id uuid;
  vars jsonb;
  snap jsonb;
  body text;
  k text;
  v text;
  checklist jsonb;
  item jsonb;
  allowed text[] := ARRAY[
    'quantitativos','dotacao_orcamentaria','metodo_estimativa','referencia_pca',
    'resultado_esperado','justificativa_prazo','providencias_iniciais',
    'requisitos_contratacao','levantamento_mercado','descricao_solucao',
    'justificativa_parcelamento','providencias_previas','contratacoes_correlatas',
    'impactos_ambientais','analise_riscos','conclusao_viabilidade',
    'justificativa_nao_aplicabilidade','equipe_planejamento','aprovacao',
    'metodologia_riscos','escala_probabilidade','escala_impacto',
    'criterio_classificacao','riscos_identificados','acompanhamento_riscos',
    'riscos_residuais','enquadramento_matriz','metodologia_alocacao',
    'eventos_alocacao','obrigacoes_partes','efeitos_equilibrio','aprovacao_matriz',
    'natureza_objeto','prazo_execucao','prorrogacao','fundamentacao_contratacao',
    'modelo_execucao','modelo_gestao','gestor_contrato','fiscal_contrato',
    'criterios_medicao_pagamento','criterios_selecao','memoria_calculo_valor',
    'obrigacoes_contratada','obrigacoes_contratante','sancoes','local_prazo_entrega',
    'requisitos_especificos_saude','contract_id'
  ];
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR p_overrides IS NULL
     OR jsonb_typeof(p_overrides) <> 'object' THEN
    RAISE EXCEPTION 'Sessão e complementos em objeto JSON obrigatórios.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO p
  FROM public.procurement_processes
  WHERE id = p_process_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processo não encontrado ou sem acesso.';
  END IF;

  IF NOT app_auth.has_tenant_data_permission(p.tenant_id, 'documents:create')
     OR NOT app_auth.has_tenant_data_permission(p.tenant_id, 'documents:view')
     OR NOT app_auth.is_tenant_in_good_standing(p.tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p.tenant_id, 'processos')
     OR NOT app_auth.is_tenant_module_enabled(p.tenant_id, 'documentos')
     OR NOT app_auth.is_tenant_module_enabled(p.tenant_id, 'modelos') THEN
    RAISE EXCEPTION 'Acesso negado: verifique permissões e módulos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO t
  FROM public.document_templates
  WHERE id = p_template_id
    AND tenant_id = p.tenant_id
    AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo inexistente, inativo ou de outra Secretaria.';
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_overrides) LOOP
    IF NOT (k = ANY (allowed))
       OR jsonb_typeof(p_overrides -> k) NOT IN ('string', 'number', 'boolean') THEN
      RAISE EXCEPTION 'Campo complementar inválido: %.', k;
    END IF;
  END LOOP;

  IF p_overrides ? 'contract_id' THEN
    BEGIN
      v_contract_id := (p_overrides ->> 'contract_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'O identificador do contrato informado é inválido.';
    END;

    SELECT *
      INTO v_contract
    FROM public.contracts c
    WHERE c.id = v_contract_id
      AND c.tenant_id = p.tenant_id
      AND c.process_id = p.id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'O contrato precisa pertencer à mesma Secretaria e ao processo selecionado.';
    END IF;
  END IF;

  SELECT name, municipality, state
    INTO org
  FROM public.tenants
  WHERE id = p.tenant_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'stage', stage,
        'title', title,
        'completed', is_done,
        'sort_order', sort_order
      )
      ORDER BY sort_order, created_at
    ),
    '[]'::jsonb
  )
    INTO checklist
  FROM public.process_items
  WHERE process_id = p.id
    AND tenant_id = p.tenant_id;

  vars := jsonb_build_object(
    'secretaria', COALESCE(org.name, '[PREENCHER: secretaria]'),
    'municipio', COALESCE(org.municipality, '[PREENCHER: municipio]'),
    'uf', COALESCE(org.state, '[PREENCHER: uf]'),
    'numero_processo', p.number,
    'objeto', p.title,
    'justificativa', COALESCE(p.description, '[PREENCHER: justificativa]'),
    'modalidade', p.modality,
    'etapa_atual', p.stage,
    'situacao_processo', p.status,
    'prioridade', p.priority,
    'unidade_requisitante', COALESCE(p.requesting_unit, '[PREENCHER: unidade requisitante]'),
    'responsavel', COALESCE(p.responsible_name, '[PREENCHER: responsavel]'),
    'usuario_email', COALESCE((SELECT auth.jwt() ->> 'email'), ''),
    'valor_estimado',
      CASE
        WHEN p.estimated_value IS NULL THEN '[PREENCHER: valor estimado]'
        ELSE 'R$ ' || pg_catalog.to_char(p.estimated_value, 'FM999G999G999G990D00')
      END,
    'prazo_desejado',
      COALESCE(pg_catalog.to_char(p.due_date, 'DD/MM/YYYY'), '[PREENCHER: prazo desejado]'),
    'data_geracao', pg_catalog.to_char(pg_catalog.now(), 'DD/MM/YYYY')
  );

  FOR item IN SELECT value FROM jsonb_array_elements(t.variables_schema) LOOP
    k := item ->> 'key';
    IF k IS NOT NULL AND NOT (vars ? k) THEN
      vars := vars || jsonb_build_object(
        k,
        '[PREENCHER: ' || COALESCE(item ->> 'label', k) || ']'
      );
    END IF;
  END LOOP;

  vars := vars || (p_overrides - 'contract_id');

  snap := jsonb_build_object(
    'id', p.id,
    'tenant_id', p.tenant_id,
    'number', p.number,
    'title', p.title,
    'description', p.description,
    'modality', p.modality,
    'stage', p.stage,
    'status', p.status,
    'priority', p.priority,
    'requesting_unit', p.requesting_unit,
    'responsible_name', p.responsible_name,
    'estimated_value', p.estimated_value,
    'due_date', p.due_date,
    'checklist', checklist,
    'captured_at', pg_catalog.now()
  );

  body := t.content;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(vars) LOOP
    body := replace(body, '{{' || k || '}}', COALESCE(v, '[PREENCHER: ' || k || ']'));
  END LOOP;

  INSERT INTO public.generated_documents (
    tenant_id,
    process_id,
    contract_id,
    supplier_id,
    template_id,
    title,
    content_snapshot,
    status,
    document_type,
    template_version,
    process_snapshot,
    variables_snapshot
  )
  VALUES (
    p.tenant_id,
    p.id,
    v_contract_id,
    v_contract.supplier_id,
    t.id,
    t.title || ' - Processo ' || p.number,
    body,
    'draft',
    t.template_type,
    t.version,
    snap,
    vars
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

COMMIT;
