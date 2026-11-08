-- Harden contract amendment semantics and prevent silent value clamping.
-- Statutory percentage caps are intentionally not hard-coded here; they require
-- a reviewed rule set per contract/legal basis. This enforces sign and amount integrity.
CREATE OR REPLACE FUNCTION public.fn_apply_contract_amendment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_contract_total numeric;
  v_contract_end_date date;
BEGIN
  SELECT c.total_value, c.end_date
    INTO v_contract_total, v_contract_end_date
  FROM public.contracts c
  WHERE c.id = NEW.contract_id
    AND c.tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato do aditivo nao encontrado nesta Secretaria.';
  END IF;

  IF NEW.kind = 'prorrogacao' THEN
    IF NEW.new_end_date IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data final para a prorrogacao.';
    END IF;
    IF NEW.new_end_date <= v_contract_end_date THEN
      RAISE EXCEPTION 'A nova data final deve ser posterior a vigencia atual do contrato.';
    END IF;
    IF NEW.value_change <> 0 THEN
      RAISE EXCEPTION 'A prorrogacao de prazo nao pode alterar o valor do contrato.';
    END IF;

    UPDATE public.contracts
    SET end_date = NEW.new_end_date,
        updated_by = NEW.updated_by
    WHERE id = NEW.contract_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.kind = 'acrescimo' THEN
    IF NEW.value_change <= 0 THEN
      RAISE EXCEPTION 'O acrescimo deve possuir um valor positivo.';
    END IF;
    IF NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Aditivo de acrescimo nao pode alterar a data de vigencia.';
    END IF;

    UPDATE public.contracts
    SET total_value = v_contract_total + NEW.value_change,
        updated_by = NEW.updated_by
    WHERE id = NEW.contract_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.kind = 'supressao' THEN
    IF NEW.value_change >= 0 THEN
      RAISE EXCEPTION 'A supressao deve possuir um valor negativo.';
    END IF;
    IF NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Aditivo de supressao nao pode alterar a data de vigencia.';
    END IF;
    IF v_contract_total + NEW.value_change < 0 THEN
      RAISE EXCEPTION 'A supressao nao pode exceder o valor atual do contrato.';
    END IF;

    UPDATE public.contracts
    SET total_value = v_contract_total + NEW.value_change,
        updated_by = NEW.updated_by
    WHERE id = NEW.contract_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.kind = 'outro' THEN
    IF NEW.value_change <> 0 OR NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Aditivo do tipo outro nao pode alterar prazo ou valor nesta versao.';
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;
