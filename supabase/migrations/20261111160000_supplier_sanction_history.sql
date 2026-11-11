-- Add tenant-scoped, auditable supplier sanction history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS public.supplier_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  measure text NOT NULL,
  reason text NOT NULL,
  legal_basis text,
  reference_number text,
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_sanctions_measure_check
    CHECK (char_length(btrim(measure)) BETWEEN 2 AND 160),
  CONSTRAINT supplier_sanctions_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 10 AND 4000),
  CONSTRAINT supplier_sanctions_legal_basis_check
    CHECK (legal_basis IS NULL OR char_length(btrim(legal_basis)) <= 500),
  CONSTRAINT supplier_sanctions_reference_check
    CHECK (reference_number IS NULL OR char_length(btrim(reference_number)) <= 120),
  CONSTRAINT supplier_sanctions_dates_check
    CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT supplier_sanctions_status_check
    CHECK (status IN ('active', 'revoked', 'completed')),
  CONSTRAINT supplier_sanctions_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT supplier_sanctions_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES public.suppliers(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS supplier_sanctions_supplier_period_idx
  ON public.supplier_sanctions (tenant_id, supplier_id, start_date DESC, id);
CREATE INDEX IF NOT EXISTS supplier_sanctions_active_end_date_idx
  ON public.supplier_sanctions (tenant_id, end_date)
  WHERE status = 'active';

ALTER TABLE public.supplier_sanctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_sanctions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_sanctions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.supplier_sanctions TO authenticated;
GRANT ALL ON TABLE public.supplier_sanctions TO service_role;

CREATE POLICY p_supplier_sanctions_select
  ON public.supplier_sanctions FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_supplier_permission(tenant_id, 'suppliers:view')));
CREATE POLICY p_supplier_sanctions_insert
  ON public.supplier_sanctions FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );
CREATE POLICY p_supplier_sanctions_update
  ON public.supplier_sanctions FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_supplier_permission(tenant_id, 'suppliers:update')))
  WITH CHECK (
    (SELECT app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
    AND updated_by = (SELECT auth.uid())
  );

CREATE OR REPLACE FUNCTION public.fn_protect_supplier_sanction_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := pg_catalog.now();
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Identidade, fornecedor e dados de criação são imutáveis.';
  END IF;
  IF OLD.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'O estado de uma medida encerrada ou revogada é imutável.';
  END IF;

  NEW.updated_by := (SELECT auth.uid());
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_supplier_sanction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  changed_fields jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed_fields := '["measure","reason","legal_basis","reference_number","start_date","end_date","status"]'::jsonb;
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(current_row.key ORDER BY current_row.key), '[]'::jsonb)
      INTO changed_fields
    FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(NEW)) AS current_row(key, value)
    WHERE current_row.key NOT IN ('updated_at', 'updated_by')
      AND (pg_catalog.to_jsonb(OLD) -> current_row.key) IS DISTINCT FROM current_row.value;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  )
  VALUES (
    NEW.tenant_id,
    (SELECT auth.uid()),
    TG_OP,
    'supplier_sanctions',
    NEW.id::text,
    pg_catalog.jsonb_build_object('changed_fields', changed_fields),
    pg_catalog.now()
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_protect_supplier_sanction_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_audit_supplier_sanction()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_supplier_sanctions_protect_write
  BEFORE INSERT OR UPDATE ON public.supplier_sanctions
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_supplier_sanction_write();
CREATE TRIGGER trg_supplier_sanctions_audit
  AFTER INSERT OR UPDATE ON public.supplier_sanctions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_supplier_sanction();

COMMENT ON TABLE public.supplier_sanctions IS
  'Histórico de medidas e impedimentos registrados por Secretaria; não altera automaticamente o status cadastral do fornecedor.';

COMMIT;
