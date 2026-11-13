BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.transition_generated_document_workflow(
 p_tenant_id uuid,p_document_id uuid,p_action text,p_comment text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_actor uuid:=(SELECT auth.uid());
 v_document public.generated_documents%ROWTYPE;
 v_workflow public.generated_document_workflows%ROWTYPE;
 v_next text;
 v_comment text:=NULLIF(pg_catalog.btrim(p_comment),'');
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501'; END IF;
 IF NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
    OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'documentos') THEN
  RAISE EXCEPTION 'Secretaria inativa ou módulo de documentos indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_document FROM public.generated_documents d
 WHERE d.id=p_document_id AND d.tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado nesta Secretaria.'; END IF;
 SELECT * INTO v_workflow FROM public.generated_document_workflows w
 WHERE w.tenant_id=p_tenant_id AND w.document_id=p_document_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fluxo documental não inicializado.'; END IF;
 IF v_document.status<>'draft' THEN RAISE EXCEPTION 'Somente documentos em rascunho podem tramitar para aprovação.'; END IF;

 IF p_action='submit' THEN
  IF NOT (app_auth.has_tenant_data_permission(p_tenant_id,'documents:create')
      OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:update')) THEN
   RAISE EXCEPTION 'Sem permissão para enviar documentos à aprovação.' USING ERRCODE='42501';
  END IF;
  IF v_workflow.status NOT IN ('draft','rejected') THEN
   RAISE EXCEPTION 'Somente rascunhos ou documentos devolvidos podem ser enviados.';
  END IF;
  IF pg_catalog.strpos(v_document.content_snapshot,'[PREENCHER:')>0
     OR pg_catalog.strpos(v_document.content_snapshot,'[CAMPO NÃO CONFIGURADO:')>0
     OR v_document.content_snapshot ~ '\{\{[^}]+\}\}' THEN
   RAISE EXCEPTION 'Preencha ou configure todos os campos pendentes do documento antes de enviá-lo.';
  END IF;
  v_next:='pending_approval';
  UPDATE public.generated_document_workflows
  SET status=v_next,submitted_by=v_actor,submitted_at=pg_catalog.now(),
      decided_by=NULL,decided_at=NULL,decision_comment=NULL,updated_at=pg_catalog.now()
  WHERE tenant_id=p_tenant_id AND document_id=p_document_id;
 ELSIF p_action IN ('approve','reject') THEN
  IF NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve') THEN
   RAISE EXCEPTION 'Sem permissão para aprovar documentos.' USING ERRCODE='42501';
  END IF;
  IF v_workflow.status<>'pending_approval' THEN RAISE EXCEPTION 'O documento não está aguardando aprovação.'; END IF;
  IF v_workflow.submitted_by=v_actor THEN
   RAISE EXCEPTION 'A aprovação deve ser realizada por usuário diferente de quem enviou o documento.';
  END IF;
  IF p_action='reject' AND (v_comment IS NULL OR pg_catalog.length(v_comment)<5) THEN
   RAISE EXCEPTION 'Informe o motivo da devolução (mínimo de 5 caracteres).';
  END IF;
  v_next:=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END;
  UPDATE public.generated_document_workflows
  SET status=v_next,decided_by=v_actor,decided_at=pg_catalog.now(),
      decision_comment=v_comment,updated_at=pg_catalog.now()
  WHERE tenant_id=p_tenant_id AND document_id=p_document_id;
 ELSE
  RAISE EXCEPTION 'Ação de tramitação inválida.';
 END IF;

 INSERT INTO public.generated_document_workflow_events(tenant_id,document_id,actor_id,action,from_status,to_status,comment)
 VALUES(p_tenant_id,p_document_id,v_actor,
  CASE p_action WHEN 'submit' THEN 'submitted' WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
  v_workflow.status,v_next,v_comment);
 INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
 VALUES(p_tenant_id,v_actor,'document.workflow.'||p_action,'generated_documents',p_document_id::text,
  jsonb_build_object('from_status',v_workflow.status,'to_status',v_next,'comment',v_comment),pg_catalog.now());
 RETURN v_next;
END $$;
REVOKE ALL ON FUNCTION public.transition_generated_document_workflow(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_generated_document_workflow(uuid,uuid,text,text) TO authenticated;
COMMENT ON FUNCTION public.transition_generated_document_workflow(uuid,uuid,text,text) IS
  'Tramita documentos e bloqueia o envio quando houver placeholders ou campos não configurados.';

COMMIT;
