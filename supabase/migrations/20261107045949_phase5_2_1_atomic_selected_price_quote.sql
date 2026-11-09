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
  v_unit_price numeric(16,4);
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos') THEN
    RAISE EXCEPTION 'Sem permissao para selecionar a cotacao nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  SELECT q.unit_price
    INTO v_unit_price
  FROM public.procurement_price_quotes q
  WHERE q.id = p_quote_id
    AND q.tenant_id = p_tenant_id
    AND q.procurement_item_id = p_item_id
    AND q.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotacao nao encontrada, inativa ou de outro item/Secretaria.';
  END IF;

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

  UPDATE public.procurement_items
  SET estimated_unit_price = v_unit_price,
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
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid)
  TO authenticated;

COMMENT ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid) IS
  'Seleciona atomicamente uma cotacao como referencia e atualiza o preco unitario estimado do item.';