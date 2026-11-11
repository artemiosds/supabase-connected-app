-- Add tenant-scoped contract and ARP items with an immutable consumption ledger.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS instrument_type text NOT NULL DEFAULT 'contrato';

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.contracts'::regclass
      AND conname = 'contracts_instrument_type_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_instrument_type_check
      CHECK (instrument_type IN ('contrato', 'ata_registro_precos'));
  END IF;
END;
$constraint$;

CREATE TABLE IF NOT EXISTS public.contract_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL,
  line_number integer NOT NULL,
  description text NOT NULL,
  specification text,
  unit text NOT NULL,
  quantity_total numeric(14,4) NOT NULL,
  unit_value numeric(14,4) NOT NULL,
  total_value numeric(16,2) GENERATED ALWAYS AS (round(quantity_total * unit_value, 2)) STORED,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_items_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT contract_items_contract_line_unique UNIQUE (tenant_id, contract_id, line_number),
  CONSTRAINT contract_items_contract_fk
    FOREIGN KEY (tenant_id, contract_id)
    REFERENCES public.contracts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT contract_items_line_number_check CHECK (line_number > 0),
  CONSTRAINT contract_items_description_check
    CHECK (char_length(btrim(description)) BETWEEN 3 AND 500),
  CONSTRAINT contract_items_specification_check
    CHECK (specification IS NULL OR char_length(btrim(specification)) <= 4000),
  CONSTRAINT contract_items_unit_check CHECK (char_length(btrim(unit)) BETWEEN 1 AND 40),
  CONSTRAINT contract_items_quantity_check
    CHECK (quantity_total > 0 AND quantity_total::text <> 'NaN'),
  CONSTRAINT contract_items_unit_value_check
    CHECK (unit_value >= 0 AND unit_value::text <> 'NaN'),
  CONSTRAINT contract_items_notes_check
    CHECK (notes IS NULL OR char_length(btrim(notes)) <= 2000)
);

CREATE INDEX IF NOT EXISTS contract_items_contract_order_idx
  ON public.contract_items (tenant_id, contract_id, line_number, id);

CREATE TABLE IF NOT EXISTS public.contract_item_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  contract_item_id uuid NOT NULL,
  movement_type text NOT NULL,
  quantity numeric(14,4) NOT NULL,
  unit_value_snapshot numeric(14,4) NOT NULL,
  reason text NOT NULL,
  reference_number text,
  reverses_movement_id uuid,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_item_movements_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT contract_item_movements_item_fk
    FOREIGN KEY (tenant_id, contract_item_id)
    REFERENCES public.contract_items (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT contract_item_movements_reversal_fk
    FOREIGN KEY (tenant_id, reverses_movement_id)
    REFERENCES public.contract_item_movements (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT contract_item_movements_type_check
    CHECK (movement_type IN ('consumption', 'reversal')),
  CONSTRAINT contract_item_movements_reversal_shape_check
    CHECK (
      (movement_type = 'consumption' AND reverses_movement_id IS NULL)
      OR (movement_type = 'reversal' AND reverses_movement_id IS NOT NULL)
    ),
  CONSTRAINT contract_item_movements_quantity_check
    CHECK (quantity > 0 AND quantity::text <> 'NaN'),
  CONSTRAINT contract_item_movements_value_check
    CHECK (unit_value_snapshot >= 0 AND unit_value_snapshot::text <> 'NaN'),
  CONSTRAINT contract_item_movements_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  CONSTRAINT contract_item_movements_reference_check
    CHECK (reference_number IS NULL OR char_length(btrim(reference_number)) <= 120)
);

CREATE INDEX IF NOT EXISTS contract_item_movements_item_history_idx
  ON public.contract_item_movements (tenant_id, contract_item_id, created_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS contract_item_movements_single_reversal_idx
  ON public.contract_item_movements (tenant_id, reverses_movement_id)
  WHERE movement_type = 'reversal';

ALTER TABLE public.contract_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contract_item_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_item_movements FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contract_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contract_items TO authenticated;
GRANT ALL ON TABLE public.contract_items TO service_role;
REVOKE ALL ON TABLE public.contract_item_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.contract_item_movements TO authenticated;
GRANT ALL ON TABLE public.contract_item_movements TO service_role;

DROP POLICY IF EXISTS p_contract_items_select ON public.contract_items;
CREATE POLICY p_contract_items_select ON public.contract_items
  FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view'))
    OR (SELECT app_auth.is_platform_admin())
  );
DROP POLICY IF EXISTS p_contract_items_insert ON public.contract_items;
CREATE POLICY p_contract_items_insert ON public.contract_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:update'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );
DROP POLICY IF EXISTS p_contract_items_update ON public.contract_items;
CREATE POLICY p_contract_items_update ON public.contract_items
  FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:update')))
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:update'))
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS p_contract_item_movements_select ON public.contract_item_movements;
CREATE POLICY p_contract_item_movements_select ON public.contract_item_movements
  FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view'))
    OR (SELECT app_auth.is_platform_admin())
  );

DROP POLICY IF EXISTS p_commercial_select_contract_items ON public.contract_items;
CREATE POLICY p_commercial_select_contract_items ON public.contract_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (
      (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
      AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
    )
  );
DROP POLICY IF EXISTS p_commercial_insert_contract_items ON public.contract_items;
CREATE POLICY p_commercial_insert_contract_items ON public.contract_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
  );
DROP POLICY IF EXISTS p_commercial_update_contract_items ON public.contract_items;
CREATE POLICY p_commercial_update_contract_items ON public.contract_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
  )
  WITH CHECK (
    (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
  );

DROP POLICY IF EXISTS p_commercial_select_contract_item_movements ON public.contract_item_movements;
CREATE POLICY p_commercial_select_contract_item_movements ON public.contract_item_movements
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (
      (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
      AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
    )
  );

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

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(pg_catalog.sum(i.total_value), 0)
      INTO v_other_items_total
    FROM public.contract_items i
    WHERE i.tenant_id = NEW.tenant_id
      AND i.contract_id = NEW.contract_id;
  ELSE
    SELECT COALESCE(pg_catalog.sum(i.total_value), 0)
      INTO v_other_items_total
    FROM public.contract_items i
    WHERE i.tenant_id = NEW.tenant_id
      AND i.contract_id = NEW.contract_id
      AND i.id <> NEW.id;
  END IF;

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
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_contract_total_against_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_items_total numeric;
BEGIN
  IF NEW.total_value IS DISTINCT FROM OLD.total_value THEN
    SELECT COALESCE(pg_catalog.sum(i.total_value), 0)
      INTO v_items_total
    FROM public.contract_items i
    WHERE i.tenant_id = NEW.tenant_id
      AND i.contract_id = NEW.id;

    IF NEW.total_value < v_items_total THEN
      RAISE EXCEPTION 'O valor do instrumento não pode ficar abaixo da soma dos itens cadastrados.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_contract_instrument_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.instrument_type IS DISTINCT FROM OLD.instrument_type
     AND EXISTS (
       SELECT 1 FROM public.contract_items i
       WHERE i.tenant_id = OLD.tenant_id AND i.contract_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'O tipo do instrumento não pode ser alterado depois do cadastro de itens.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_validate_contract_item_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_item_id uuid;
  v_quantity numeric;
  v_value numeric;
BEGIN
  IF NEW.created_by IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'O autor do movimento deve corresponder à sessão autenticada.';
  END IF;
  NEW.created_at := pg_catalog.now();

  IF NEW.movement_type = 'consumption' THEN
    IF NEW.reverses_movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'Um consumo não pode referenciar um estorno.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT m.movement_type, m.contract_item_id, m.quantity, m.unit_value_snapshot
    INTO v_type, v_item_id, v_quantity, v_value
  FROM public.contract_item_movements m
  WHERE m.tenant_id = NEW.tenant_id
    AND m.id = NEW.reverses_movement_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_type <> 'consumption'
     OR v_item_id <> NEW.contract_item_id
     OR v_quantity <> NEW.quantity
     OR v_value <> NEW.unit_value_snapshot THEN
    RAISE EXCEPTION 'O estorno deve reverter integralmente um consumo do mesmo item.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contract_item_movements m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.reverses_movement_id = NEW.reverses_movement_id
      AND m.movement_type = 'reversal'
  ) THEN
    RAISE EXCEPTION 'Este consumo já foi estornado.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_contract_item_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  changed_fields jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed_fields := '["line_number","description","specification","unit","quantity_total","unit_value","notes"]'::jsonb;
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(current_row.key ORDER BY current_row.key), '[]'::jsonb)
      INTO changed_fields
    FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(NEW)) AS current_row(key, value)
    WHERE current_row.key NOT IN ('updated_at', 'updated_by')
      AND (pg_catalog.to_jsonb(OLD) -> current_row.key) IS DISTINCT FROM current_row.value;
  END IF;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    NEW.tenant_id, (SELECT auth.uid()), TG_OP, 'contract_items', NEW.id::text,
    pg_catalog.jsonb_build_object('changed_fields', changed_fields), pg_catalog.now()
  );

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_contract_item_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    NEW.tenant_id, (SELECT auth.uid()), 'INSERT', 'contract_item_movements', NEW.id::text,
    pg_catalog.jsonb_build_object('changed_fields',
      CASE WHEN NEW.movement_type = 'consumption'
        THEN '["movement_type","quantity","unit_value_snapshot","reason","reference_number"]'::jsonb
        ELSE '["movement_type","quantity","unit_value_snapshot","reason","reverses_movement_id"]'::jsonb
      END
    ), pg_catalog.now()
  );

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_deny_contract_item_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'O histórico de consumo é imutável; registre um estorno justificado.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_contract_item_consumption(
  p_tenant_id uuid,
  p_contract_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_reference_number text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_total numeric;
  v_unit_value numeric;
  v_status text;
  v_end_date date;
  v_consumed numeric;
  v_movement_id uuid;
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
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text = 'NaN'
     OR pg_catalog.round(p_quantity, 4) <> p_quantity THEN
    RAISE EXCEPTION 'Informe uma quantidade positiva com até quatro casas decimais.';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Informe o motivo do consumo (10 a 1000 caracteres).';
  END IF;
  IF p_reference_number IS NOT NULL AND char_length(btrim(p_reference_number)) > 120 THEN
    RAISE EXCEPTION 'A referência não pode ultrapassar 120 caracteres.';
  END IF;

  SELECT i.quantity_total, i.unit_value, c.status, c.end_date
    INTO v_total, v_unit_value, v_status, v_end_date
  FROM public.contract_items i
  JOIN public.contracts c
    ON c.tenant_id = i.tenant_id AND c.id = i.contract_id
  WHERE i.tenant_id = p_tenant_id
    AND i.id = p_contract_item_id
  FOR UPDATE OF i, c;

  IF NOT FOUND OR v_status <> 'vigente' OR v_end_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Item ou instrumento vigente não encontrado nesta Secretaria.';
  END IF;

  SELECT COALESCE(pg_catalog.sum(
    CASE WHEN m.movement_type = 'consumption' THEN m.quantity ELSE -m.quantity END
  ), 0)
    INTO v_consumed
  FROM public.contract_item_movements m
  WHERE m.tenant_id = p_tenant_id AND m.contract_item_id = p_contract_item_id;

  IF p_quantity > v_total - v_consumed THEN
    RAISE EXCEPTION 'A quantidade solicitada supera o saldo disponível do item.';
  END IF;

  INSERT INTO public.contract_item_movements (
    tenant_id, contract_item_id, movement_type, quantity, unit_value_snapshot,
    reason, reference_number, created_by
  )
  VALUES (
    p_tenant_id, p_contract_item_id, 'consumption', p_quantity, v_unit_value,
    pg_catalog.btrim(p_reason), NULLIF(pg_catalog.btrim(p_reference_number), ''), v_actor
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_contract_item_consumption(
  p_tenant_id uuid,
  p_movement_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_item_id uuid;
  v_quantity numeric;
  v_value numeric;
  v_reversal_id uuid;
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
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Informe a justificativa do estorno (10 a 1000 caracteres).';
  END IF;

  SELECT m.contract_item_id, m.quantity, m.unit_value_snapshot
    INTO v_item_id, v_quantity, v_value
  FROM public.contract_item_movements m
  JOIN public.contract_items i
    ON i.tenant_id = m.tenant_id AND i.id = m.contract_item_id
  WHERE m.tenant_id = p_tenant_id
    AND m.id = p_movement_id
    AND m.movement_type = 'consumption'
  FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consumo não encontrado nesta Secretaria.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contract_item_movements m
    WHERE m.tenant_id = p_tenant_id
      AND m.reverses_movement_id = p_movement_id
      AND m.movement_type = 'reversal'
  ) THEN
    RAISE EXCEPTION 'Este consumo já foi estornado.';
  END IF;

  INSERT INTO public.contract_item_movements (
    tenant_id, contract_item_id, movement_type, quantity, unit_value_snapshot,
    reason, reverses_movement_id, created_by
  )
  VALUES (
    p_tenant_id, v_item_id, 'reversal', v_quantity, v_value,
    pg_catalog.btrim(p_reason), p_movement_id, v_actor
  )
  RETURNING id INTO v_reversal_id;

  RETURN v_reversal_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_contract_item_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_contract_total_against_items() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_contract_instrument_type() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_validate_contract_item_movement() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_audit_contract_item_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_audit_contract_item_movement() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_deny_contract_item_movement_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_contract_item_consumption(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reverse_contract_item_consumption(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_contract_item_consumption(uuid, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_contract_item_consumption(uuid, uuid, text) TO authenticated;

CREATE TRIGGER trg_guard_contract_item_write
  BEFORE INSERT OR UPDATE ON public.contract_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_contract_item_write();
CREATE TRIGGER trg_guard_contract_total_against_items
  BEFORE UPDATE OF total_value ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_contract_total_against_items();
CREATE TRIGGER trg_guard_contract_instrument_type
  BEFORE UPDATE OF instrument_type ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_contract_instrument_type();
CREATE TRIGGER trg_validate_contract_item_movement
  BEFORE INSERT ON public.contract_item_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_contract_item_movement();
CREATE TRIGGER trg_audit_contract_item_write
  AFTER INSERT OR UPDATE ON public.contract_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_contract_item_write();
CREATE TRIGGER trg_audit_contract_item_movement
  AFTER INSERT ON public.contract_item_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_contract_item_movement();
CREATE TRIGGER trg_deny_contract_item_movement_mutation
  BEFORE UPDATE OR DELETE ON public.contract_item_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_deny_contract_item_movement_mutation();

COMMENT ON TABLE public.contract_items IS
  'Itens vinculados a contrato ou Ata de Registro de Preços, com saldo controlado por movimento.';
COMMENT ON COLUMN public.contracts.instrument_type IS
  'Distingue contrato formal de Ata de Registro de Preços.';
COMMENT ON TABLE public.contract_item_movements IS
  'Livro razão imutável de consumos e estornos dos itens de contratos e Atas.';
COMMENT ON COLUMN public.contract_item_movements.unit_value_snapshot IS
  'Valor unitário do item no momento do consumo ou estorno.';

COMMIT;
