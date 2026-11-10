-- Final structural phase: approval workflow, municipal role management and quote/contract traceability.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

INSERT INTO public.permissions(code,name,description,module)
VALUES('documents:approve','Aprovar documentos','Analisar, aprovar ou devolver documentos para ajuste.','documents')
ON CONFLICT(code) DO NOTHING;

-- The native administrator remains protected at runtime; this controlled migration
-- adds the new permission to built-in administrator roles.
ALTER TABLE public.tenant_role_permissions DISABLE TRIGGER trg_role_permissions_protect_admin;
INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r
JOIN public.permissions p ON p.code='documents:approve'
WHERE r.slug='admin' AND r.is_system
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE public.tenant_role_permissions ENABLE TRIGGER trg_role_permissions_protect_admin;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_tenant_id_id ON public.contracts(tenant_id,id);
ALTER TABLE public.procurement_price_quotes ADD COLUMN IF NOT EXISTS contract_id uuid;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.procurement_price_quotes'::regclass AND conname='fk_price_quote_contract_same_tenant') THEN
  ALTER TABLE public.procurement_price_quotes ADD CONSTRAINT fk_price_quote_contract_same_tenant
   FOREIGN KEY(tenant_id,contract_id) REFERENCES public.contracts(tenant_id,id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_price_quotes_contract ON public.procurement_price_quotes(tenant_id,contract_id) WHERE contract_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_validate_quote_contract_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_contract record; v_item record;
BEGIN
 IF NEW.contract_id IS NULL THEN RETURN NEW; END IF;
 SELECT c.tenant_id,c.process_id,c.supplier_id INTO v_contract
 FROM public.contracts c WHERE c.id=NEW.contract_id FOR KEY SHARE;
 IF NOT FOUND OR v_contract.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
  RAISE EXCEPTION 'O contrato selecionado não pertence a esta Secretaria.';
 END IF;
 SELECT i.tenant_id,i.process_id INTO v_item
 FROM public.procurement_items i WHERE i.id=NEW.procurement_item_id FOR KEY SHARE;
 IF NOT FOUND OR v_item.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR v_contract.process_id IS NULL OR v_contract.process_id IS DISTINCT FROM v_item.process_id THEN
  RAISE EXCEPTION 'O contrato e o item precisam pertencer ao mesmo processo e à mesma Secretaria.';
 END IF;
 IF v_contract.supplier_id IS NULL OR NEW.supplier_id IS DISTINCT FROM v_contract.supplier_id THEN
  RAISE EXCEPTION 'O fornecedor da cotação precisa ser o mesmo fornecedor cadastrado no contrato.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_validate_quote_contract_link() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_validate_quote_contract_link ON public.procurement_price_quotes;
CREATE TRIGGER trg_validate_quote_contract_link BEFORE INSERT OR UPDATE OF tenant_id,procurement_item_id,supplier_id,contract_id
ON public.procurement_price_quotes FOR EACH ROW EXECUTE FUNCTION public.fn_validate_quote_contract_link();

CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_documents_tenant_id_id ON public.generated_documents(tenant_id,id);
CREATE TABLE IF NOT EXISTS public.generated_document_workflows (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 document_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','approved','rejected','signed','cancelled')),
 submitted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 submitted_at timestamptz,
 decided_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 decided_at timestamptz,
 decision_comment text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,document_id),
 CONSTRAINT fk_document_workflow_document FOREIGN KEY(tenant_id,document_id)
  REFERENCES public.generated_documents(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT document_workflow_submission_consistency CHECK(
  status NOT IN ('pending_approval','rejected','approved','signed')
  OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
 ),
 CONSTRAINT document_workflow_decision_consistency CHECK(
  status NOT IN ('approved','signed')
  OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
 )
);
CREATE TABLE IF NOT EXISTS public.generated_document_workflow_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 document_id uuid NOT NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('created','submitted','approved','rejected','signed','cancelled')),
 from_status text,
 to_status text NOT NULL,
 comment text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fk_document_workflow_event_workflow FOREIGN KEY(tenant_id,document_id)
  REFERENCES public.generated_document_workflows(tenant_id,document_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ix_document_workflows_tenant_status ON public.generated_document_workflows(tenant_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_document_workflow_events_document ON public.generated_document_workflow_events(tenant_id,document_id,created_at,id);

ALTER TABLE public.generated_document_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_document_workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.generated_document_workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_document_workflow_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.generated_document_workflows,public.generated_document_workflow_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.generated_document_workflows,public.generated_document_workflow_events TO authenticated;
DROP POLICY IF EXISTS p_document_workflows_read ON public.generated_document_workflows;
CREATE POLICY p_document_workflows_read ON public.generated_document_workflows FOR SELECT TO authenticated
 USING(app_auth.has_tenant_data_permission(tenant_id,'documents:view')
 AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'documentos'));
DROP POLICY IF EXISTS p_document_workflow_events_read ON public.generated_document_workflow_events;
CREATE POLICY p_document_workflow_events_read ON public.generated_document_workflow_events FOR SELECT TO authenticated
 USING(app_auth.has_tenant_data_permission(tenant_id,'documents:view')
 AND app_auth.is_tenant_in_good_standing(tenant_id) AND app_auth.is_tenant_module_enabled(tenant_id,'documentos'));

CREATE OR REPLACE FUNCTION public.fn_initialize_generated_document_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_status text;
BEGIN
 v_status:=CASE NEW.status WHEN 'signed' THEN 'signed' WHEN 'cancelled' THEN 'cancelled' ELSE 'draft' END;
 INSERT INTO public.generated_document_workflows(tenant_id,document_id,status,submitted_by,submitted_at,decided_by,decided_at,decision_comment)
 VALUES(NEW.tenant_id,NEW.id,v_status,
  CASE WHEN v_status='signed' THEN NEW.created_by END,
  CASE WHEN v_status='signed' THEN NEW.created_at END,
  CASE WHEN v_status='signed' THEN NEW.signed_by END,
  CASE WHEN v_status='signed' THEN NEW.signed_at END,
  CASE WHEN v_status='signed' THEN 'Documento assinado antes da implantação do fluxo de aprovação.' END)
 ON CONFLICT(tenant_id,document_id) DO NOTHING;
 INSERT INTO public.generated_document_workflow_events(tenant_id,document_id,actor_id,action,from_status,to_status,comment)
 VALUES(NEW.tenant_id,NEW.id,NEW.created_by,
  CASE v_status WHEN 'signed' THEN 'signed' WHEN 'cancelled' THEN 'cancelled' ELSE 'created' END,
  NULL,v_status,'Registro inicial do fluxo documental.');
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_initialize_generated_document_workflow() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_initialize_generated_document_workflow ON public.generated_documents;
CREATE TRIGGER trg_initialize_generated_document_workflow AFTER INSERT ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.fn_initialize_generated_document_workflow();

-- Keep prior generated documents, signatures and data intact.
INSERT INTO public.generated_document_workflows(tenant_id,document_id,status,submitted_by,submitted_at,decided_by,decided_at,decision_comment)
SELECT d.tenant_id,d.id,
 CASE d.status WHEN 'signed' THEN 'signed' WHEN 'cancelled' THEN 'cancelled' ELSE 'draft' END,
 CASE WHEN d.status='signed' THEN d.created_by END,
 CASE WHEN d.status='signed' THEN d.created_at END,
 CASE WHEN d.status='signed' THEN d.signed_by END,
 CASE WHEN d.status='signed' THEN d.signed_at END,
 CASE WHEN d.status='signed' THEN 'Documento assinado antes da implantação do fluxo de aprovação.' END
FROM public.generated_documents d ON CONFLICT(tenant_id,document_id) DO NOTHING;
INSERT INTO public.generated_document_workflow_events(tenant_id,document_id,actor_id,action,from_status,to_status,comment)
SELECT w.tenant_id,w.document_id,d.created_by,
 CASE w.status WHEN 'signed' THEN 'signed' WHEN 'cancelled' THEN 'cancelled' ELSE 'created' END,
 NULL,w.status,'Fluxo documental inicializado.'
FROM public.generated_document_workflows w
JOIN public.generated_documents d ON d.id=w.document_id AND d.tenant_id=w.tenant_id
WHERE NOT EXISTS(SELECT 1 FROM public.generated_document_workflow_events e WHERE e.tenant_id=w.tenant_id AND e.document_id=w.document_id);

CREATE OR REPLACE FUNCTION public.fn_require_document_approval_before_sign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_status text;
BEGIN
 IF NEW.status='signed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  IF NOT app_auth.has_tenant_data_permission(OLD.tenant_id,'documents:sign') THEN
   RAISE EXCEPTION 'Sem permissão para assinar este documento.' USING ERRCODE='42501';
  END IF;
  SELECT w.status INTO v_status FROM public.generated_document_workflows w
  WHERE w.tenant_id=OLD.tenant_id AND w.document_id=OLD.id;
  IF v_status IS DISTINCT FROM 'approved' THEN
   RAISE EXCEPTION 'O documento precisa ser aprovado por outro usuário antes da assinatura.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_require_document_approval_before_sign() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS a_generated_document_approval_gate ON public.generated_documents;
CREATE TRIGGER a_generated_document_approval_gate BEFORE UPDATE OF status ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.fn_require_document_approval_before_sign();

CREATE OR REPLACE FUNCTION public.fn_sync_document_workflow_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old text; v_new text; v_action text;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
 IF NEW.status='signed' THEN v_new:='signed';v_action:='signed';
 ELSIF NEW.status='cancelled' THEN v_new:='cancelled';v_action:='cancelled';
 ELSE RETURN NULL; END IF;
 SELECT status INTO v_old FROM public.generated_document_workflows
 WHERE tenant_id=NEW.tenant_id AND document_id=NEW.id FOR UPDATE;
 IF v_old IS NULL THEN RAISE EXCEPTION 'Fluxo documental não inicializado.'; END IF;
 UPDATE public.generated_document_workflows SET status=v_new,updated_at=now()
 WHERE tenant_id=NEW.tenant_id AND document_id=NEW.id;
 INSERT INTO public.generated_document_workflow_events(tenant_id,document_id,actor_id,action,from_status,to_status,comment)
 VALUES(NEW.tenant_id,NEW.id,(SELECT auth.uid()),v_action,v_old,v_new,
  CASE v_new WHEN 'signed' THEN 'Assinatura eletrônica simples registrada.' ELSE 'Documento cancelado.' END);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_sync_document_workflow_status() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_sync_document_workflow_status ON public.generated_documents;
CREATE TRIGGER trg_sync_document_workflow_status AFTER UPDATE OF status ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_document_workflow_status();

CREATE OR REPLACE FUNCTION public.get_document_workflow_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_submit boolean,can_approve boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT
  (app_auth.has_tenant_data_permission(p_tenant_id,'documents:create')
   OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:update'))
    AND app_auth.is_tenant_in_good_standing(p_tenant_id)
    AND app_auth.is_tenant_module_enabled(p_tenant_id,'documentos'),
  app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve')
    AND app_auth.is_tenant_in_good_standing(p_tenant_id)
    AND app_auth.is_tenant_module_enabled(p_tenant_id,'documentos');
$$;
REVOKE ALL ON FUNCTION public.get_document_workflow_capabilities(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_document_workflow_capabilities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_generated_document_workflows(p_tenant_id uuid)
RETURNS TABLE(document_id uuid,status text,submitted_by uuid,submitted_at timestamptz,decided_by uuid,decided_at timestamptz,decision_comment text,events jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT w.document_id,w.status,w.submitted_by,w.submitted_at,w.decided_by,w.decided_at,w.decision_comment,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id,'actor_id',e.actor_id,'action',e.action,'from_status',e.from_status,
   'to_status',e.to_status,'comment',e.comment,'created_at',e.created_at
  ) ORDER BY e.created_at,e.id)
  FROM public.generated_document_workflow_events e
  WHERE e.tenant_id=w.tenant_id AND e.document_id=w.document_id),'[]'::jsonb)
 FROM public.generated_document_workflows w
 WHERE w.tenant_id=p_tenant_id
  AND app_auth.has_tenant_data_permission(p_tenant_id,'documents:view')
  AND app_auth.is_tenant_in_good_standing(p_tenant_id)
  AND app_auth.is_tenant_module_enabled(p_tenant_id,'documentos')
 ORDER BY w.updated_at DESC,w.document_id;
$$;
REVOKE ALL ON FUNCTION public.list_generated_document_workflows(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_generated_document_workflows(uuid) TO authenticated;

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
     OR v_document.content_snapshot ~ '\{\{[^}]+\}\}' THEN
   RAISE EXCEPTION 'Preencha os campos pendentes do documento antes de enviá-lo.';
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

CREATE OR REPLACE FUNCTION public.get_tenant_role_management_capability(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT app_auth.has_tenant_permission(p_tenant_id,'roles:manage')
 AND app_auth.is_tenant_in_good_standing(p_tenant_id); $$;
REVOKE ALL ON FUNCTION public.get_tenant_role_management_capability(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_role_management_capability(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_tenant_role_with_permissions(
 p_tenant_id uuid,p_role_id uuid,p_name text,p_slug text,p_description text,p_permission_ids uuid[]
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_role_id uuid; v_count bigint; v_distinct bigint;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT app_auth.has_tenant_permission(p_tenant_id,'roles:manage')
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) THEN
  RAISE EXCEPTION 'Sem permissão para administrar perfis desta Secretaria.' USING ERRCODE='42501';
 END IF;
 IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 2 AND 80
    OR p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9_-]{1,59}$'
    OR (p_description IS NOT NULL AND pg_catalog.length(p_description)>300) THEN
  RAISE EXCEPTION 'Nome, identificador ou descrição do perfil inválidos.';
 END IF;
 IF p_permission_ids IS NULL OR pg_catalog.cardinality(p_permission_ids)=0 THEN
  RAISE EXCEPTION 'Selecione ao menos uma permissão para o perfil.';
 END IF;
 SELECT pg_catalog.count(*),pg_catalog.count(DISTINCT x) INTO v_count,v_distinct
 FROM pg_catalog.unnest(p_permission_ids) x JOIN public.permissions p ON p.id=x;
 IF v_count<>pg_catalog.cardinality(p_permission_ids) OR v_distinct<>pg_catalog.cardinality(p_permission_ids) THEN
  RAISE EXCEPTION 'A lista contém permissões inexistentes ou repetidas.';
 END IF;
 IF p_role_id IS NULL THEN
  INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
  VALUES(p_tenant_id,pg_catalog.btrim(p_name),p_slug,NULLIF(pg_catalog.btrim(p_description),''),false)
  RETURNING id INTO v_role_id;
 ELSE
  SELECT r.id INTO v_role_id FROM public.tenant_roles r
  WHERE r.id=p_role_id AND r.tenant_id=p_tenant_id AND NOT r.is_system FOR UPDATE;
  IF v_role_id IS NULL THEN RAISE EXCEPTION 'Perfil personalizado não encontrado ou perfil nativo protegido.'; END IF;
  UPDATE public.tenant_roles SET name=pg_catalog.btrim(p_name),slug=p_slug,
    description=NULLIF(pg_catalog.btrim(p_description),''),updated_at=pg_catalog.now()
  WHERE id=v_role_id AND tenant_id=p_tenant_id;
 END IF;
 DELETE FROM public.tenant_role_permissions rp WHERE rp.role_id=v_role_id;
 INSERT INTO public.tenant_role_permissions(role_id,permission_id)
 SELECT v_role_id,x FROM pg_catalog.unnest(p_permission_ids) x;
 INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
 VALUES(p_tenant_id,(SELECT auth.uid()),'tenant_role.permissions_saved','tenant_roles',v_role_id::text,
  jsonb_build_object('permission_ids',p_permission_ids,'is_system',false),pg_catalog.now());
 RETURN v_role_id;
END $$;
REVOKE ALL ON FUNCTION public.save_tenant_role_with_permissions(uuid,uuid,text,text,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_role_with_permissions(uuid,uuid,text,text,text,uuid[]) TO authenticated;

COMMIT;