-- =============================================================================
-- Livro Digital de Fiscalização de Contratos e Notificações Formais
-- Lei nº 14.133/2021, art. 117, § 1º (registro próprio de ocorrências) e art. 156
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contract_inspection_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  record_number text NOT NULL,
  record_type text NOT NULL CHECK (
    record_type = ANY (
      ARRAY[
        'vistoria'::text,
        'medicao'::text,
        'atesto'::text,
        'ocorrencia'::text,
        'notificacao'::text,
        'penalidade'::text
      ]
    )
  ),
  severity text NOT NULL DEFAULT 'informativa' CHECK (
    severity = ANY (ARRAY['informativa'::text, 'atencao'::text, 'critica'::text])
  ),
  status text NOT NULL DEFAULT 'registrada' CHECK (
    status = ANY (
      ARRAY[
        'registrada'::text,
        'aguardando_defesa'::text,
        'regularizada'::text,
        'encerrada'::text,
        'encaminhada_sancao'::text
      ]
    )
  ),
  title text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 3 AND 200),
  description text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(description)) >= 10),
  legal_basis text,
  occurred_at date NOT NULL DEFAULT CURRENT_DATE,
  inspector_name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(inspector_name)) >= 3),
  defense_deadline date,
  supplier_response text,
  resolved_at timestamptz,
  resolution_notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_inspection_records_deadline_check CHECK (
    defense_deadline IS NULL OR defense_deadline >= occurred_at
  )
);

CREATE INDEX IF NOT EXISTS idx_contract_inspection_records_tenant_contract
  ON public.contract_inspection_records(tenant_id, contract_id, occurred_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_inspection_records_status
  ON public.contract_inspection_records(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_contract_inspection_records_created_by
  ON public.contract_inspection_records(created_by);

CREATE INDEX IF NOT EXISTS idx_contract_inspection_records_updated_by
  ON public.contract_inspection_records(updated_by);

ALTER TABLE public.contract_inspection_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_inspection_records FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contract_inspection_records FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contract_inspection_records TO authenticated;

CREATE POLICY p_inspection_select
  ON public.contract_inspection_records
  FOR SELECT
  TO authenticated
  USING (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view'))
    OR (SELECT app_auth.is_platform_admin())
  );

CREATE POLICY p_inspection_insert
  ON public.contract_inspection_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:update'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );

CREATE POLICY p_inspection_update
  ON public.contract_inspection_records
  FOR UPDATE
  TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:update')))
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:update'))
    AND updated_by = (SELECT auth.uid())
  );

CREATE POLICY p_commercial_select_inspection
  ON public.contract_inspection_records
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (
      (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
      AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
    )
  );

CREATE POLICY p_commercial_insert_inspection
  ON public.contract_inspection_records
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
  );

CREATE POLICY p_commercial_update_inspection
  ON public.contract_inspection_records
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
  )
  WITH CHECK (
    (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'contratos'))
  );

CREATE OR REPLACE FUNCTION public.fn_guard_contract_inspection_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_contract_tenant uuid;
BEGIN
  IF NEW.occurred_at > CURRENT_DATE THEN
    RAISE EXCEPTION 'A data da ocorrência ou vistoria não pode ser futura.';
  END IF;

  SELECT c.tenant_id INTO v_contract_tenant
  FROM public.contracts c
  WHERE c.id = NEW.contract_id;

  IF NOT FOUND OR v_contract_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Contrato não localizado nesta Secretaria.';
  END IF;

  IF NEW.record_type = 'notificacao' AND NEW.defense_deadline IS NULL THEN
    RAISE EXCEPTION 'Notificações formais exigem prazo de defesa prévia / regularização (Lei nº 14.133/2021).';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Campos estruturais do registro de fiscalização são imutáveis.';
    END IF;
    NEW.updated_at := pg_catalog.now();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_contract_inspection_record
  BEFORE INSERT OR UPDATE ON public.contract_inspection_records
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_contract_inspection_record();

CREATE OR REPLACE FUNCTION public.fn_audit_contract_inspection_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    NEW.tenant_id,
    COALESCE((SELECT auth.uid()), NEW.updated_by, NEW.created_by),
    CASE WHEN TG_OP = 'INSERT' THEN 'contract_inspection.created' ELSE 'contract_inspection.updated' END,
    'contract_inspection_records',
    NEW.id::text,
    pg_catalog.jsonb_build_object(
      'contract_id', NEW.contract_id,
      'record_number', NEW.record_number,
      'record_type', NEW.record_type,
      'severity', NEW.severity,
      'status', NEW.status,
      'title', NEW.title
    ),
    pg_catalog.now()
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_audit_contract_inspection_record
  AFTER INSERT OR UPDATE ON public.contract_inspection_records
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_contract_inspection_record();
