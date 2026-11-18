BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE public.procurement_processes
  ADD COLUMN IF NOT EXISTS estimated_value_source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.procurement_items
  ADD COLUMN IF NOT EXISTS estimated_price_source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.procurement_price_quotes
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'outro',
  ADD COLUMN IF NOT EXISTS reference_identifier text,
  ADD COLUMN IF NOT EXISTS accessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_response_deadline date,
  ADD COLUMN IF NOT EXISTS source_tax_id text,
  ADD COLUMN IF NOT EXISTS source_contact_name text,
  ADD COLUMN IF NOT EXISTS source_contact_email text,
  ADD COLUMN IF NOT EXISTS source_contact_phone text,
  ADD COLUMN IF NOT EXISTS source_address text,
  ADD COLUMN IF NOT EXISTS brand_model text,
  ADD COLUMN IF NOT EXISTS delivery_term text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS warranty_terms text,
  ADD COLUMN IF NOT EXISTS evidence_storage_path text,
  ADD COLUMN IF NOT EXISTS evidence_file_name text,
  ADD COLUMN IF NOT EXISTS evidence_mime_type text,
  ADD COLUMN IF NOT EXISTS evidence_file_size bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_processes'::regclass AND conname='procurement_processes_estimated_value_source_check') THEN
    ALTER TABLE public.procurement_processes ADD CONSTRAINT procurement_processes_estimated_value_source_check CHECK (estimated_value_source IN ('manual','items'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_items'::regclass AND conname='procurement_items_estimated_price_source_check') THEN
    ALTER TABLE public.procurement_items ADD CONSTRAINT procurement_items_estimated_price_source_check CHECK (estimated_price_source IN ('manual','quote_reference','approved','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_price_quotes'::regclass AND conname='procurement_price_quotes_source_type_check') THEN
    ALTER TABLE public.procurement_price_quotes ADD CONSTRAINT procurement_price_quotes_source_type_check CHECK (source_type IN ('painel_precos','contratacoes_publicas','midia_especializada','site_especializado','fornecedor','nota_fiscal_eletronica','banco_precos_saude','outro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_price_quotes'::regclass AND conname='procurement_price_quotes_source_tax_id_check') THEN
    ALTER TABLE public.procurement_price_quotes ADD CONSTRAINT procurement_price_quotes_source_tax_id_check CHECK (source_tax_id IS NULL OR pg_catalog.regexp_replace(source_tax_id,'[^0-9]','','g') ~ '^([0-9]{11}|[0-9]{14})$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_price_quotes'::regclass AND conname='procurement_price_quotes_evidence_metadata_check') THEN
    ALTER TABLE public.procurement_price_quotes ADD CONSTRAINT procurement_price_quotes_evidence_metadata_check CHECK (
      (evidence_storage_path IS NULL AND evidence_file_name IS NULL AND evidence_mime_type IS NULL AND evidence_file_size IS NULL)
      OR
      (evidence_storage_path IS NOT NULL AND evidence_file_name IS NOT NULL AND length(btrim(evidence_file_name)) BETWEEN 1 AND 255
       AND evidence_mime_type IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png')
       AND evidence_file_size BETWEEN 1 AND 20971520
       AND evidence_storage_path ~* ('^' || tenant_id::text || '/procurement-quotes/' || procurement_item_id::text || '/' || id::text || '/[0-9a-f-]{36}[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'))
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_items_tenant_process_id
  ON public.procurement_items(tenant_id,process_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_price_quotes_selected_reference
  ON public.procurement_price_quotes(tenant_id,procurement_item_id)
  WHERE selected_for_estimate=true AND is_active=true;

CREATE TABLE IF NOT EXISTS public.procurement_price_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  process_id uuid NOT NULL,
  procurement_item_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('media','mediana','menor','outro')),
  method_justification text NOT NULL CHECK (length(btrim(method_justification)) BETWEEN 10 AND 4000),
  exceptional_justification text,
  approved_unit_price numeric(16,4) NOT NULL CHECK (approved_unit_price>=0),
  approved_total_price numeric(16,2) NOT NULL CHECK (approved_total_price>=0),
  sample_count integer NOT NULL CHECK (sample_count>=0),
  source_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_snapshot)='array'),
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(calculation_snapshot)='object'),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','superseded','revoked')),
  approved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT procurement_price_approvals_item_process_fk FOREIGN KEY (tenant_id,process_id,procurement_item_id)
    REFERENCES public.procurement_items(tenant_id,process_id,id) ON DELETE RESTRICT,
  CONSTRAINT procurement_price_approvals_exception_reason_check
    CHECK (sample_count>=3 OR (exceptional_justification IS NOT NULL AND length(btrim(exceptional_justification))>=10))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_price_approvals_current
  ON public.procurement_price_approvals(tenant_id,procurement_item_id) WHERE status='approved';
CREATE INDEX IF NOT EXISTS ix_procurement_price_approvals_process
  ON public.procurement_price_approvals(tenant_id,process_id,approved_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_procurement_compliance (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  normative_basis text NOT NULL DEFAULT 'pending' CHECK (normative_basis IN ('pending','in65_2021','local_regulation','other')),
  in65_applicability text NOT NULL DEFAULT 'pending' CHECK (in65_applicability IN ('pending','applicable','adopted','not_applicable')),
  local_regulation_name text,
  local_regulation_reference text,
  legal_review_status text NOT NULL DEFAULT 'pending' CHECK (legal_review_status IN ('pending','validated')),
  legal_review_notes text,
  validated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  validated_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_procurement_compliance_validation_consistency CHECK (
    (legal_review_status='validated' AND validated_by IS NOT NULL AND validated_at IS NOT NULL)
    OR (legal_review_status='pending' AND validated_by IS NULL AND validated_at IS NULL)
  ),
  CONSTRAINT tenant_procurement_compliance_local_rule_check CHECK (
    normative_basis<>'local_regulation' OR (NULLIF(btrim(local_regulation_name),'') IS NOT NULL AND NULLIF(btrim(local_regulation_reference),'') IS NOT NULL)
  ),
  CONSTRAINT tenant_procurement_compliance_nonapplicability_reason_check CHECK (
    in65_applicability<>'not_applicable' OR NULLIF(btrim(legal_review_notes),'') IS NOT NULL
  )
);

ALTER TABLE public.procurement_price_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_price_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_procurement_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_procurement_compliance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_price_approvals,public.tenant_procurement_compliance FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.procurement_price_approvals TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.tenant_procurement_compliance TO authenticated;

DROP POLICY IF EXISTS p_procurement_price_approvals_read ON public.procurement_price_approvals;
CREATE POLICY p_procurement_price_approvals_read ON public.procurement_price_approvals FOR SELECT TO authenticated
USING (app_auth.has_tenant_data_permission(tenant_id,'documents:view') AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'processos'));

DROP POLICY IF EXISTS p_tenant_procurement_compliance_read ON public.tenant_procurement_compliance;
CREATE POLICY p_tenant_procurement_compliance_read ON public.tenant_procurement_compliance FOR SELECT TO authenticated
USING (app_auth.has_tenant_data_permission(tenant_id,'documents:view') AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'processos'));
DROP POLICY IF EXISTS p_tenant_procurement_compliance_insert ON public.tenant_procurement_compliance;
CREATE POLICY p_tenant_procurement_compliance_insert ON public.tenant_procurement_compliance FOR INSERT TO authenticated
WITH CHECK (
  (app_auth.has_tenant_data_permission(tenant_id,'procurement:approve_price') OR app_auth.has_tenant_data_permission(tenant_id,'documents:approve'))
  AND updated_by=(SELECT auth.uid()) AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
);
DROP POLICY IF EXISTS p_tenant_procurement_compliance_update ON public.tenant_procurement_compliance;
CREATE POLICY p_tenant_procurement_compliance_update ON public.tenant_procurement_compliance FOR UPDATE TO authenticated
USING (
  (app_auth.has_tenant_data_permission(tenant_id,'procurement:approve_price') OR app_auth.has_tenant_data_permission(tenant_id,'documents:approve'))
  AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
)
WITH CHECK (
  (app_auth.has_tenant_data_permission(tenant_id,'procurement:approve_price') OR app_auth.has_tenant_data_permission(tenant_id,'documents:approve'))
  AND updated_by=(SELECT auth.uid()) AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
);

INSERT INTO public.permissions(code,name,description,module)
VALUES ('procurement:approve_price','Aprovar preço estimado','Homologar tecnicamente o método e o valor estimado da pesquisa de preços.','processes')
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r JOIN public.permissions p ON p.code='procurement:approve_price'
WHERE r.slug='manager' AND r.is_system=true
ON CONFLICT(role_id,permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION app_auth.recalculate_procurement_process_estimate(p_tenant_id uuid,p_process_id uuid,p_actor_id uuid,p_force_items boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_source text; v_count integer; v_unpriced integer; v_total numeric(16,2);
BEGIN
  SELECT p.estimated_value_source INTO v_source FROM public.procurement_processes p
  WHERE p.tenant_id=p_tenant_id AND p.id=p_process_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_force_items THEN v_source:='items'; END IF;
  IF v_source<>'items' THEN RETURN; END IF;
  SELECT count(*)::integer,count(*) FILTER (WHERE i.estimated_total IS NULL)::integer,sum(i.estimated_total)
    INTO v_count,v_unpriced,v_total
  FROM public.procurement_items i
  WHERE i.tenant_id=p_tenant_id AND i.process_id=p_process_id AND i.is_active;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
  UPDATE public.procurement_processes p
  SET estimated_value_source='items',
      estimated_value=CASE WHEN v_count>0 AND v_unpriced=0 THEN v_total ELSE NULL END,
      updated_by=COALESCE(p_actor_id,p.updated_by),updated_at=now()
  WHERE p.tenant_id=p_tenant_id AND p.id=p_process_id;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
END;
$function$;
REVOKE ALL ON FUNCTION app_auth.recalculate_procurement_process_estimate(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_item_estimate()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE v_internal boolean:=COALESCE(pg_catalog.current_setting('app_auth.price_estimate_write',true),'')='on';
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.estimated_price_source<>'manual' AND NOT v_internal THEN
      RAISE EXCEPTION 'A origem do preço do item deve ser registrada pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
    END IF;
  ELSIF ROW(NEW.estimated_unit_price,NEW.estimated_price_source) IS DISTINCT FROM ROW(OLD.estimated_unit_price,OLD.estimated_price_source)
    AND NOT v_internal AND (OLD.estimated_price_source<>'manual' OR NEW.estimated_price_source<>'manual') THEN
    RAISE EXCEPTION 'Preços derivados de cotação ou aprovados só podem ser alterados pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_procurement_item_estimate() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_procurement_item_estimate ON public.procurement_items;
CREATE TRIGGER trg_guard_procurement_item_estimate BEFORE INSERT OR UPDATE OF estimated_unit_price,estimated_price_source ON public.procurement_items
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_procurement_item_estimate();

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_process_estimate()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.estimated_value_source<>'manual' AND COALESCE(pg_catalog.current_setting('app_auth.price_estimate_write',true),'')<>'on' THEN
      RAISE EXCEPTION 'A origem do valor estimado deve ser registrada pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
    END IF;
  ELSIF ROW(NEW.estimated_value,NEW.estimated_value_source) IS DISTINCT FROM ROW(OLD.estimated_value,OLD.estimated_value_source)
    AND COALESCE(pg_catalog.current_setting('app_auth.price_estimate_write',true),'')<>'on'
    AND (OLD.estimated_value_source='items' OR NEW.estimated_value_source='items') THEN
    RAISE EXCEPTION 'Estimativa calculada a partir dos itens só pode ser alterada pelo fluxo de pesquisa de preços.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_procurement_process_estimate() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_procurement_process_estimate ON public.procurement_processes;
CREATE TRIGGER trg_guard_procurement_process_estimate BEFORE INSERT OR UPDATE OF estimated_value,estimated_value_source ON public.procurement_processes
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_procurement_process_estimate();

CREATE OR REPLACE FUNCTION public.fn_invalidate_quote_price_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_process_id uuid; v_actor uuid; v_changed boolean;
BEGIN
  v_actor:=COALESCE((SELECT auth.uid()),NEW.updated_by,NEW.created_by);
  IF TG_OP='INSERT' THEN v_changed:=true;
  ELSE
    v_changed:=ROW(NEW.supplier_id,NEW.source_name,NEW.reference_url,NEW.quoted_at,NEW.quantity,NEW.unit_price,
      NEW.delivery_cost,NEW.total_price,NEW.notes,NEW.selected_for_estimate,NEW.is_active,NEW.contract_id,
      NEW.justificativa_expurgo,NEW.source_type,NEW.reference_identifier,NEW.accessed_at,NEW.supplier_response_deadline,
      NEW.source_tax_id,NEW.source_contact_name,NEW.source_contact_email,NEW.source_contact_phone,NEW.source_address,
      NEW.brand_model,NEW.delivery_term,NEW.payment_terms,NEW.warranty_terms,NEW.evidence_storage_path,NEW.evidence_file_name,
      NEW.evidence_mime_type,NEW.evidence_file_size)
    IS DISTINCT FROM
    ROW(OLD.supplier_id,OLD.source_name,OLD.reference_url,OLD.quoted_at,OLD.quantity,OLD.unit_price,
      OLD.delivery_cost,OLD.total_price,OLD.notes,OLD.selected_for_estimate,OLD.is_active,OLD.contract_id,
      OLD.justificativa_expurgo,OLD.source_type,OLD.reference_identifier,OLD.accessed_at,OLD.supplier_response_deadline,
      OLD.source_tax_id,OLD.source_contact_name,OLD.source_contact_email,OLD.source_contact_phone,OLD.source_address,
      OLD.brand_model,OLD.delivery_term,OLD.payment_terms,OLD.warranty_terms,OLD.evidence_storage_path,OLD.evidence_file_name,
      OLD.evidence_mime_type,OLD.evidence_file_size);
  END IF;
  SELECT i.process_id INTO v_process_id FROM public.procurement_items i
  WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.procurement_item_id;
  IF v_changed THEN
    UPDATE public.procurement_price_approvals SET status='superseded',superseded_at=now()
    WHERE tenant_id=NEW.tenant_id AND procurement_item_id=NEW.procurement_item_id AND status='approved';
    PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
    UPDATE public.procurement_items i SET estimated_unit_price=NULL,estimated_price_source='none',
      updated_by=COALESCE(v_actor,i.updated_by),updated_at=now()
    WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.procurement_item_id AND i.estimated_price_source='approved';
    IF TG_OP='UPDATE' AND OLD.selected_for_estimate=true AND (NEW.selected_for_estimate=false OR NEW.is_active=false) THEN
      UPDATE public.procurement_items i SET estimated_unit_price=NULL,estimated_price_source='none',
        updated_by=COALESCE(v_actor,i.updated_by),updated_at=now()
      WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.procurement_item_id AND i.estimated_price_source='quote_reference';
    END IF;
    PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
    IF v_process_id IS NOT NULL THEN
      PERFORM app_auth.recalculate_procurement_process_estimate(NEW.tenant_id,v_process_id,v_actor,false);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_invalidate_quote_price_approval() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_invalidate_quote_price_approval ON public.procurement_price_quotes;
CREATE TRIGGER trg_invalidate_quote_price_approval AFTER INSERT OR UPDATE ON public.procurement_price_quotes
FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_quote_price_approval();

CREATE OR REPLACE FUNCTION public.fn_invalidate_item_price_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=COALESCE((SELECT auth.uid()),NEW.updated_by);
BEGIN
  IF ROW(NEW.description,NEW.technical_specification,NEW.unit,NEW.quantity,NEW.delivery_location,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.description,OLD.technical_specification,OLD.unit,OLD.quantity,OLD.delivery_location,OLD.is_active) THEN
    UPDATE public.procurement_price_approvals SET status='superseded',superseded_at=now()
    WHERE tenant_id=NEW.tenant_id AND procurement_item_id=NEW.id AND status='approved';
    PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
    UPDATE public.procurement_items i SET estimated_unit_price=NULL,estimated_price_source='none',
      updated_by=COALESCE(v_actor,i.updated_by),updated_at=now()
    WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.id AND i.estimated_price_source IN ('approved','quote_reference');
    PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
    PERFORM app_auth.recalculate_procurement_process_estimate(NEW.tenant_id,NEW.process_id,v_actor,false);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_invalidate_item_price_approval() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_invalidate_item_price_approval ON public.procurement_items;
CREATE TRIGGER trg_invalidate_item_price_approval AFTER UPDATE OF description,technical_specification,unit,quantity,delivery_location,is_active
ON public.procurement_items FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_item_price_approval();

CREATE OR REPLACE FUNCTION public.fn_guard_price_map_research_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_process_id uuid;
BEGIN
  IF TG_TABLE_NAME='procurement_items' THEN v_process_id:=NEW.process_id;
  ELSE
    SELECT i.process_id INTO v_process_id FROM public.procurement_items i
    WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.procurement_item_id;
  END IF;
  IF v_process_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.generated_documents d
    JOIN public.generated_document_workflows w ON w.tenant_id=d.tenant_id AND w.document_id=d.id
    WHERE d.tenant_id=NEW.tenant_id AND d.process_id=v_process_id
      AND d.process_snapshot->>'document_kind'='price_map'
      AND w.status IN ('pending_approval','approved','signed')
  ) THEN
    RAISE EXCEPTION 'A pesquisa está vinculada a um mapa em aprovação ou assinado. Devolva ou cancele o documento antes de alterar os dados.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_price_map_research_mutation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_price_map_quote_mutation ON public.procurement_price_quotes;
CREATE TRIGGER trg_guard_price_map_quote_mutation BEFORE INSERT OR UPDATE ON public.procurement_price_quotes
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_price_map_research_mutation();
DROP TRIGGER IF EXISTS trg_guard_price_map_item_mutation ON public.procurement_items;
CREATE TRIGGER trg_guard_price_map_item_mutation BEFORE INSERT OR UPDATE ON public.procurement_items
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_price_map_research_mutation();

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_quote_source_metadata()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.source_type,NEW.reference_identifier,NEW.accessed_at,NEW.source_tax_id,
      NEW.source_contact_name,NEW.source_contact_email,NEW.source_address)
    IS NOT DISTINCT FROM ROW(OLD.source_type,OLD.reference_identifier,OLD.accessed_at,OLD.source_tax_id,
      OLD.source_contact_name,OLD.source_contact_email,OLD.source_address) THEN
    RETURN NEW;
  END IF;
  IF NEW.source_type IN ('painel_precos','contratacoes_publicas','midia_especializada','site_especializado','banco_precos_saude')
    AND NEW.accessed_at IS NULL THEN
    RAISE EXCEPTION 'Registre a data e hora de acesso da fonte consultada.';
  END IF;
  IF NEW.source_type='fornecedor' AND NEW.supplier_id IS NULL
    AND (NULLIF(btrim(NEW.source_tax_id),'') IS NULL OR NULLIF(btrim(NEW.source_contact_name),'') IS NULL
      OR NULLIF(btrim(NEW.source_contact_email),'') IS NULL OR NULLIF(btrim(NEW.source_address),'') IS NULL) THEN
    RAISE EXCEPTION 'A cotação direta exige CPF/CNPJ, responsável, e-mail e endereço do fornecedor.';
  END IF;
  IF NEW.source_type='nota_fiscal_eletronica'
    AND (NULLIF(btrim(NEW.reference_identifier),'') IS NULL OR NEW.accessed_at IS NULL) THEN
    RAISE EXCEPTION 'Informe a identificação da nota fiscal e a data/hora da consulta.';
  END IF;
  IF NEW.source_type='outro' AND NULLIF(btrim(NEW.reference_identifier),'') IS NULL
    AND NULLIF(btrim(NEW.reference_url),'') IS NULL AND NULLIF(btrim(NEW.notes),'') IS NULL THEN
    RAISE EXCEPTION 'Identifique a fonte ou registre observação que permita rastrear a consulta.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_procurement_quote_source_metadata() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_procurement_quote_source_metadata ON public.procurement_price_quotes;
CREATE TRIGGER trg_guard_procurement_quote_source_metadata BEFORE INSERT OR UPDATE ON public.procurement_price_quotes
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_procurement_quote_source_metadata();

CREATE OR REPLACE FUNCTION public.select_procurement_price_quote(p_tenant_id uuid,p_item_id uuid,p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE v_total numeric(16,2); v_quantity numeric; v_unit numeric(16,4); v_process_id uuid; v_actor uuid:=(SELECT auth.uid());
BEGIN
  IF v_actor IS NULL OR NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:update')
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'processos') THEN
    RAISE EXCEPTION 'Sem permissão para selecionar a cotação nesta Secretaria.' USING ERRCODE='42501';
  END IF;
  SELECT i.process_id INTO v_process_id FROM public.procurement_items i
  WHERE i.id=p_item_id AND i.tenant_id=p_tenant_id AND i.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item da contratação não encontrado ou inativo.'; END IF;
  SELECT q.total_price,q.quantity INTO v_total,v_quantity FROM public.procurement_price_quotes q
  WHERE q.id=p_quote_id AND q.tenant_id=p_tenant_id AND q.procurement_item_id=p_item_id AND q.is_active FOR UPDATE;
  IF NOT FOUND OR v_total IS NULL OR v_quantity IS NULL OR v_quantity<=0 THEN
    RAISE EXCEPTION 'Cotação não encontrada, inativa ou sem total/quantidade válidos.';
  END IF;
  v_unit:=round(v_total/v_quantity,4);
  UPDATE public.procurement_price_quotes SET selected_for_estimate=false,updated_by=v_actor
  WHERE tenant_id=p_tenant_id AND procurement_item_id=p_item_id AND selected_for_estimate=true AND is_active=true;
  UPDATE public.procurement_price_quotes SET selected_for_estimate=true,updated_by=v_actor
  WHERE id=p_quote_id AND tenant_id=p_tenant_id AND procurement_item_id=p_item_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não foi possível marcar a cotação como referência.'; END IF;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
  UPDATE public.procurement_items SET estimated_unit_price=v_unit,estimated_price_source='quote_reference',updated_by=v_actor
  WHERE id=p_item_id AND tenant_id=p_tenant_id AND is_active;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
  PERFORM app_auth.recalculate_procurement_process_estimate(p_tenant_id,v_process_id,v_actor,true);
END;
$function$;
REVOKE ALL ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.select_procurement_price_quote(uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_procurement_price_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_approve_price boolean,can_validate_normative_basis boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
  SELECT
    (app_auth.has_tenant_data_permission(p_tenant_id,'procurement:approve_price') OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve'))
      AND app_auth.is_tenant_in_good_standing(p_tenant_id) AND app_auth.is_tenant_module_enabled(p_tenant_id,'processos'),
    (app_auth.has_tenant_data_permission(p_tenant_id,'procurement:approve_price') OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve'))
      AND app_auth.is_tenant_in_good_standing(p_tenant_id) AND app_auth.is_tenant_module_enabled(p_tenant_id,'processos');
$function$;
REVOKE ALL ON FUNCTION public.get_procurement_price_capabilities(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_procurement_price_capabilities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_guard_tenant_procurement_compliance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=(SELECT auth.uid());
BEGIN
  IF v_actor IS NULL OR NOT (app_auth.has_tenant_data_permission(NEW.tenant_id,'procurement:approve_price')
    OR app_auth.has_tenant_data_permission(NEW.tenant_id,'documents:approve')) THEN
    RAISE EXCEPTION 'Sem permissão para validar o enquadramento normativo desta Secretaria.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A Secretaria do enquadramento normativo é imutável.';
  END IF;
  IF NEW.legal_review_status='validated' THEN
    IF NEW.normative_basis='pending' OR NEW.in65_applicability='pending' THEN
      RAISE EXCEPTION 'Defina a base normativa e a aplicabilidade da IN 65 antes de validar.';
    END IF;
    IF NEW.normative_basis='local_regulation' AND (NULLIF(btrim(NEW.local_regulation_name),'') IS NULL OR NULLIF(btrim(NEW.local_regulation_reference),'') IS NULL) THEN
      RAISE EXCEPTION 'Informe o nome e a referência da regulamentação local.';
    END IF;
    IF NEW.in65_applicability='not_applicable' AND NULLIF(btrim(NEW.legal_review_notes),'') IS NULL THEN
      RAISE EXCEPTION 'Justifique formalmente por que a IN 65 não se aplica ao órgão.';
    END IF;
    NEW.validated_by:=v_actor; NEW.validated_at:=now();
  ELSE
    NEW.validated_by:=NULL; NEW.validated_at:=NULL;
  END IF;
  NEW.updated_by:=v_actor; NEW.updated_at:=now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_tenant_procurement_compliance() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_tenant_procurement_compliance ON public.tenant_procurement_compliance;
CREATE TRIGGER trg_guard_tenant_procurement_compliance BEFORE INSERT OR UPDATE ON public.tenant_procurement_compliance
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_tenant_procurement_compliance();

CREATE OR REPLACE FUNCTION public.approve_procurement_item_price(
  p_tenant_id uuid,p_item_id uuid,p_method text,p_method_justification text,
  p_exceptional_justification text DEFAULT NULL,p_other_unit_price numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_actor uuid:=(SELECT auth.uid());
  v_item public.procurement_items%ROWTYPE;
  v_count integer; v_average numeric(16,4); v_median numeric(16,4); v_lowest numeric(16,4);
  v_stddev numeric; v_cv numeric; v_price numeric(16,4); v_total numeric(16,2);
  v_values jsonb; v_sources jsonb; v_calc jsonb; v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (app_auth.has_tenant_data_permission(p_tenant_id,'procurement:approve_price')
      OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve'))
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'processos') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar o preço estimado nesta Secretaria.' USING ERRCODE='42501';
  END IF;
  IF p_method NOT IN ('media','mediana','menor','outro') THEN RAISE EXCEPTION 'Método estatístico inválido.'; END IF;
  IF p_method_justification IS NULL OR length(btrim(p_method_justification))<10 THEN
    RAISE EXCEPTION 'Justifique a escolha do método estatístico (mínimo de 10 caracteres).';
  END IF;
  IF p_method='outro' AND (p_other_unit_price IS NULL OR p_other_unit_price<0 OR length(btrim(p_method_justification))<20) THEN
    RAISE EXCEPTION 'O método alternativo exige preço válido e justificativa detalhada (mínimo de 20 caracteres).';
  END IF;
  SELECT * INTO v_item FROM public.procurement_items i
  WHERE i.tenant_id=p_tenant_id AND i.id=p_item_id AND i.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item da pesquisa não encontrado ou inativo.'; END IF;

  SELECT count(*)::integer,avg(q.total_price/NULLIF(q.quantity,0))::numeric(16,4),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY q.total_price/NULLIF(q.quantity,0))::numeric(16,4),
    min(q.total_price/NULLIF(q.quantity,0))::numeric(16,4),stddev_samp(q.total_price/NULLIF(q.quantity,0)),
    jsonb_agg(q.total_price/NULLIF(q.quantity,0) ORDER BY q.total_price/NULLIF(q.quantity,0))
  INTO v_count,v_average,v_median,v_lowest,v_stddev,v_values
  FROM public.procurement_price_quotes q
  WHERE q.tenant_id=p_tenant_id AND q.procurement_item_id=p_item_id AND q.is_active=true AND q.quantity>0 AND q.total_price IS NOT NULL;
  IF v_count=0 THEN RAISE EXCEPTION 'Registre ao menos uma cotação ativa antes de aprovar o preço.'; END IF;
  IF v_count<3 AND (p_exceptional_justification IS NULL OR length(btrim(p_exceptional_justification))<10) THEN
    RAISE EXCEPTION 'Com menos de três preços, informe justificativa excepcional da autoridade competente.';
  END IF;
  v_price:=CASE p_method WHEN 'media' THEN v_average WHEN 'mediana' THEN v_median WHEN 'menor' THEN v_lowest ELSE p_other_unit_price::numeric(16,4) END;
  v_total:=round(v_price*v_item.quantity,2);
  IF v_average>0 AND v_stddev IS NOT NULL THEN v_cv:=(v_stddev/v_average)*100; ELSE v_cv:=NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('quote',to_jsonb(q),'supplier',
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'legal_name',s.legal_name,'cnpj',s.cnpj,
      'contact_name',s.contact_name,'contact_email',s.contact_email,'contact_phone',s.contact_phone,
      'street',s.street,'street_number',s.street_number,'neighborhood',s.neighborhood,'city',s.city,
      'state',s.state,'postal_code',s.postal_code) END)
    ORDER BY q.quoted_at,q.id),'[]'::jsonb)
  INTO v_sources
  FROM public.procurement_price_quotes q LEFT JOIN public.suppliers s ON s.id=q.supplier_id AND s.tenant_id=q.tenant_id
  WHERE q.tenant_id=p_tenant_id AND q.procurement_item_id=p_item_id;

  v_calc:=jsonb_build_object('method',p_method,'method_justification',btrim(p_method_justification),
    'exceptional_justification',NULLIF(btrim(p_exceptional_justification),''),'sample_count',v_count,
    'effective_unit_prices',COALESCE(v_values,'[]'::jsonb),'average',v_average,'median',v_median,'lowest',v_lowest,
    'sample_standard_deviation',v_stddev,'coefficient_of_variation',v_cv,'approved_unit_price',v_price,
    'quantity',v_item.quantity,'approved_total_price',v_total,
    'formula','Preço efetivo = total cotado com frete ÷ quantidade cotada; total aprovado = preço unitário aprovado × quantidade do item.');

  UPDATE public.procurement_price_approvals SET status='superseded',superseded_at=now()
  WHERE tenant_id=p_tenant_id AND procurement_item_id=p_item_id AND status='approved';
  INSERT INTO public.procurement_price_approvals(tenant_id,process_id,procurement_item_id,method,method_justification,
    exceptional_justification,approved_unit_price,approved_total_price,sample_count,source_snapshot,calculation_snapshot,
    status,approved_by,approved_at)
  VALUES(p_tenant_id,v_item.process_id,p_item_id,p_method,btrim(p_method_justification),
    NULLIF(btrim(p_exceptional_justification),''),v_price,v_total,v_count,v_sources,v_calc,'approved',v_actor,now())
  RETURNING id INTO v_id;

  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
  UPDATE public.procurement_items SET estimated_unit_price=v_price,estimated_price_source='approved',updated_by=v_actor
  WHERE tenant_id=p_tenant_id AND id=p_item_id;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
  PERFORM app_auth.recalculate_procurement_process_estimate(p_tenant_id,v_item.process_id,v_actor,true);
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(p_tenant_id,v_actor,'procurement.price_estimated.approved','procurement_price_approvals',v_id::text,
    jsonb_build_object('process_id',v_item.process_id,'item_id',p_item_id,'method',p_method,
      'approved_unit_price',v_price,'approved_total_price',v_total,'sample_count',v_count,
      'exceptional_justification',NULLIF(btrim(p_exceptional_justification),'')),now());
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.approve_procurement_item_price(uuid,uuid,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_procurement_item_price(uuid,uuid,text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION app_auth.procurement_price_research_fingerprint(p_tenant_id uuid,p_process_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
  SELECT pg_catalog.md5(pg_catalog.jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number,i.id) FROM public.procurement_items i
      WHERE i.tenant_id=p_tenant_id AND i.process_id=p_process_id AND i.is_active),'[]'::jsonb),
    'quotes',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.procurement_item_id,q.quoted_at,q.id)
      FROM public.procurement_price_quotes q JOIN public.procurement_items i ON i.tenant_id=q.tenant_id AND i.id=q.procurement_item_id
      WHERE q.tenant_id=p_tenant_id AND i.process_id=p_process_id),'[]'::jsonb),
    'approvals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'item_id',a.procurement_item_id,'method',a.method,
      'approved_unit_price',a.approved_unit_price,'approved_total_price',a.approved_total_price,'sample_count',a.sample_count,
      'approved_by',a.approved_by,'approved_at',a.approved_at,'status',a.status)
      ORDER BY a.procurement_item_id,a.approved_at,a.id)
      FROM public.procurement_price_approvals a WHERE a.tenant_id=p_tenant_id AND a.process_id=p_process_id),'[]'::jsonb),
    'compliance',COALESCE((SELECT to_jsonb(c) FROM public.tenant_procurement_compliance c WHERE c.tenant_id=p_tenant_id),'{}'::jsonb)
  )::text);
$function$;
REVOKE ALL ON FUNCTION app_auth.procurement_price_research_fingerprint(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_capture_procurement_price_map_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_items jsonb; v_quotes jsonb; v_approvals jsonb; v_compliance jsonb;
BEGIN
  IF NEW.process_id IS NULL OR NEW.process_snapshot->>'document_kind' IS DISTINCT FROM 'price_map' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.procurement_processes p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.process_id) THEN
    RAISE EXCEPTION 'Processo do mapa comparativo não pertence a esta Secretaria.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.line_number,i.id),'[]'::jsonb) INTO v_items
  FROM public.procurement_items i WHERE i.tenant_id=NEW.tenant_id AND i.process_id=NEW.process_id AND i.is_active;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('quote',to_jsonb(q),'supplier',
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('legal_name',s.legal_name,'cnpj',s.cnpj,
      'contact_name',s.contact_name,'contact_email',s.contact_email,'contact_phone',s.contact_phone,
      'street',s.street,'street_number',s.street_number,'neighborhood',s.neighborhood,'city',s.city,'state',s.state,'postal_code',s.postal_code) END)
    ORDER BY q.procurement_item_id,q.quoted_at,q.id),'[]'::jsonb) INTO v_quotes
  FROM public.procurement_price_quotes q LEFT JOIN public.suppliers s ON s.id=q.supplier_id AND s.tenant_id=q.tenant_id
  JOIN public.procurement_items i ON i.tenant_id=q.tenant_id AND i.id=q.procurement_item_id
  WHERE q.tenant_id=NEW.tenant_id AND i.process_id=NEW.process_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.procurement_item_id,a.approved_at,a.id),'[]'::jsonb)
  INTO v_approvals FROM public.procurement_price_approvals a
  WHERE a.tenant_id=NEW.tenant_id AND a.process_id=NEW.process_id;
  SELECT COALESCE((SELECT to_jsonb(c) FROM public.tenant_procurement_compliance c WHERE c.tenant_id=NEW.tenant_id),'{}'::jsonb)
  INTO v_compliance;
  NEW.process_snapshot:=COALESCE(NEW.process_snapshot,'{}'::jsonb) || jsonb_build_object(
    'procurement_items',v_items,'price_quotes',v_quotes,'price_approvals',v_approvals,
    'procurement_compliance',v_compliance,
    'price_research_fingerprint',app_auth.procurement_price_research_fingerprint(NEW.tenant_id,NEW.process_id),
    'price_research_captured_at',now()
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_capture_procurement_price_map_snapshot() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS z_generated_documents_price_map_snapshot ON public.generated_documents;
CREATE TRIGGER z_generated_documents_price_map_snapshot BEFORE INSERT ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.fn_capture_procurement_price_map_snapshot();

CREATE OR REPLACE FUNCTION public.transition_generated_document_workflow(
  p_tenant_id uuid,p_document_id uuid,p_action text,p_comment text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=(SELECT auth.uid()); v_document public.generated_documents%ROWTYPE;
  v_workflow public.generated_document_workflows%ROWTYPE; v_next text; v_comment text:=NULLIF(btrim(p_comment),'');
  v_active_items integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501'; END IF;
  IF NOT app_auth.is_tenant_in_good_standing(p_tenant_id) OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'documentos') THEN
    RAISE EXCEPTION 'Secretaria inativa ou módulo de documentos indisponível.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_document FROM public.generated_documents d WHERE d.id=p_document_id AND d.tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado nesta Secretaria.'; END IF;
  SELECT * INTO v_workflow FROM public.generated_document_workflows w WHERE w.tenant_id=p_tenant_id AND w.document_id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fluxo documental não inicializado.'; END IF;
  IF v_document.status<>'draft' THEN RAISE EXCEPTION 'Somente documentos em rascunho podem tramitar para aprovação.'; END IF;

  IF p_action='submit' THEN
    IF NOT (app_auth.has_tenant_data_permission(p_tenant_id,'documents:create') OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:update')) THEN
      RAISE EXCEPTION 'Sem permissão para enviar documentos à aprovação.' USING ERRCODE='42501';
    END IF;
    IF v_workflow.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'Somente rascunhos ou documentos devolvidos podem ser enviados.'; END IF;
    IF pg_catalog.strpos(v_document.content_snapshot,'[PREENCHER:')>0
      OR pg_catalog.strpos(v_document.content_snapshot,'[CAMPO NÃO CONFIGURADO:')>0
      OR v_document.content_snapshot ~ '\{\{[^}]+\}\}' THEN
      RAISE EXCEPTION 'Preencha ou configure todos os campos pendentes do documento antes de enviá-lo.';
    END IF;
    IF v_document.process_snapshot->>'document_kind'='price_map' THEN
      IF v_document.process_id IS NULL THEN RAISE EXCEPTION 'Mapa comparativo sem vínculo com o processo.'; END IF;
      IF v_document.process_snapshot->>'price_research_fingerprint' IS DISTINCT FROM
        app_auth.procurement_price_research_fingerprint(p_tenant_id,v_document.process_id) THEN
        RAISE EXCEPTION 'A pesquisa mudou após a geração do mapa. Gere novamente o documento para capturar a versão atual.';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.tenant_procurement_compliance c WHERE c.tenant_id=p_tenant_id
        AND c.legal_review_status='validated' AND c.normative_basis<>'pending' AND c.in65_applicability<>'pending') THEN
        RAISE EXCEPTION 'Valide o enquadramento normativo da Secretaria antes de enviar o mapa para aprovação.';
      END IF;
      SELECT count(*)::integer INTO v_active_items FROM public.procurement_items i
      WHERE i.tenant_id=p_tenant_id AND i.process_id=v_document.process_id AND i.is_active;
      IF v_active_items=0 OR EXISTS (
        SELECT 1 FROM public.procurement_items i WHERE i.tenant_id=p_tenant_id AND i.process_id=v_document.process_id AND i.is_active
          AND (i.estimated_price_source<>'approved' OR NOT EXISTS (
            SELECT 1 FROM public.procurement_price_approvals a WHERE a.tenant_id=i.tenant_id
              AND a.procurement_item_id=i.id AND a.status='approved'
          ))
      ) THEN
        RAISE EXCEPTION 'Todos os itens ativos precisam ter preço estimado aprovado antes da tramitação do mapa.';
      END IF;
    END IF;
    v_next:='pending_approval';
    UPDATE public.generated_document_workflows SET status=v_next,submitted_by=v_actor,submitted_at=now(),
      decided_by=NULL,decided_at=NULL,decision_comment=NULL,updated_at=now()
    WHERE tenant_id=p_tenant_id AND document_id=p_document_id;
  ELSIF p_action IN ('approve','reject') THEN
    IF NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve') THEN RAISE EXCEPTION 'Sem permissão para aprovar documentos.' USING ERRCODE='42501'; END IF;
    IF v_workflow.status<>'pending_approval' THEN RAISE EXCEPTION 'O documento não está aguardando aprovação.'; END IF;
    IF v_workflow.submitted_by=v_actor THEN RAISE EXCEPTION 'A aprovação deve ser realizada por usuário diferente de quem enviou o documento.'; END IF;
    IF p_action='reject' AND (v_comment IS NULL OR length(v_comment)<5) THEN RAISE EXCEPTION 'Informe o motivo da devolução (mínimo de 5 caracteres).'; END IF;
    v_next:=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END;
    UPDATE public.generated_document_workflows SET status=v_next,decided_by=v_actor,decided_at=now(),decision_comment=v_comment,updated_at=now()
    WHERE tenant_id=p_tenant_id AND document_id=p_document_id;
  ELSE
    RAISE EXCEPTION 'Ação de tramitação inválida.';
  END IF;
  INSERT INTO public.generated_document_workflow_events(tenant_id,document_id,actor_id,action,from_status,to_status,comment)
  VALUES(p_tenant_id,p_document_id,v_actor,CASE p_action WHEN 'submit' THEN 'submitted' WHEN 'approve' THEN 'approved' ELSE 'rejected' END,v_workflow.status,v_next,v_comment);
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(p_tenant_id,v_actor,'document.workflow.'||p_action,'generated_documents',p_document_id::text,
    jsonb_build_object('from_status',v_workflow.status,'to_status',v_next,'comment',v_comment),now());
  RETURN v_next;
END;
$function$;
REVOKE ALL ON FUNCTION public.transition_generated_document_workflow(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_generated_document_workflow(uuid,uuid,text,text) TO authenticated;

-- Immutable source evidence is stored in the already private bucket.
DROP POLICY IF EXISTS gfs_procurement_quote_evidence_read ON storage.objects;
CREATE POLICY gfs_procurement_quote_evidence_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='gfs-private-documents'
  AND EXISTS (SELECT 1 FROM public.procurement_price_quotes q
    WHERE q.evidence_storage_path=storage.objects.name
      AND app_auth.has_tenant_data_permission(q.tenant_id,'documents:view')
      AND app_auth.is_tenant_in_good_standing(q.tenant_id)
      AND app_auth.is_tenant_module_enabled(q.tenant_id,'processos'))
);
DROP POLICY IF EXISTS gfs_procurement_quote_evidence_upload ON storage.objects;
CREATE POLICY gfs_procurement_quote_evidence_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='gfs-private-documents'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/procurement-quotes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
  AND app_auth.has_tenant_data_permission(CASE WHEN split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',1)::uuid ELSE NULL END,'documents:create')
  AND app_auth.is_tenant_in_good_standing(CASE WHEN split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',1)::uuid ELSE NULL END)
  AND app_auth.is_tenant_module_enabled(CASE WHEN split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',1)::uuid ELSE NULL END,'processos')
  AND EXISTS (SELECT 1 FROM public.procurement_price_quotes q
    WHERE q.tenant_id=CASE WHEN split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',1)::uuid ELSE NULL END
      AND q.procurement_item_id=CASE WHEN split_part(name,'/',3) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',3)::uuid ELSE NULL END
      AND q.id=CASE WHEN split_part(name,'/',4) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',4)::uuid ELSE NULL END)
);
DROP POLICY IF EXISTS gfs_procurement_quote_evidence_orphan_read ON storage.objects;
CREATE POLICY gfs_procurement_quote_evidence_orphan_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='gfs-private-documents' AND owner=(SELECT auth.uid())
  AND name ~* '^[0-9a-f-]{36}/procurement-quotes/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
  AND NOT EXISTS (SELECT 1 FROM public.procurement_price_quotes q WHERE q.evidence_storage_path=storage.objects.name)
  AND app_auth.has_tenant_data_permission(CASE WHEN split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',1)::uuid ELSE NULL END,'documents:create'));
DROP POLICY IF EXISTS gfs_procurement_quote_evidence_orphan_delete ON storage.objects;
CREATE POLICY gfs_procurement_quote_evidence_orphan_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='gfs-private-documents' AND owner=(SELECT auth.uid())
  AND name ~* '^[0-9a-f-]{36}/procurement-quotes/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
  AND NOT EXISTS (SELECT 1 FROM public.procurement_price_quotes q WHERE q.evidence_storage_path=storage.objects.name)
  AND app_auth.has_tenant_data_permission(CASE WHEN split_part(name,'/',1) ~* '^[0-9a-f-]{36}$' THEN split_part(name,'/',1)::uuid ELSE NULL END,'documents:create'));

COMMENT ON TABLE public.procurement_price_approvals IS 'Histórico append-only de aprovações do preço estimado por item, com método, justificativa, memória de cálculo e snapshot das fontes.';
COMMENT ON TABLE public.tenant_procurement_compliance IS 'Enquadramento normativo declarado e validado por autoridade da Secretaria; sem validação o mapa não pode tramitar.';
COMMIT;
