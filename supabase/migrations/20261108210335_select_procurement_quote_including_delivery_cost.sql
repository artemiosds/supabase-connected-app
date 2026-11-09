-- Select the fully landed quote unit price, including delivery cost.
-- Serialize selection by locking the procurement item row; the existing partial
-- unique index ux_procurement_price_quotes_selected remains the final invariant.
CREATE OR REPLACE FUNCTION public.select_procurement_price_quote(
  p_tenant_id uuid,
  p_item_id uuid,
  p_quote_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_quote_total numeric(16,2);
  v_quote_quantity numeric;
  v_effective_unit_price numeric(16,4);
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos') THEN
    RAISE EXCEPTION 'Sem permissao para selecionar a cotacao nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize all reference-quote selection attempts for this item.
  PERFORM 1
  FROM public.procurement_items i
  WHERE i.id = p_item_id
    AND i.tenant_id = p_tenant_id
    AND i.is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item da contratacao nao encontrado ou inativo.';
  END IF;

  -- total_price is a stored generated value: quantity * unit_price + delivery_cost.
  SELECT q.total_price, q.quantity
    INTO v_quote_total, v_quote_quantity
  FROM public.procurement_price_quotes q
  WHERE q.id = p_quote_id
    AND q.tenant_id = p_tenant_id
    AND q.procurement_item_id = p_item_id
    AND q.is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotacao nao encontrada, inativa ou de outro item/Secretaria.';
  END IF;

  IF v_quote_total IS NULL OR v_quote_quantity IS NULL OR v_quote_quantity <= 0 THEN
    RAISE EXCEPTION 'A cotacao nao possui total ou quantidade valida para estimativa.';
  END IF;

  -- Spread delivery cost proportionally across the quoted quantity so the
  -- estimated procurement item value reflects the full landed cost.
  v_effective_unit_price := round(v_quote_total / v_quote_quantity, 4);

  UPDATE public.procurement_price_quotes
  SET selected_for_estimate = false,
      updated_by = (SELECT auth.uid())
  WHERE tenant_id = p_tenant_id
    AND procurement_item_id = p_item_id
    AND selected_for_estimate = true
    AND is_active = true;

  UPDATE public.procurement_price_quotes
  SET selected_for_estimate = true,
      updated_by = (SELECT auth.uid())
  WHERE id = p_quote_id
    AND tenant_id = p_tenant_id
    AND procurement_item_id = p_item_id
    AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel marcar a cotacao como referencia.';
  END IF;

  UPDATE public.procurement_items
  SET estimated_unit_price = v_effective_unit_price,
      updated_by = (SELECT auth.uid())
  WHERE id = p_item_id
    AND tenant_id = p_tenant_id
    AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item da contratacao nao encontrado ou inativo.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid)
  TO authenticated;

COMMENT ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid)
  IS 'Selects a quote as reference and updates the item with the full landed unit cost, including proportionally allocated delivery cost.';
