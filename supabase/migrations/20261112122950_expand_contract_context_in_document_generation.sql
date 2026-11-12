-- Enrich process-linked documents from the selected contract and supplier.
-- Safe to apply only through the versioned migration workflow; never apply directly to SMS2 during code-only preparation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

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
  v_supplier public.suppliers%ROWTYPE;
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

  IF jsonb_typeof(t.variables_schema) <> 'array' THEN
    RAISE EXCEPTION 'O modelo não possui um esquema válido de campos.';
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_overrides) LOOP
    IF k = 'contract_id' THEN
      IF jsonb_typeof(p_overrides -> k) <> 'string'
         OR pg_catalog.length(p_overrides ->> k) > 36 THEN
        RAISE EXCEPTION 'O identificador do contrato informado é inválido.';
      END IF;
    ELSIF k !~ '^[a-z][a-z0-9_]{1,79}$'
       OR jsonb_typeof(p_overrides -> k) <> 'string'
       OR pg_catalog.length(p_overrides ->> k) > 12000
       OR k = ANY (ARRAY[
         'secretaria','municipio','uf','cnpj_secretaria','codigo_ibge',
         'fornecedor','nome_fantasia','cnpj','fornecedor_email','fornecedor_telefone',
         'numero_processo','objeto','objeto_contrato','justificativa','modalidade',
         'etapa_atual','situacao_processo','prioridade','unidade_requisitante',
         'responsavel','valor_estimado','prazo_desejado','numero_contrato',
         'valor_contrato','valor','data_inicio','data_fim','vigencia_inicio',
         'vigencia_fim','gestor','gestor_nome','gestor_contrato','fiscal',
         'fiscal_nome','fiscal_contrato','portaria_fiscal','quantitativos',
         'levantamento_mercado','metodo_estimativa','dotacao_orcamentaria',
         'data','data_geracao','usuario','usuario_email'
       ]::text[])
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(t.variables_schema) AS declared(value)
         WHERE declared.value ->> 'key' = k
           AND COALESCE(declared.value ->> 'source', 'manual') = 'manual'
       ) THEN
      RAISE EXCEPTION 'Campo complementar inválido ou não editável: %.', k;
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

  SELECT name, municipality, state, cnpj, ibge_code
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
    'cnpj_secretaria', COALESCE(org.cnpj, '[PREENCHER: cnpj_secretaria]'),
    'codigo_ibge', COALESCE(org.ibge_code, '[PREENCHER: codigo_ibge]'),
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
    'usuario', COALESCE((SELECT auth.jwt() ->> 'email'), ''),
    'data', pg_catalog.to_char(pg_catalog.now(), 'DD/MM/YYYY'),
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

  IF v_contract_id IS NOT NULL THEN
    IF v_contract.supplier_id IS NOT NULL THEN
      SELECT *
        INTO v_supplier
      FROM public.suppliers
      WHERE id = v_contract.supplier_id
        AND tenant_id = p.tenant_id;
    END IF;

    vars := vars || jsonb_build_object(
      'numero_contrato', v_contract.number,
      'objeto_contrato', v_contract.object,
      'valor_contrato', 'R$ ' || pg_catalog.to_char(v_contract.total_value, 'FM999G999G999G990D00'),
      'valor', 'R$ ' || pg_catalog.to_char(v_contract.total_value, 'FM999G999G999G990D00'),
      'data_inicio', pg_catalog.to_char(v_contract.start_date, 'DD/MM/YYYY'),
      'data_fim', pg_catalog.to_char(v_contract.end_date, 'DD/MM/YYYY'),
      'vigencia_inicio', pg_catalog.to_char(v_contract.start_date, 'DD/MM/YYYY'),
      'vigencia_fim', pg_catalog.to_char(v_contract.end_date, 'DD/MM/YYYY'),
      'gestor', COALESCE(v_contract.manager_name, '[PREENCHER: gestor]'),
      'gestor_nome', COALESCE(v_contract.manager_name, '[PREENCHER: gestor_nome]'),
      'gestor_contrato', COALESCE(v_contract.manager_name, '[PREENCHER: gestor_contrato]'),
      'fiscal', COALESCE(v_contract.inspector_name, '[PREENCHER: fiscal]'),
      'fiscal_nome', COALESCE(v_contract.inspector_name, '[PREENCHER: fiscal_nome]'),
      'fiscal_contrato', COALESCE(v_contract.inspector_name, '[PREENCHER: fiscal_contrato]'),
      'portaria_fiscal', COALESCE(v_contract.ordinance, '[PREENCHER: portaria_fiscal]')
    );

    IF v_supplier.id IS NOT NULL THEN
      vars := vars || jsonb_build_object(
        'fornecedor', v_supplier.legal_name,
        'nome_fantasia', COALESCE(v_supplier.trade_name, ''),
        'cnpj', v_supplier.cnpj,
        'fornecedor_email', COALESCE(v_supplier.contact_email, ''),
        'fornecedor_telefone', COALESCE(v_supplier.contact_phone, '')
      );
    END IF;
  END IF;

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
