BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE public.procurement_process_compliance
  ADD COLUMN IF NOT EXISTS supplier_non_response_record text;

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_process_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_actor uuid:=(SELECT auth.uid());
  v_has_priority_source boolean;
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

  PERFORM 1
  FROM public.procurement_processes p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.process_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processo não encontrado nesta Secretaria.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.generated_documents d
    JOIN public.generated_document_workflows w
      ON w.tenant_id=d.tenant_id AND w.document_id=d.id
    WHERE d.tenant_id=NEW.tenant_id
      AND d.process_id=NEW.process_id
      AND d.process_snapshot->>'document_kind'='price_map'
      AND w.status IN ('pending_approval','approved','signed')
  ) THEN
    RAISE EXCEPTION 'O enquadramento está vinculado a um mapa em aprovação ou assinado. Devolva ou cancele o documento antes de alterar a análise jurídica.'
      USING ERRCODE='42501';
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

    SELECT EXISTS (
      SELECT 1
      FROM public.procurement_price_quotes q
      JOIN public.procurement_items i
        ON i.tenant_id=q.tenant_id AND i.id=q.procurement_item_id
      WHERE q.tenant_id=NEW.tenant_id
        AND i.process_id=NEW.process_id
        AND i.is_active
        AND q.is_active
        AND q.source_type IN ('painel_precos','contratacoes_publicas')
    ) INTO v_has_priority_source;

    IF NOT v_has_priority_source
      AND length(btrim(COALESCE(NEW.priority_sources_justification,'')))<20 THEN
      RAISE EXCEPTION 'Sem utilização do Painel oficial ou de contratações públicas, justifique a impossibilidade de priorizar os parâmetros I e II do art. 5º da IN 65/2021 (mínimo de 20 caracteres).';
    END IF;

    IF length(btrim(COALESCE(NEW.supplier_non_response_record,'')))<10 THEN
      RAISE EXCEPTION 'Registre os fornecedores consultados que não apresentaram propostas ou declare que não houve fornecedores sem resposta (mínimo de 10 caracteres).';
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

COMMENT ON COLUMN public.procurement_process_compliance.supplier_non_response_record IS
  'Registro dos fornecedores consultados que não enviaram propostas, com datas/canais/prazos, ou declaração expressa de inexistência, conforme art. 5º, § 2º, IV, da IN SEGES/ME 65/2021.';

COMMIT;
