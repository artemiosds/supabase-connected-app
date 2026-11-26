-- Hardening de Contratos, Aditivos (Lei nº 14.133/2021 arts. 84, 107, 125 e 136),
-- Itens/Saldos e Registro Atômico de Ordens de Fornecimento.

-- 1) Ampliar os tipos de termo aditivo/apostilamento permitidos no ledger contratual
ALTER TABLE public.contract_amendments
  DROP CONSTRAINT IF EXISTS contract_amendments_kind_check;

ALTER TABLE public.contract_amendments
  ADD CONSTRAINT contract_amendments_kind_check
  CHECK (
    kind = ANY (
      ARRAY[
        'prorrogacao'::text,
        'acrescimo'::text,
        'supressao'::text,
        'reajuste'::text,
        'apostilamento'::text,
        'outro'::text
      ]
    )
  );

-- 2) Garantir imutabilidade dos termos aditivos já aplicados ao contrato
CREATE OR REPLACE FUNCTION public.fn_deny_contract_amendment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Termos aditivos formalizados não podem ser editados ou excluídos; registre um novo termo para retificação.'
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_contract_amendments_deny_mutation ON public.contract_amendments;
CREATE TRIGGER trg_contract_amendments_deny_mutation
  BEFORE UPDATE OR DELETE ON public.contract_amendments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_deny_contract_amendment_mutation();

-- 3) Endurecer aplicação de termos aditivos com regras da Lei nº 14.133/2021 e Decreto nº 11.462/2023
CREATE OR REPLACE FUNCTION public.fn_apply_contract_amendment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_contract_total numeric;
  v_contract_start_date date;
  v_contract_end_date date;
  v_contract_status text;
  v_instrument_type text;
  v_items_total numeric;
  v_prior_net_change numeric := 0;
  v_prior_reajustes numeric := 0;
  v_prior_acrescimos numeric := 0;
  v_original_value numeric;
  v_valor_inicial_atualizado numeric;
BEGIN
  IF NEW.signed_at > CURRENT_DATE THEN
    RAISE EXCEPTION 'A data de assinatura não pode ser futura.';
  END IF;

  SELECT c.total_value, c.start_date, c.end_date, c.status, c.instrument_type
    INTO v_contract_total, v_contract_start_date, v_contract_end_date, v_contract_status, v_instrument_type
  FROM public.contracts c
  WHERE c.id = NEW.contract_id
    AND c.tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato do aditivo não encontrado nesta Secretaria.';
  END IF;

  IF v_contract_status IN ('arquivado', 'rescindido') THEN
    RAISE EXCEPTION 'Instrumentos rescindidos ou arquivados não podem receber novos termos aditivos.';
  END IF;

  IF NEW.kind = 'prorrogacao' THEN
    IF NEW.signed_at > v_contract_end_date THEN
      RAISE EXCEPTION 'A prorrogação deve ser assinada até o término da vigência atual (vedada prorrogação retroativa).';
    END IF;
    IF NEW.new_end_date IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data final para a prorrogação.';
    END IF;
    IF NEW.new_end_date <= v_contract_end_date THEN
      RAISE EXCEPTION 'A nova data final deve ser posterior à vigência atual do contrato.';
    END IF;
    IF NEW.value_change <> 0 THEN
      RAISE EXCEPTION 'A prorrogação de prazo não pode alterar o valor do contrato.';
    END IF;
    IF v_instrument_type = 'ata_registro_precos'
       AND NEW.new_end_date > (v_contract_start_date + interval '2 years' - interval '1 day')::date THEN
      RAISE EXCEPTION 'Ata de Registro de Preços não pode ultrapassar 24 meses de vigência total (art. 84 da Lei nº 14.133/2021).';
    END IF;
    IF v_instrument_type = 'contrato'
       AND NEW.new_end_date > (v_contract_start_date + interval '10 years' - interval '1 day')::date THEN
      RAISE EXCEPTION 'A prorrogação ultrapassa o limite máximo decenal (120 meses) previsto no art. 107 da Lei nº 14.133/2021.';
    END IF;

    UPDATE public.contracts
    SET end_date = NEW.new_end_date,
        updated_by = NEW.updated_by
    WHERE id = NEW.contract_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.kind = 'acrescimo' THEN
    IF v_instrument_type = 'ata_registro_precos' THEN
      RAISE EXCEPTION 'É vedado efetuar acréscimos nos quantitativos ou valores da Ata de Registro de Preços (Decreto nº 11.462/2023, art. 23).';
    END IF;
    IF NEW.value_change <= 0 THEN
      RAISE EXCEPTION 'O acréscimo deve possuir um valor positivo.';
    END IF;
    IF NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Aditivo de acréscimo não pode alterar a data de vigência.';
    END IF;

    -- Apurar o valor inicial atualizado (art. 125) considerando apenas termos já existentes antes deste INSERT
    SELECT
      COALESCE(pg_catalog.sum(a.value_change), 0),
      COALESCE(pg_catalog.sum(CASE WHEN a.kind IN ('reajuste', 'apostilamento') THEN a.value_change ELSE 0 END), 0),
      COALESCE(pg_catalog.sum(CASE WHEN a.kind = 'acrescimo' AND a.value_change > 0 THEN a.value_change ELSE 0 END), 0)
    INTO v_prior_net_change, v_prior_reajustes, v_prior_acrescimos
    FROM public.contract_amendments a
    WHERE a.tenant_id = NEW.tenant_id
      AND a.contract_id = NEW.contract_id
      AND a.id <> NEW.id;

    v_original_value := v_contract_total - v_prior_net_change;
    v_valor_inicial_atualizado := v_original_value + v_prior_reajustes;

    IF v_valor_inicial_atualizado > 0
       AND (v_prior_acrescimos + NEW.value_change) > (pg_catalog.round(v_valor_inicial_atualizado * 0.50, 2) + 0.01) THEN
      RAISE EXCEPTION 'A soma acumulada de acréscimos (sem compensação com supressões) ultrapassa o limite legal máximo de 50%% do valor inicial atualizado (art. 125 da Lei nº 14.133/2021).';
    END IF;

    UPDATE public.contracts
    SET total_value = v_contract_total + NEW.value_change,
        updated_by = NEW.updated_by
    WHERE id = NEW.contract_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.kind = 'supressao' THEN
    IF NEW.value_change >= 0 THEN
      RAISE EXCEPTION 'A supressão deve possuir um valor negativo.';
    END IF;
    IF NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Aditivo de supressão não pode alterar a data de vigencia.';
    END IF;
    IF v_contract_total + NEW.value_change < 0 THEN
      RAISE EXCEPTION 'A supressão não pode exceder o valor atual do contrato.';
    END IF;

    SELECT COALESCE(pg_catalog.sum(i.total_value), 0)
      INTO v_items_total
    FROM public.contract_items i
    WHERE i.tenant_id = NEW.tenant_id
      AND i.contract_id = NEW.contract_id;

    IF v_items_total > v_contract_total + NEW.value_change THEN
      RAISE EXCEPTION 'A supressão não pode reduzir o valor do contrato abaixo da soma dos itens cadastrados. Ajuste os itens antes do aditivo.';
    END IF;

    UPDATE public.contracts
    SET total_value = v_contract_total + NEW.value_change,
        updated_by = NEW.updated_by
    WHERE id = NEW.contract_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.kind IN ('reajuste', 'apostilamento') THEN
    IF NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Termo de reajuste ou apostilamento não altera a data de vigência.';
    END IF;
    IF NEW.kind = 'reajuste' AND NEW.value_change = 0 THEN
      RAISE EXCEPTION 'Informe a variação financeira do reajuste ou repactuação.';
    END IF;
    IF NEW.value_change <> 0 THEN
      IF v_contract_total + NEW.value_change < 0 THEN
        RAISE EXCEPTION 'A atualização financeira não pode tornar negativo o valor do contrato.';
      END IF;

      SELECT COALESCE(pg_catalog.sum(i.total_value), 0)
        INTO v_items_total
      FROM public.contract_items i
      WHERE i.tenant_id = NEW.tenant_id
        AND i.contract_id = NEW.contract_id;

      IF v_items_total > v_contract_total + NEW.value_change THEN
        RAISE EXCEPTION 'O novo valor do contrato não pode ficar abaixo da soma dos itens cadastrados.';
      END IF;

      UPDATE public.contracts
      SET total_value = v_contract_total + NEW.value_change,
          updated_by = NEW.updated_by
      WHERE id = NEW.contract_id
        AND tenant_id = NEW.tenant_id;
    END IF;

  ELSIF NEW.kind = 'outro' THEN
    IF NEW.value_change <> 0 OR NEW.new_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Aditivo do tipo outro não pode alterar prazo ou valor nesta versão.';
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- 4) Impedir alteração de instrument_type também após aditivos ou avaliações de renovação
CREATE OR REPLACE FUNCTION public.fn_guard_contract_instrument_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.instrument_type IS DISTINCT FROM OLD.instrument_type
     AND (
       EXISTS (
         SELECT 1 FROM public.contract_items i
         WHERE i.tenant_id = OLD.tenant_id AND i.contract_id = OLD.id
       )
       OR EXISTS (
         SELECT 1 FROM public.contract_amendments a
         WHERE a.tenant_id = OLD.tenant_id AND a.contract_id = OLD.id
       )
       OR EXISTS (
         SELECT 1 FROM public.contract_renewal_assessments r
         WHERE r.tenant_id = OLD.tenant_id AND r.contract_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION 'O tipo do instrumento não pode ser alterado depois do cadastro de itens, aditivos ou análises de renovação.';
  END IF;

  RETURN NEW;
END;
$function$;

-- 5) Exigir contrato vigente para inclusão/alteração cadastral de itens
CREATE OR REPLACE FUNCTION public.fn_guard_contract_item_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_contract_total numeric;
  v_contract_status text;
  v_other_items_total numeric;
  v_used_quantity numeric;
  v_has_movements boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A identidade e o vínculo do item são imutáveis.';
    END IF;
  ELSE
    NEW.created_by := (SELECT auth.uid());
    NEW.created_at := pg_catalog.now();
  END IF;

  NEW.updated_by := (SELECT auth.uid());
  NEW.updated_at := pg_catalog.now();

  SELECT c.total_value, c.status
    INTO v_contract_total, v_contract_status
  FROM public.contracts c
  WHERE c.tenant_id = NEW.tenant_id
    AND c.id = NEW.contract_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ou Ata não encontrada nesta Secretaria.';
  END IF;

  IF v_contract_status <> 'vigente' THEN
    RAISE EXCEPTION 'Somente instrumentos vigentes permitem incluir ou alterar itens.';
  END IF;

  SELECT COALESCE(pg_catalog.sum(i.total_value), 0)
    INTO v_other_items_total
  FROM public.contract_items i
  WHERE i.tenant_id = NEW.tenant_id
    AND i.contract_id = NEW.contract_id
    AND (TG_OP = 'INSERT' OR i.id <> NEW.id);

  IF v_other_items_total + pg_catalog.round(NEW.quantity_total * NEW.unit_value, 2) > v_contract_total THEN
    RAISE EXCEPTION 'A soma dos itens não pode superar o valor total do instrumento.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(pg_catalog.sum(
      CASE WHEN m.movement_type = 'consumption' THEN m.quantity ELSE -m.quantity END
    ), 0)
      INTO v_used_quantity
    FROM public.contract_item_movements m
    WHERE m.tenant_id = OLD.tenant_id
      AND m.contract_item_id = OLD.id;

    IF NEW.quantity_total < v_used_quantity THEN
      RAISE EXCEPTION 'A quantidade total não pode ficar abaixo do saldo já consumido.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.contract_item_movements m
      WHERE m.tenant_id = OLD.tenant_id AND m.contract_item_id = OLD.id
    ) INTO v_has_movements;

    IF v_has_movements
       AND (
         NEW.unit IS DISTINCT FROM OLD.unit
         OR NEW.unit_value IS DISTINCT FROM OLD.unit_value
       ) THEN
      RAISE EXCEPTION 'A unidade e o valor unitário não podem ser alterados após a primeira movimentação.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6) Registro atômico em lote de Ordem de Fornecimento (evita consumo parcial em caso de erro)
CREATE OR REPLACE FUNCTION public.record_supply_order_consumption(
  p_tenant_id uuid,
  p_contract_id uuid,
  p_reference_number text,
  p_reason text,
  p_items jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_clean_ref text;
  v_clean_reason text;
  v_status text;
  v_end_date date;
  v_requested_count integer := 0;
  v_distinct_count integer := 0;
  v_locked_count integer := 0;
  v_item record;
  v_consumed numeric;
  v_movement_id uuid;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL
     OR NOT (SELECT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update'))
     OR NOT (SELECT app_auth.is_tenant_in_good_standing(p_tenant_id))
     OR NOT (SELECT app_auth.is_tenant_module_enabled(p_tenant_id, 'contratos'))
     OR NOT EXISTS (
       SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.status = 'active'
     ) THEN
    RAISE EXCEPTION 'Sem permissão ou módulo de contratos indisponível nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  v_clean_ref := NULLIF(pg_catalog.btrim(p_reference_number), '');
  IF v_clean_ref IS NULL OR pg_catalog.char_length(v_clean_ref) > 120 THEN
    RAISE EXCEPTION 'Informe o número da Ordem de Fornecimento / Empenho (até 120 caracteres).';
  END IF;

  v_clean_reason := pg_catalog.btrim(COALESCE(p_reason, ''));
  IF pg_catalog.char_length(v_clean_reason) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Informe o destino ou motivo da ordem (10 a 1000 caracteres).';
  END IF;

  IF p_items IS NULL
     OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) = 0
     OR pg_catalog.jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'Informe entre 1 e 500 itens válidos para registrar a ordem.';
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT x.contract_item_id)
  INTO v_requested_count, v_distinct_count
  FROM pg_catalog.jsonb_to_recordset(p_items) AS x(contract_item_id uuid, quantity numeric)
  WHERE x.contract_item_id IS NOT NULL
    AND x.quantity IS NOT NULL
    AND x.quantity > 0
    AND x.quantity::text <> 'NaN'
    AND pg_catalog.round(x.quantity, 4) = x.quantity;

  IF v_requested_count <> pg_catalog.jsonb_array_length(p_items)
     OR v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'Os itens da ordem possuem identificação duplicada ou quantidade inválida.';
  END IF;

  -- Serializa operações concorrentes no mesmo instrumento
  SELECT c.status, c.end_date
    INTO v_status, v_end_date
  FROM public.contracts c
  WHERE c.tenant_id = p_tenant_id
    AND c.id = p_contract_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'vigente' OR v_end_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Instrumento vigente não encontrado ou fora da vigência nesta Secretaria.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contract_item_movements m
    JOIN public.contract_items i
      ON i.tenant_id = m.tenant_id AND i.id = m.contract_item_id
    WHERE m.tenant_id = p_tenant_id
      AND i.contract_id = p_contract_id
      AND m.movement_type = 'consumption'
      AND pg_catalog.lower(pg_catalog.btrim(COALESCE(m.reference_number, ''))) = pg_catalog.lower(v_clean_ref)
  ) THEN
    RAISE EXCEPTION 'Já existe consumo registrado com esta referência de OF/Empenho neste instrumento.';
  END IF;

  -- Bloqueia todos os itens em ordem determinística (id ASC) para evitar deadlocks
  FOR v_item IN
    SELECT
      i.id,
      i.description,
      i.quantity_total,
      i.unit_value,
      req.quantity AS requested_quantity
    FROM public.contract_items i
    JOIN pg_catalog.jsonb_to_recordset(p_items) AS req(contract_item_id uuid, quantity numeric)
      ON req.contract_item_id = i.id
    WHERE i.tenant_id = p_tenant_id
      AND i.contract_id = p_contract_id
    ORDER BY i.id ASC
    FOR UPDATE OF i
  LOOP
    v_locked_count := v_locked_count + 1;

    SELECT COALESCE(pg_catalog.sum(
      CASE WHEN m.movement_type = 'consumption' THEN m.quantity ELSE -m.quantity END
    ), 0)
      INTO v_consumed
    FROM public.contract_item_movements m
    WHERE m.tenant_id = p_tenant_id
      AND m.contract_item_id = v_item.id;

    IF v_item.requested_quantity > v_item.quantity_total - v_consumed THEN
      RAISE EXCEPTION 'Saldo insuficiente para o item "%". A operação inteira foi cancelada.', v_item.description;
    END IF;

    INSERT INTO public.contract_item_movements (
      tenant_id, contract_item_id, movement_type, quantity, unit_value_snapshot,
      reason, reference_number, created_by
    )
    VALUES (
      p_tenant_id, v_item.id, 'consumption', v_item.requested_quantity, v_item.unit_value,
      v_clean_reason, v_clean_ref, v_actor
    )
    RETURNING id INTO v_movement_id;

    v_movement_ids := pg_catalog.array_append(v_movement_ids, v_movement_id);
  END LOOP;

  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais itens não pertencem a este instrumento.';
  END IF;

  RETURN v_movement_ids;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_supply_order_consumption(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supply_order_consumption(uuid, uuid, text, text, jsonb) TO authenticated;
