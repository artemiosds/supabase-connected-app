BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Serialize content edits with submit/approve transitions. Workflow transitions
-- lock generated_documents first and generated_document_workflows second; this
-- trigger follows the same order and fails closed if a workflow row is missing.
CREATE OR REPLACE FUNCTION public.fn_guard_generated_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_supplier_tenant uuid;
  v_template_tenant uuid;
  v_workflow_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Novos documentos precisam iniciar como rascunho.';
    END IF;
    NEW.created_by := (SELECT auth.uid());
    NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.signed_by := NULL;
    NEW.signed_name := NULL;
    NEW.signed_email := NULL;
    NEW.signed_at := NULL;
    NEW.signature_statement := NULL;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria e dados de criacao sao imutaveis.';
    END IF;
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'Documento assinado e imutavel.';
    END IF;

    SELECT w.status
      INTO v_workflow_status
    FROM public.generated_document_workflows AS w
    WHERE w.tenant_id = OLD.tenant_id
      AND w.document_id = OLD.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fluxo documental nao inicializado; alteracao bloqueada.'
        USING ERRCODE = '42501';
    END IF;

    IF v_workflow_status IN ('pending_approval', 'approved', 'signed', 'cancelled')
      AND (
        NEW.title IS DISTINCT FROM OLD.title
        OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
        OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
        OR NEW.template_id IS DISTINCT FROM OLD.template_id
        OR NEW.process_id IS DISTINCT FROM OLD.process_id
        OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
        OR NEW.document_type IS DISTINCT FROM OLD.document_type
        OR NEW.template_version IS DISTINCT FROM OLD.template_version
        OR NEW.process_snapshot IS DISTINCT FROM OLD.process_snapshot
        OR NEW.variables_snapshot IS DISTINCT FROM OLD.variables_snapshot
      ) THEN
      RAISE EXCEPTION 'Documento enviado para aprovacao, aprovado ou encerrado nao pode ser alterado. Solicite devolucao para correcao antes de editar.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'signed' THEN
      IF NOT app_auth.has_tenant_data_permission(OLD.tenant_id,'documents:sign') THEN
        RAISE EXCEPTION 'Sem permissao para registrar assinatura deste documento.' USING ERRCODE = '42501';
      END IF;
      NEW.title := OLD.title;
      NEW.content_snapshot := OLD.content_snapshot;
      NEW.supplier_id := OLD.supplier_id;
      NEW.template_id := OLD.template_id;
      NEW.signed_by := (SELECT auth.uid());
      SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),'Usuario')
        INTO NEW.signed_name
      FROM public.profiles AS p
      WHERE p.id = (SELECT auth.uid());
      NEW.signed_email := NULLIF((SELECT auth.jwt() ->> 'email'),'');
      NEW.signed_at := now();
      NEW.signature_statement := 'Assinatura eletronica simples registrada com autenticacao da conta na plataforma.';
    ELSE
      NEW.signed_by := NULL;
      NEW.signed_name := NULL;
      NEW.signed_email := NULL;
      NEW.signed_at := NULL;
      NEW.signature_statement := NULL;
    END IF;
    NEW.updated_by := (SELECT auth.uid());
    NEW.updated_at := now();
  END IF;

  IF NEW.supplier_id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_supplier_tenant
    FROM public.suppliers AS s
    WHERE s.id = NEW.supplier_id;
    IF v_supplier_tenant IS NULL OR v_supplier_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'O documento e o fornecedor precisam pertencer a mesma Secretaria.';
    END IF;
  END IF;

  IF NEW.template_id IS NOT NULL THEN
    SELECT t.tenant_id INTO v_template_tenant
    FROM public.document_templates AS t
    WHERE t.id = NEW.template_id;
    IF v_template_tenant IS NULL OR v_template_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'O modelo e o documento precisam pertencer a mesma Secretaria.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_generated_document() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_guard_generated_document() IS
  'Validates generated document identity, tenant relations, signature metadata and prevents edits while pending approval, approved, signed or cancelled.';

COMMIT;
