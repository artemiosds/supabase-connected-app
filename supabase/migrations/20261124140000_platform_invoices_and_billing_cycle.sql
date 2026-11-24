-- =============================================================================
-- Frente 4 (Painel Master): Faturas, Mensalidades e Gestão de Inadimplência
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  reference_month text NOT NULL CHECK (reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  plan_tier text NOT NULL CHECK (plan_tier IN ('basico', 'profissional', 'enterprise', 'consorcio')),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  paid_at timestamptz,
  payment_method text NOT NULL DEFAULT 'manual'
    CHECK (payment_method IN ('manual', 'pix', 'boleto', 'cartao', 'transferencia', 'gateway')),
  external_reference text,
  payment_url text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_invoices_tenant_month_active
  ON public.platform_invoices (tenant_id, reference_month)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_platform_invoices_status_due_date
  ON public.platform_invoices (status, due_date);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant_due_date
  ON public.platform_invoices (tenant_id, due_date DESC);

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_invoices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_invoices TO authenticated;

DROP POLICY IF EXISTS p_platform_invoices_master_select ON public.platform_invoices;
CREATE POLICY p_platform_invoices_master_select
  ON public.platform_invoices
  FOR SELECT
  TO authenticated
  USING (app_auth.is_platform_admin());

-- Gerar mensalidades em lote para clientes ativos com mensalidade > 0
CREATE OR REPLACE FUNCTION public.generate_monthly_platform_invoices(
  p_reference_month text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_ref text;
  v_month_start date;
  v_month_last_day integer;
  v_inserted integer := 0;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode gerar faturas mensais.'
      USING ERRCODE = '42501';
  END IF;

  v_ref := COALESCE(
    NULLIF(pg_catalog.btrim(p_reference_month), ''),
    pg_catalog.to_char(pg_catalog.current_date, 'YYYY-MM')
  );
  IF v_ref !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Competência inválida. Use o formato AAAA-MM.' USING ERRCODE = '22023';
  END IF;

  v_month_start := pg_catalog.to_date(v_ref || '-01', 'YYYY-MM-DD');
  v_month_last_day := EXTRACT(
    DAY FROM (v_month_start + interval '1 month' - interval '1 day')
  )::integer;

  WITH inserted AS (
    INSERT INTO public.platform_invoices (
      tenant_id,
      reference_month,
      plan_tier,
      amount,
      due_date,
      status,
      payment_method,
      created_by,
      updated_by
    )
    SELECT
      t.id,
      v_ref,
      t.plan_tier,
      t.monthly_fee,
      (v_month_start + (LEAST(GREATEST(t.billing_day, 1), v_month_last_day) - 1))::date,
      'pending',
      'manual',
      v_actor,
      v_actor
    FROM public.tenants t
    WHERE t.status = 'active'
      AND t.commercial_status = 'active'
      AND t.monthly_fee > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.platform_invoices inv
        WHERE inv.tenant_id = t.id
          AND inv.reference_month = v_ref
          AND inv.status <> 'cancelled'
      )
    RETURNING id
  )
  SELECT count(*)::integer INTO v_inserted FROM inserted;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL,
    v_actor,
    'PLATFORM_INVOICES_BATCH_GENERATED',
    'platform_invoices',
    v_ref,
    pg_catalog.jsonb_build_object(
      'reference_month', v_ref,
      'generated_count', v_inserted
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'reference_month', v_ref,
    'generated_count', v_inserted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_monthly_platform_invoices(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_monthly_platform_invoices(text)
  TO authenticated;

-- Criar fatura avulsa ou manual para uma Secretaria específica
CREATE OR REPLACE FUNCTION public.create_platform_invoice(
  p_tenant_id uuid,
  p_reference_month text,
  p_amount numeric,
  p_due_date date,
  p_payment_method text DEFAULT 'manual',
  p_notes text DEFAULT NULL
)
RETURNS public.platform_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_plan text;
  v_row public.platform_invoices;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode emitir faturas.'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.plan_tier INTO v_plan
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Secretaria não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_reference_month IS NULL OR p_reference_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Competência inválida. Use o formato AAAA-MM.' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'O valor da fatura não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data de vencimento da fatura.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_invoices (
    tenant_id,
    reference_month,
    plan_tier,
    amount,
    due_date,
    status,
    payment_method,
    notes,
    created_by,
    updated_by
  )
  VALUES (
    p_tenant_id,
    p_reference_month,
    v_plan,
    p_amount,
    p_due_date,
    CASE WHEN p_due_date < pg_catalog.current_date THEN 'overdue' ELSE 'pending' END,
    COALESCE(NULLIF(pg_catalog.btrim(p_payment_method), ''), 'manual'),
    NULLIF(pg_catalog.btrim(p_notes), ''),
    v_actor,
    v_actor
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    p_tenant_id,
    v_actor,
    'PLATFORM_INVOICE_CREATED',
    'platform_invoices',
    v_row.id::text,
    pg_catalog.jsonb_build_object(
      'reference_month', v_row.reference_month,
      'amount', v_row.amount,
      'due_date', v_row.due_date,
      'status', v_row.status
    ),
    pg_catalog.now()
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_platform_invoice(uuid, text, numeric, date, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_platform_invoice(uuid, text, numeric, date, text, text)
  TO authenticated;

-- Atualizar status da fatura (baixa de pagamento, atraso ou cancelamento)
-- e sincronizar situação comercial da Secretaria quando solicitado
CREATE OR REPLACE FUNCTION public.update_platform_invoice_status(
  p_invoice_id uuid,
  p_status text,
  p_payment_method text DEFAULT NULL,
  p_external_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_sync_tenant_status boolean DEFAULT true
)
RETURNS public.platform_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_row public.platform_invoices;
  v_tenant_status text;
  v_other_overdue boolean;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode atualizar faturas.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'paid', 'overdue', 'cancelled') THEN
    RAISE EXCEPTION 'Status de fatura inválido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_invoices
  SET
    status = p_status,
    paid_at = CASE
      WHEN p_status = 'paid' THEN COALESCE(paid_at, pg_catalog.now())
      ELSE NULL
    END,
    payment_method = COALESCE(NULLIF(pg_catalog.btrim(p_payment_method), ''), payment_method),
    external_reference = COALESCE(
      NULLIF(pg_catalog.btrim(p_external_reference), ''),
      external_reference
    ),
    notes = COALESCE(NULLIF(pg_catalog.btrim(p_notes), ''), notes),
    updated_by = v_actor,
    updated_at = pg_catalog.now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Fatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(p_sync_tenant_status, true) THEN
    SELECT t.commercial_status INTO v_tenant_status
    FROM public.tenants t
    WHERE t.id = v_row.tenant_id;

    IF p_status = 'paid' AND v_tenant_status = 'blocked_billing' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.platform_invoices inv
        WHERE inv.tenant_id = v_row.tenant_id
          AND inv.id <> v_row.id
          AND inv.status = 'overdue'
      ) INTO v_other_overdue;

      IF NOT v_other_overdue THEN
        UPDATE public.tenants
        SET commercial_status = 'active', status = 'active'
        WHERE id = v_row.tenant_id;
      END IF;
    ELSIF p_status = 'overdue' AND v_tenant_status = 'active' THEN
      UPDATE public.tenants
      SET commercial_status = 'blocked_billing'
      WHERE id = v_row.tenant_id;
    END IF;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    v_row.tenant_id,
    v_actor,
    'PLATFORM_INVOICE_STATUS_UPDATED',
    'platform_invoices',
    v_row.id::text,
    pg_catalog.jsonb_build_object(
      'status', v_row.status,
      'reference_month', v_row.reference_month,
      'amount', v_row.amount,
      'payment_method', v_row.payment_method,
      'sync_tenant_status', COALESCE(p_sync_tenant_status, true)
    ),
    pg_catalog.now()
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_platform_invoice_status(uuid, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_platform_invoice_status(uuid, text, text, text, text, boolean)
  TO authenticated;

-- Marcar faturas pendentes vencidas e opcionalmente bloquear Secretarias inadimplentes
CREATE OR REPLACE FUNCTION public.sync_overdue_platform_invoices(
  p_block_delinquent_tenants boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_overdue_count integer := 0;
  v_blocked_count integer := 0;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode sincronizar inadimplência.'
      USING ERRCODE = '42501';
  END IF;

  WITH marked AS (
    UPDATE public.platform_invoices
    SET
      status = 'overdue',
      updated_by = v_actor,
      updated_at = pg_catalog.now()
    WHERE status = 'pending'
      AND due_date < pg_catalog.current_date
    RETURNING id
  )
  SELECT count(*)::integer INTO v_overdue_count FROM marked;

  IF COALESCE(p_block_delinquent_tenants, false) THEN
    WITH blocked AS (
      UPDATE public.tenants t
      SET commercial_status = 'blocked_billing'
      WHERE t.commercial_status = 'active'
        AND EXISTS (
          SELECT 1
          FROM public.platform_invoices inv
          WHERE inv.tenant_id = t.id
            AND inv.status = 'overdue'
        )
      RETURNING t.id
    )
    SELECT count(*)::integer INTO v_blocked_count FROM blocked;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    NULL,
    v_actor,
    'PLATFORM_INVOICES_OVERDUE_SYNC',
    'platform_invoices',
    pg_catalog.to_char(pg_catalog.current_date, 'YYYY-MM-DD'),
    pg_catalog.jsonb_build_object(
      'overdue_marked', v_overdue_count,
      'tenants_blocked', v_blocked_count
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'overdue_marked', v_overdue_count,
    'tenants_blocked', v_blocked_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_overdue_platform_invoices(boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_overdue_platform_invoices(boolean)
  TO authenticated;
