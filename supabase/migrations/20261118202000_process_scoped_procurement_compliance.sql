BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- IN 65/2021 applicability can vary by procurement and funding source.
-- Keep the tenant profile as a reusable default, but validate each process
-- independently before its comparative price map can be finalized.
CREATE TABLE public.procurement_process_compliance (
  tenant_id uuid NOT NULL,
  process_id uuid NOT NULL,
  funding_source_type text NOT NULL DEFAULT 'unknown',
  funding_source_description text,
  transfer_agreement_number text,
  normative_basis text NOT NULL DEFAULT 'pending',
  in65_applicability text NOT NULL DEFAULT 'pending',
  local_regulation_name text,
  local_regulation_reference text,
  legal_review_status text NOT NULL DEFAULT 'pending',
  legal_review_notes text,
  validated_by uuid,
  validated_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procurement_process_compliance_pkey PRIMARY KEY (tenant_id,process_id),
  CONSTRAINT procurement_process_compliance_process_fk
    FOREIGN KEY (tenant_id,process_id)
    REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT procurement_process_compliance_validated_by_fk
    FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT procurement_process_compliance_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT procurement_process_compliance_funding_source_check
    CHECK (funding_source_type IN ('unknown','own_resources','federal_transfer','state_transfer','other_transfer','mixed')),
  CONSTRAINT procurement_process_compliance_normative_basis_check
    CHECK (normative_basis IN ('pending','in65_2021','local_regulation','other')),
  CONSTRAINT procurement_process_compliance_in65_applicability_check
    CHECK (in65_applicability IN ('pending','applicable','adopted','not_applicable')),
  CONSTRAINT procurement_process_compliance_review_status_check
    CHECK (legal_review_status IN ('pending','validated')),
  CONSTRAINT procurement_process_compliance_local_rule_check
    CHECK (
      normative_basis<>'local_regulation'
      OR (
        NULLIF(btrim(local_regulation_name),'') IS NOT NULL
        AND NULLIF(btrim(local_regulation_reference),'') IS NOT NULL
      )
    ),
  CONSTRAINT procurement_process_compliance_adoption_check
    CHECK (in65_applicability<>'adopted' OR normative_basis='local_regulation'),
  CONSTRAINT procurement_process_compliance_nonapplicability_reason_check
    CHECK (
      in65_applicability<>'not_applicable'
      OR length(btrim(COALESCE(legal_review_notes,'')))>=20
    ),
  CONSTRAINT procurement_process_compliance_other_basis_reason_check
    CHECK (
      normative_basis<>'other'
      OR length(btrim(COALESCE(legal_review_notes,'')))>=10
    ),
  CONSTRAINT procurement_process_compliance_funding_detail_check
    CHECK (
      funding_source_type NOT IN ('federal_transfer','state_transfer','other_transfer','mixed')
      OR NULLIF(btrim(funding_source_description),'') IS NOT NULL
      OR NULLIF(btrim(transfer_agreement_number),'') IS NOT NULL
    ),
  CONSTRAINT procurement_process_compliance_validation_consistency
    CHECK (
      (legal_review_status='validated' AND validated_by IS NOT NULL AND validated_at IS NOT NULL)
      OR
      (legal_review_status='pending' AND validated_by IS NULL AND validated_at IS NULL)
    )
);

CREATE INDEX procurement_process_compliance_validated_idx
  ON public.procurement_process_compliance(tenant_id,legal_review_status,process_id);

ALTER TABLE public.procurement_process_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_process_compliance FORCE ROW LEVEL SECURITY;

CREATE POLICY p_procurement_process_compliance_read
  ON public.procurement_process_compliance
  FOR SELECT TO authenticated
  USING (
    app_auth.has_tenant_data_permission(tenant_id,'documents:view')
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
  );

CREATE POLICY p_procurement_process_compliance_insert
  ON public.procurement_process_compliance
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      app_auth.has_tenant_data_permission(tenant_id,'procurement:approve_price')
      OR app_auth.has_tenant_data_permission(tenant_id,'documents:approve')
    )
    AND updated_by=(SELECT auth.uid())
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
  );

CREATE POLICY p_procurement_process_compliance_update
  ON public.procurement_process_compliance
  FOR UPDATE TO authenticated
  USING (
    (
      app_auth.has_tenant_data_permission(tenant_id,'procurement:approve_price')
      OR app_auth.has_tenant_data_permission(tenant_id,'documents:approve')
    )
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
  )
  WITH CHECK (
    (
      app_auth.has_tenant_data_permission(tenant_id,'procurement:approve_price')
      OR app_auth.has_tenant_data_permission(tenant_id,'documents:approve')
    )
    AND updated_by=(SELECT auth.uid())
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
  );

GRANT SELECT,INSERT,UPDATE ON public.procurement_process_compliance TO authenticated;
REVOKE ALL ON public.procurement_process_compliance FROM anon;

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_process_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_actor uuid:=(SELECT auth.uid());
BEGIN
  IF v_actor IS NULL
    OR NOT (
      app_auth.has_tenant_data_permission(NEW.tenant_id,'procurement:approve_price')
      OR app_auth.has_tenant_data_permission(NEW.tenant_id,'documents:approve')
    )
    OR NOT app_auth.is_tenant_in_good_standing(NEW.tenant_id)
    OR NOT app_auth.is_tenant_module_enabled(NEW.tenant_id,'processos') THEN
    RAISE EXCEPTION 'Sem permissão para validar o enquadramento normativo deste processo.' USING ERRCODE='42501';
  END IF;

  IF TG_OP='UPDATE'
    AND (
      NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.process_id IS DISTINCT FROM OLD.process_id
    ) THEN
    RAISE EXCEPTION 'A Secretaria e o processo do enquadramento normativo são imutáveis.';
  END IF;

  IF NEW.legal_review_status='validated' THEN
    IF NEW.funding_source_type='unknown'
      OR NEW.normative_basis='pending'
      OR NEW.in65_applicability='pending' THEN
      RAISE EXCEPTION 'Informe a origem dos recursos, a base normativa e a aplicabilidade da IN 65 antes de validar.';
    END IF;
    IF NEW.funding_source_type IN ('federal_transfer','state_transfer','other_transfer','mixed')
      AND NULLIF(btrim(NEW.funding_source_description),'') IS NULL
      AND NULLIF(btrim(NEW.transfer_agreement_number),'') IS NULL THEN
      RAISE EXCEPTION 'Identifique a transferência ou o instrumento de repasse do processo.';
    END IF;
    IF NEW.normative_basis='local_regulation'
      AND (
        NULLIF(btrim(NEW.local_regulation_name),'') IS NULL
        OR NULLIF(btrim(NEW.local_regulation_reference),'') IS NULL
      ) THEN
      RAISE EXCEPTION 'Informe o nome e a referência da regulamentação local.';
    END IF;
    IF NEW.in65_applicability='adopted' AND NEW.normative_basis<>'local_regulation' THEN
      RAISE EXCEPTION 'A adoção local da IN 65 exige a identificação do regulamento local.';
    END IF;
    IF NEW.in65_applicability='not_applicable'
      AND length(btrim(COALESCE(NEW.legal_review_notes,'')))<20 THEN
      RAISE EXCEPTION 'Justifique formalmente a não aplicabilidade da IN 65 (mínimo de 20 caracteres).';
    END IF;
    IF NEW.normative_basis='other'
      AND length(btrim(COALESCE(NEW.legal_review_notes,'')))<10 THEN
      RAISE EXCEPTION 'Descreva o fundamento normativo alternativo (mínimo de 10 caracteres).';
    END IF;
    NEW.validated_by:=v_actor;
    NEW.validated_at:=now();
  ELSE
    NEW.validated_by:=NULL;
    NEW.validated_at:=NULL;
  END IF;

  NEW.updated_by:=v_actor;
  NEW.updated_at:=now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_procurement_process_compliance()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER trg_guard_procurement_process_compliance
  BEFORE INSERT OR UPDATE ON public.procurement_process_compliance
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_procurement_process_compliance();

CREATE TRIGGER trg_procurement_process_compliance_audit
  AFTER INSERT OR UPDATE ON public.procurement_process_compliance
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();

COMMENT ON TABLE public.procurement_process_compliance IS
  'Enquadramento normativo, origem dos recursos e validação jurídica específicos de cada processo de contratação.';

CREATE OR REPLACE FUNCTION public.fn_capture_procurement_price_map_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_items jsonb;
  v_quotes jsonb;
  v_approvals jsonb;
  v_tenant_compliance jsonb;
  v_process_compliance jsonb;
BEGIN
  IF NEW.process_id IS NULL OR NEW.process_snapshot->>'document_kind' IS DISTINCT FROM 'price_map' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.procurement_processes p
    WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.process_id
  ) THEN
    RAISE EXCEPTION 'Processo do mapa comparativo não pertence a esta Secretaria.';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.line_number,i.id),'[]'::jsonb)
  INTO v_items
  FROM public.procurement_items i
  WHERE i.tenant_id=NEW.tenant_id AND i.process_id=NEW.process_id AND i.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'quote',to_jsonb(q),
    'supplier',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'legal_name',s.legal_name,
      'cnpj',s.cnpj,
      'contact_name',s.contact_name,
      'contact_email',s.contact_email,
      'contact_phone',s.contact_phone,
      'street',s.street,
      'street_number',s.street_number,
      'neighborhood',s.neighborhood,
      'city',s.city,
      'state',s.state,
      'postal_code',s.postal_code
    ) END
  ) ORDER BY q.procurement_item_id,q.quoted_at,q.id),'[]'::jsonb)
  INTO v_quotes
  FROM public.procurement_price_quotes q
  LEFT JOIN public.suppliers s ON s.id=q.supplier_id AND s.tenant_id=q.tenant_id
  JOIN public.procurement_items i ON i.tenant_id=q.tenant_id AND i.id=q.procurement_item_id
  WHERE q.tenant_id=NEW.tenant_id AND i.process_id=NEW.process_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.procurement_item_id,a.approved_at,a.id),'[]'::jsonb)
  INTO v_approvals
  FROM public.procurement_price_approvals a
  WHERE a.tenant_id=NEW.tenant_id AND a.process_id=NEW.process_id;

  SELECT COALESCE((
    SELECT to_jsonb(c) FROM public.tenant_procurement_compliance c
    WHERE c.tenant_id=NEW.tenant_id
  ),'{}'::jsonb)
  INTO v_tenant_compliance;

  SELECT COALESCE((
    SELECT to_jsonb(c) FROM public.procurement_process_compliance c
    WHERE c.tenant_id=NEW.tenant_id AND c.process_id=NEW.process_id
  ),'{}'::jsonb)
  INTO v_process_compliance;

  NEW.process_snapshot:=COALESCE(NEW.process_snapshot,'{}'::jsonb) || jsonb_build_object(
    'procurement_items',v_items,
    'price_quotes',v_quotes,
    'price_approvals',v_approvals,
    'tenant_procurement_compliance',v_tenant_compliance,
    'procurement_compliance',v_process_compliance,
    'price_research_fingerprint',app_auth.procurement_price_research_fingerprint(NEW.tenant_id,NEW.process_id),
    'price_research_captured_at',now()
  );
  RETURN NEW;
END;
$function$;

COMMIT;