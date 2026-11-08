CREATE OR REPLACE FUNCTION public.fn_enrich_generated_document_procurement_data()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE
  v_template_content text;
  v_process_estimated numeric(16,2);
  v_items jsonb;
  v_quotes jsonb;
  v_budgets jsonb;
  v_quantities_text text;
  v_quotes_text text;
  v_budgets_text text;
  v_items_estimated numeric(16,2);
  v_item_count integer;
  v_unpriced_item_count integer;
  v_structured_values jsonb := '{}'::jsonb;
  v_variables jsonb;
  v_key text;
  v_value text;
  v_current text;
BEGIN
  IF NEW.process_id IS NULL OR NEW.template_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.estimated_value INTO v_process_estimated
  FROM public.procurement_processes p
  WHERE p.id=NEW.process_id AND p.tenant_id=NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Processo nao encontrado nesta Secretaria.'; END IF;

  SELECT t.content INTO v_template_content
  FROM public.document_templates t
  WHERE t.id=NEW.template_id AND t.tenant_id=NEW.tenant_id AND t.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo inexistente, inativo ou de outra Secretaria.'; END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',i.id,'line_number',i.line_number,'description',i.description,
      'technical_specification',i.technical_specification,'unit',i.unit,'quantity',i.quantity,
      'estimated_unit_price',i.estimated_unit_price,'estimated_total',i.estimated_total,
      'delivery_location',i.delivery_location
    ) ORDER BY i.line_number),'[]'::jsonb),
    COALESCE(string_agg(
      i.line_number::text || '. ' || i.description ||
      E'\\n   Quantidade: ' || pg_catalog.to_char(i.quantity,'FM999999999990D0000') || ' ' || i.unit ||
      CASE WHEN i.estimated_unit_price IS NULL THEN E'\\n   Preco unitario estimado: [PREENCHER]'
       ELSE E'\\n   Preco unitario estimado: R$ ' || pg_catalog.to_char(i.estimated_unit_price,'FM999999999990D0000') END ||
      CASE WHEN i.estimated_total IS NULL THEN E'\\n   Total estimado: [PREENCHER]'
       ELSE E'\\n   Total estimado: R$ ' || pg_catalog.to_char(i.estimated_total,'FM999999999990D00') END ||
      CASE WHEN NULLIF(pg_catalog.btrim(i.technical_specification),'') IS NULL THEN ''
       ELSE E'\\n   Especificacao: ' || i.technical_specification END ||
      CASE WHEN NULLIF(pg_catalog.btrim(i.delivery_location),'') IS NULL THEN ''
       ELSE E'\\n   Local de entrega: ' || i.delivery_location END,
      E'\\n\\n' ORDER BY i.line_number
    ),'[PREENCHER: itens, quantidades e memoria de calculo]'),
    count(*)::integer,
    count(*) FILTER (WHERE i.estimated_total IS NULL)::integer,
    CASE WHEN count(*)=0 OR count(*) FILTER (WHERE i.estimated_total IS NULL)>0 THEN NULL ELSE sum(i.estimated_total) END
  INTO v_items,v_quantities_text,v_item_count,v_unpriced_item_count,v_items_estimated
  FROM public.procurement_items i
  WHERE i.tenant_id=NEW.tenant_id AND i.process_id=NEW.process_id AND i.is_active;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',q.id,'procurement_item_id',q.procurement_item_id,'supplier_id',q.supplier_id,
      'source_name',q.source_name,'reference_url',q.reference_url,'quoted_at',q.quoted_at,
      'quantity',q.quantity,'unit_price',q.unit_price,'delivery_cost',q.delivery_cost,
      'total_price',q.total_price,'selected_for_estimate',q.selected_for_estimate
    ) ORDER BY i.line_number,q.quoted_at,q.source_name),'[]'::jsonb),
    COALESCE(string_agg(
      i.line_number::text || '. ' || i.description ||
      E'\\n   Fonte: ' || q.source_name ||
      E'\\n   Data: ' || pg_catalog.to_char(q.quoted_at,'DD/MM/YYYY') ||
      E'\\n   Quantidade cotada: ' || pg_catalog.to_char(q.quantity,'FM999999999990D0000') ||
      E'\\n   Preco unitario: R$ ' || pg_catalog.to_char(q.unit_price,'FM999999999990D0000') ||
      E'\\n   Frete: R$ ' || pg_catalog.to_char(q.delivery_cost,'FM999999999990D00') ||
      E'\\n   Total cotado: R$ ' || pg_catalog.to_char(q.total_price,'FM999999999990D00') ||
      CASE WHEN q.selected_for_estimate THEN E'\\n   Referencia escolhida pelo responsavel: SIM' ELSE '' END ||
      CASE WHEN q.reference_url IS NULL THEN '' ELSE E'\\n   Referencia: ' || q.reference_url END ||
      CASE WHEN q.notes IS NULL THEN '' ELSE E'\\n   Observacoes: ' || q.notes END,
      E'\\n\\n' ORDER BY i.line_number,q.quoted_at,q.source_name
    ),'[PREENCHER: pesquisa de mercado, fontes, datas e memoria de calculo]')
  INTO v_quotes,v_quotes_text
  FROM public.procurement_price_quotes q
  JOIN public.procurement_items i ON i.id=q.procurement_item_id AND i.tenant_id=q.tenant_id
  WHERE q.tenant_id=NEW.tenant_id AND i.process_id=NEW.process_id AND i.is_active AND q.is_active;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'fiscal_year',b.fiscal_year,'budget_unit',b.budget_unit,
      'functional_program',b.functional_program,'budget_action',b.budget_action,
      'expense_nature',b.expense_nature,'funding_source',b.funding_source,
      'allocated_amount',b.allocated_amount,'notes',b.notes
    ) ORDER BY b.fiscal_year,b.budget_unit),'[]'::jsonb),
    COALESCE(string_agg(
      'Exercicio: ' || b.fiscal_year::text ||
      E'\\n   Unidade orcamentaria: ' || b.budget_unit ||
      CASE WHEN b.functional_program IS NULL THEN '' ELSE E'\\n   Programa funcional: ' || b.functional_program END ||
      CASE WHEN b.budget_action IS NULL THEN '' ELSE E'\\n   Acao orcamentaria: ' || b.budget_action END ||
      CASE WHEN b.expense_nature IS NULL THEN '' ELSE E'\\n   Natureza da despesa: ' || b.expense_nature END ||
      CASE WHEN b.funding_source IS NULL THEN '' ELSE E'\\n   Fonte de recurso: ' || b.funding_source END ||
      E'\\n   Valor alocado: R$ ' || pg_catalog.to_char(b.allocated_amount,'FM999999999990D00') ||
      CASE WHEN b.notes IS NULL THEN '' ELSE E'\\n   Observacoes: ' || b.notes END,
      E'\\n\\n' ORDER BY b.fiscal_year,b.budget_unit
    ),'[PREENCHER: dotacao e classificacao orcamentaria]')
  INTO v_budgets,v_budgets_text
  FROM public.procurement_budget_allocations b
  WHERE b.tenant_id=NEW.tenant_id AND b.process_id=NEW.process_id AND b.is_active;

  IF v_item_count>0 THEN
    v_structured_values:=v_structured_values || jsonb_build_object('quantitativos',v_quantities_text);
  END IF;
  IF jsonb_array_length(v_quotes)>0 THEN
    v_structured_values:=v_structured_values || jsonb_build_object('levantamento_mercado',v_quotes_text,'metodo_estimativa',v_quotes_text);
  END IF;
  IF jsonb_array_length(v_budgets)>0 THEN
    v_structured_values:=v_structured_values || jsonb_build_object('dotacao_orcamentaria',v_budgets_text);
  END IF;
  IF v_process_estimated IS NOT NULL THEN
    v_structured_values:=v_structured_values || jsonb_build_object(
      'valor_estimado','R$ ' || pg_catalog.to_char(v_process_estimated,'FM999999999990D00'));
  ELSIF v_item_count>0 AND v_unpriced_item_count=0 AND v_items_estimated IS NOT NULL THEN
    v_structured_values:=v_structured_values || jsonb_build_object(
      'valor_estimado','R$ ' || pg_catalog.to_char(v_items_estimated,'FM999999999990D00'));
  END IF;

  v_variables:=COALESCE(NEW.variables_snapshot,'{}'::jsonb);
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each_text(v_structured_values)
  LOOP
    v_current:=v_variables->>v_key;
    IF v_current IS NULL OR pg_catalog.btrim(v_current)='' OR v_current LIKE '[PREENCHER:%' THEN
      v_variables:=v_variables || jsonb_build_object(v_key,v_value);
    END IF;
  END LOOP;

  NEW.variables_snapshot:=v_variables;
  NEW.process_snapshot:=COALESCE(NEW.process_snapshot,'{}'::jsonb) || jsonb_build_object(
    'procurement_items',v_items,
    'price_quotes',v_quotes,
    'budget_allocations',v_budgets,
    'calculated_estimated_value',CASE
      WHEN v_process_estimated IS NOT NULL THEN v_process_estimated
      WHEN v_item_count>0 AND v_unpriced_item_count=0 THEN v_items_estimated
      ELSE NULL END,
    'procurement_data_captured_at',pg_catalog.now()
  );

  NEW.content_snapshot:=v_template_content;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each_text(v_variables)
  LOOP
    NEW.content_snapshot:=replace(NEW.content_snapshot,'{{'||v_key||'}}',COALESCE(v_value,'[PREENCHER: '||v_key||']'));
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_enrich_generated_document_procurement_data()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS a_generated_documents_procurement_context ON public.generated_documents;
CREATE TRIGGER a_generated_documents_procurement_context
 BEFORE INSERT ON public.generated_documents
 FOR EACH ROW EXECUTE FUNCTION public.fn_enrich_generated_document_procurement_data();

COMMENT ON FUNCTION public.fn_enrich_generated_document_procurement_data() IS
 'Preenche no rascunho, quando houver dados estruturados, quantidades, pesquisa de precos, dotacoes e snapshot de origem.';
