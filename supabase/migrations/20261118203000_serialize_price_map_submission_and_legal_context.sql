BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- The fingerprint now includes the process-specific legal/funding decision,
-- not the tenant-wide default profile that merely pre-fills the form.
CREATE OR REPLACE FUNCTION app_auth.procurement_price_research_fingerprint(
  p_tenant_id uuid,
  p_process_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT pg_catalog.md5(pg_catalog.jsonb_build_object(
    'items',COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number,i.id)
      FROM public.procurement_items i
      WHERE i.tenant_id=p_tenant_id AND i.process_id=p_process_id AND i.is_active
    ),'[]'::jsonb),
    'quotes',COALESCE((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.procurement_item_id,q.quoted_at,q.id)
      FROM public.procurement_price_quotes q
      JOIN public.procurement_items i ON i.tenant_id=q.tenant_id AND i.id=q.procurement_item_id
      WHERE q.tenant_id=p_tenant_id AND i.process_id=p_process_id
    ),'[]'::jsonb),
    'approvals',COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.procurement_item_id,a.approved_at,a.id)
      FROM public.procurement_price_approvals a
      WHERE a.tenant_id=p_tenant_id AND a.process_id=p_process_id
    ),'[]'::jsonb),
    'process_compliance',COALESCE((
      SELECT to_jsonb(c)
      FROM public.procurement_process_compliance c
      WHERE c.tenant_id=p_tenant_id AND c.process_id=p_process_id
    ),'{}'::jsonb)
  )::text);
$function$;
REVOKE ALL ON FUNCTION app_auth.procurement_price_research_fingerprint(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Serialize every item/quote mutation with map submission. This closes the
-- race in which a new row could otherwise be inserted after fingerprinting.
CREATE OR REPLACE FUNCTION public.fn_guard_price_map_research_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_process_id uuid;
BEGIN
  IF TG_TABLE_NAME='procurement_items' THEN
    v_process_id:=NEW.process_id;
  ELSE
    SELECT i.process_id INTO v_process_id
    FROM public.procurement_items i
    WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.procurement_item_id;
  END IF;

  IF v_process_id IS NULL THEN
    RAISE EXCEPTION 'Processo do item da pesquisa não encontrado.';
  END IF;

  PERFORM 1
  FROM public.procurement_processes p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=v_process_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processo da pesquisa não pertence a esta Secretaria.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.generated_documents d
    JOIN public.generated_document_workflows w
      ON w.tenant_id=d.tenant_id AND w.document_id=d.id
    WHERE d.tenant_id=NEW.tenant_id
      AND d.process_id=v_process_id
      AND d.process_snapshot->>'document_kind'='price_map'
      AND w.status IN ('pending_approval','approved','signed')
  ) THEN
    RAISE EXCEPTION 'A pesquisa está vinculada a um mapa em aprovação ou assinado. Devolva ou cancele o documento antes de alterar os dados.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_price_map_research_mutation()
  FROM PUBLIC,anon,authenticated,service_role;

-- The process lock also serializes legal/funding changes with price-map
-- submission. A signed or in-review map cannot have its legal basis changed.
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

-- Submission locks the process before comparing the captured fingerprint.
-- Mutations lock the same process row in their BEFORE triggers, so no item,
-- quote, approval or legal-context change can slip between validation and
-- the transition to pending_approval.
CREATE OR REPLACE FUNCTION public.transition_generated_document_workflow(
  p_tenant_id uuid,
  p_document_id uuid,
  p_action text,
  p_comment text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_actor uuid:=(SELECT auth.uid());
  v_document public.generated_documents%ROWTYPE;
  v_workflow public.generated_document_workflows%ROWTYPE;
  v_next text;
  v_comment text:=NULLIF(btrim(p_comment),'');
  v_active_items integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501';
  END IF;
  IF NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
    OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'documentos') THEN
    RAISE EXCEPTION 'Secretaria inativa ou módulo de documentos indisponível.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_document
  FROM public.generated_documents d
  WHERE d.id=p_document_id AND d.tenant_id=p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento não encontrado nesta Secretaria.';
  END IF;
  SELECT * INTO v_workflow
  FROM public.generated_document_workflows w
  WHERE w.tenant_id=p_tenant_id AND w.document_id=p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fluxo documental não inicializado.';
  END IF;
  IF v_document.status<>'draft' THEN
    RAISE EXCEPTION 'Somente documentos em rascunho podem tramitar para aprovação.';
  END IF;

  IF p_action='submit' THEN
    IF NOT (
      app_auth.has_tenant_data_permission(p_tenant_id,'documents:create')
      OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:update')
    ) THEN
      RAISE EXCEPTION 'Sem permissão para enviar documentos à aprovação.' USING ERRCODE='42501';
    END IF;
    IF v_workflow.status NOT IN ('draft','rejected') THEN
      RAISE EXCEPTION 'Somente rascunhos ou documentos devolvidos podem ser enviados.';
    END IF;
    IF pg_catalog.strpos(v_document.content_snapshot,'[PREENCHER:')>0
      OR pg_catalog.strpos(v_document.content_snapshot,'[CAMPO NÃO CONFIGURADO:')>0
      OR v_document.content_snapshot ~ '\\{\\{[^}]+\\}\\}' THEN
      RAISE EXCEPTION 'Preencha ou configure todos os campos pendentes do documento antes de enviá-lo.';
    END IF;

    IF v_document.process_snapshot->>'document_kind'='price_map' THEN
      IF v_document.process_id IS NULL THEN
        RAISE EXCEPTION 'Mapa comparativo sem vínculo com o processo.';
      END IF;

      PERFORM 1
      FROM public.procurement_processes p
      WHERE p.tenant_id=p_tenant_id AND p.id=v_document.process_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Processo do mapa comparativo não pertence a esta Secretaria.';
      END IF;

      IF v_document.process_snapshot->>'price_research_fingerprint' IS DISTINCT FROM
        app_auth.procurement_price_research_fingerprint(p_tenant_id,v_document.process_id) THEN
        RAISE EXCEPTION 'A pesquisa, as aprovações ou o enquadramento jurídico mudaram após a geração do mapa. Gere novamente o documento para capturar a versão atual.';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.procurement_process_compliance c
        WHERE c.tenant_id=p_tenant_id
          AND c.process_id=v_document.process_id
          AND c.legal_review_status='validated'
          AND c.normative_basis<>'pending'
          AND c.in65_applicability<>'pending'
          AND c.funding_source_type<>'unknown'
      ) THEN
        RAISE EXCEPTION 'Valide a origem dos recursos e o enquadramento normativo deste processo antes de enviar o mapa para aprovação.';
      END IF;

      SELECT count(*)::integer INTO v_active_items
      FROM public.procurement_items i
      WHERE i.tenant_id=p_tenant_id AND i.process_id=v_document.process_id AND i.is_active;

      IF v_active_items=0 OR EXISTS (
        SELECT 1
        FROM public.procurement_items i
        WHERE i.tenant_id=p_tenant_id
          AND i.process_id=v_document.process_id
          AND i.is_active
          AND (
            i.estimated_price_source<>'approved'
            OR NOT EXISTS (
              SELECT 1
              FROM public.procurement_price_approvals a
              WHERE a.tenant_id=i.tenant_id
                AND a.procurement_item_id=i.id
                AND a.status='approved'
                AND a.approved_unit_price=i.estimated_unit_price
            )
          )
      ) THEN
        RAISE EXCEPTION 'Todos os itens ativos precisam ter preço estimado aprovado e compatível com a memória de cálculo antes da tramitação do mapa.';
      END IF;
    END IF;

    v_next:='pending_approval';
    UPDATE public.generated_document_workflows
    SET status=v_next,
        submitted_by=v_actor,
        submitted_at=now(),
        decided_by=NULL,
        decided_at=NULL,
        decision_comment=NULL,
        updated_at=now()
    WHERE tenant_id=p_tenant_id AND document_id=p_document_id;
  ELSIF p_action IN ('approve','reject') THEN
    IF NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar documentos.' USING ERRCODE='42501';
    END IF;
    IF v_workflow.status<>'pending_approval' THEN
      RAISE EXCEPTION 'O documento não está aguardando aprovação.';
    END IF;
    IF v_workflow.submitted_by=v_actor THEN
      RAISE EXCEPTION 'A aprovação deve ser realizada por usuário diferente de quem enviou o documento.';
    END IF;
    IF p_action='reject' AND (v_comment IS NULL OR length(v_comment)<5) THEN
      RAISE EXCEPTION 'Informe o motivo da devolução (mínimo de 5 caracteres).';
    END IF;
    v_next:=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END;
    UPDATE public.generated_document_workflows
    SET status=v_next,
        decided_by=v_actor,
        decided_at=now(),
        decision_comment=v_comment,
        updated_at=now()
    WHERE tenant_id=p_tenant_id AND document_id=p_document_id;
  ELSE
    RAISE EXCEPTION 'Ação de tramitação inválida.';
  END IF;

  INSERT INTO public.generated_document_workflow_events(
    tenant_id,document_id,actor_id,action,from_status,to_status,comment
  )
  VALUES(
    p_tenant_id,p_document_id,v_actor,
    CASE p_action WHEN 'submit' THEN 'submitted' WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    v_workflow.status,v_next,v_comment
  );

  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(
    p_tenant_id,v_actor,'document.workflow.'||p_action,'generated_documents',p_document_id::text,
    jsonb_build_object('from_status',v_workflow.status,'to_status',v_next,'comment',v_comment),now()
  );
  RETURN v_next;
END;
$function$;

COMMIT;