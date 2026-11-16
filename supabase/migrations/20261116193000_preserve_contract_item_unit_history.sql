-- Preserve the meaning of historical quantities after the first ledger movement.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_guard_contract_item_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_contract_total numeric;
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

  SELECT c.total_value
    INTO v_contract_total
  FROM public.contracts c
  WHERE c.tenant_id = NEW.tenant_id
    AND c.id = NEW.contract_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ou Ata não encontrada nesta Secretaria.';
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

COMMIT;
