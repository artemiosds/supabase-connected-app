BEGIN;
CREATE OR REPLACE FUNCTION public.fn_guard_contract_renewal_addendum()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_template_ok boolean;
  v_can_generate boolean;
  v_blockers text[];
  v_contract_process_id uuid;
  v_template_variables jsonb;
  v_variable record;
  v_variable_key text;
  v_variable_value text;
BEGIN
  -- A renewal draft cannot be reclassified after creation to bypass the
  -- legal/documentary validation that applies to this document type.
  IF TG_OP = 'UPDATE'
     AND OLD.document_type = 'term_addendum_renewal'
     AND NEW.document_type IS DISTINCT FROM OLD.document_type THEN
    RAISE EXCEPTION 'Uma minuta de prorrogação não pode ser reclassificada para outro tipo de documento.'
      USING ERRCODE = '23514';
  END IF;

  -- The dedicated renewal template must always use the guarded document type,
  -- including when a client attempts to create it as a generic/custom draft.
  IF NEW.document_type IS DISTINCT FROM 'term_addendum_renewal' THEN
    IF NEW.template_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.document_templates t
      WHERE t.tenant_id = NEW.tenant_id
        AND t.id = NEW.template_id
        AND t.template_type = 'term_addendum_renewal'
    ) THEN
      RAISE EXCEPTION 'O modelo de prorrogação deve ser gerado como minuta de termo aditivo de prorrogação.'
        USING ERRCODE = '23514';
    END IF;
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

  SELECT t.variables_schema
    INTO v_template_variables
  FROM public.document_templates t
  WHERE t.tenant_id = NEW.tenant_id
    AND t.id = NEW.template_id
    AND t.is_active;

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
$function$
;
COMMIT;
