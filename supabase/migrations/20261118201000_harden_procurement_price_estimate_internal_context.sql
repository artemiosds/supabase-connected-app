BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- The transaction-local setting is not secret. It is accepted only while
-- execution is inside a trusted SECURITY DEFINER function owned by postgres.
CREATE OR REPLACE FUNCTION public.fn_guard_procurement_item_estimate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $function$
DECLARE
  v_internal boolean :=
    current_user='postgres'
    AND COALESCE(pg_catalog.current_setting('app_auth.price_estimate_write',true),'')='on';
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.estimated_price_source<>'manual' AND NOT v_internal THEN
      RAISE EXCEPTION 'A origem do preço do item deve ser registrada pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
    END IF;
  ELSIF ROW(NEW.estimated_unit_price,NEW.estimated_price_source)
      IS DISTINCT FROM ROW(OLD.estimated_unit_price,OLD.estimated_price_source)
    AND NOT v_internal
    AND (OLD.estimated_price_source<>'manual' OR NEW.estimated_price_source<>'manual') THEN
    RAISE EXCEPTION 'Preços derivados de cotação ou aprovados só podem ser alterados pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_process_estimate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $function$
DECLARE
  v_internal boolean :=
    current_user='postgres'
    AND COALESCE(pg_catalog.current_setting('app_auth.price_estimate_write',true),'')='on';
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.estimated_value_source<>'manual' AND NOT v_internal THEN
      RAISE EXCEPTION 'A origem do valor estimado deve ser registrada pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
    END IF;
  ELSIF ROW(NEW.estimated_value,NEW.estimated_value_source)
      IS DISTINCT FROM ROW(OLD.estimated_value,OLD.estimated_value_source)
    AND NOT v_internal
    AND (OLD.estimated_value_source='items' OR NEW.estimated_value_source='items') THEN
    RAISE EXCEPTION 'Estimativa calculada a partir dos itens só pode ser alterada pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Selecting a reference quote legitimately updates protected estimate fields.
-- Run this narrowly authorized RPC as the function owner so the trigger can
-- distinguish it from a caller forging the same custom GUC.
CREATE OR REPLACE FUNCTION public.select_procurement_price_quote(
  p_tenant_id uuid,
  p_item_id uuid,
  p_quote_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_total numeric(16,2);
  v_quantity numeric;
  v_unit numeric(16,4);
  v_process_id uuid;
  v_actor uuid:=(SELECT auth.uid());
BEGIN
  IF v_actor IS NULL
    OR NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:update')
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
    OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'processos') THEN
    RAISE EXCEPTION 'Sem permissão para selecionar a cotação nesta Secretaria.' USING ERRCODE='42501';
  END IF;

  SELECT i.process_id INTO v_process_id
  FROM public.procurement_items i
  WHERE i.id=p_item_id AND i.tenant_id=p_tenant_id AND i.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item da contratação não encontrado ou inativo.';
  END IF;

  SELECT q.total_price,q.quantity INTO v_total,v_quantity
  FROM public.procurement_price_quotes q
  WHERE q.id=p_quote_id
    AND q.tenant_id=p_tenant_id
    AND q.procurement_item_id=p_item_id
    AND q.is_active
  FOR UPDATE;
  IF NOT FOUND OR v_total IS NULL OR v_quantity IS NULL OR v_quantity<=0 THEN
    RAISE EXCEPTION 'Cotação não encontrada, inativa ou sem total/quantidade válidos.';
  END IF;

  v_unit:=round(v_total/v_quantity,4);
  UPDATE public.procurement_price_quotes
  SET selected_for_estimate=false,updated_by=v_actor
  WHERE tenant_id=p_tenant_id
    AND procurement_item_id=p_item_id
    AND selected_for_estimate=true
    AND is_active=true;
  UPDATE public.procurement_price_quotes
  SET selected_for_estimate=true,updated_by=v_actor
  WHERE id=p_quote_id
    AND tenant_id=p_tenant_id
    AND procurement_item_id=p_item_id
    AND is_active=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível marcar a cotação como referência.';
  END IF;

  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
  UPDATE public.procurement_items
  SET estimated_unit_price=v_unit,
      estimated_price_source='quote_reference',
      updated_by=v_actor
  WHERE id=p_item_id AND tenant_id=p_tenant_id AND is_active;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
  PERFORM app_auth.recalculate_procurement_process_estimate(p_tenant_id,v_process_id,v_actor,true);
END;
$function$;

REVOKE ALL ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_guard_procurement_item_estimate() IS
  'Protege preços estimados; o GUC interno só é aceito em contexto SECURITY DEFINER do owner postgres.';
COMMENT ON FUNCTION public.fn_guard_procurement_process_estimate() IS
  'Protege estimativas agregadas; o GUC interno só é aceito em contexto SECURITY DEFINER do owner postgres.';
COMMENT ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid) IS
  'Seleciona cotação de referência com autorização explícita e contexto interno não falsificável por clientes.';
COMMIT;