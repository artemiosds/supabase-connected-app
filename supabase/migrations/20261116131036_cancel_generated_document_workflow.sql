BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Align legacy document cancellations with the workflow state. Older clients
-- changed generated_documents.status directly and therefore left the workflow
-- badge and event trail stale.
UPDATE public.generated_document_workflows AS w
SET status = 'cancelled',
    decided_by = d.updated_by,
    decided_at = COALESCE(d.updated_at, d.created_at),
    decision_comment = 'Fluxo sincronizado com o status de cancelamento existente no documento.',
    updated_at = pg_catalog.now()
FROM public.generated_documents AS d
WHERE d.tenant_id = w.tenant_id
  AND d.id = w.document_id
  AND d.status = 'cancelled'
  AND w.status NOT IN ('cancelled', 'signed');

INSERT INTO public.generated_document_workflow_events(
  tenant_id, document_id, actor_id, action, from_status, to_status, comment, created_at
)
SELECT d.tenant_id, d.id, d.updated_by, 'cancelled', NULL, 'cancelled',
       'Fluxo sincronizado com o status de cancelamento existente no documento.',
       COALESCE(d.updated_at, d.created_at)
FROM public.generated_documents AS d
JOIN public.generated_document_workflows AS w
  ON w.tenant_id = d.tenant_id AND w.document_id = d.id
WHERE d.status = 'cancelled'
  AND w.status = 'cancelled'
  AND NOT EXISTS (
    SELECT 1
    FROM public.generated_document_workflow_events AS e
    WHERE e.tenant_id = d.tenant_id
      AND e.document_id = d.id
      AND e.action = 'cancelled'
      AND e.to_status = 'cancelled'
  );

CREATE OR REPLACE FUNCTION public.cancel_generated_document_workflow(
  p_tenant_id uuid,
  p_document_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_document public.generated_documents%ROWTYPE;
  v_workflow public.generated_document_workflows%ROWTYPE;
  v_comment text := NULLIF(pg_catalog.btrim(p_comment), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;
  IF NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'documentos') THEN
    RAISE EXCEPTION 'Secretaria inativa ou módulo de documentos indisponível.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar documentos.' USING ERRCODE = '42501';
  END IF;

  SELECT d.*
    INTO v_document
  FROM public.generated_documents AS d
  WHERE d.tenant_id = p_tenant_id AND d.id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento não encontrado nesta Secretaria.' USING ERRCODE = '42501';
  END IF;

  SELECT w.*
    INTO v_workflow
  FROM public.generated_document_workflows AS w
  WHERE w.tenant_id = p_tenant_id AND w.document_id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fluxo documental não inicializado.' USING ERRCODE = '42501';
  END IF;

  IF v_document.status IN ('signed', 'cancelled')
     OR v_workflow.status IN ('signed', 'cancelled') THEN
    RAISE EXCEPTION 'Documento assinado ou cancelado não pode ser cancelado novamente.';
  END IF;

  UPDATE public.generated_document_workflows
  SET status = 'cancelled',
      decided_by = v_actor,
      decided_at = pg_catalog.now(),
      decision_comment = v_comment,
      updated_at = pg_catalog.now()
  WHERE tenant_id = p_tenant_id AND document_id = p_document_id;

  UPDATE public.generated_documents
  SET status = 'cancelled'
  WHERE tenant_id = p_tenant_id AND id = p_document_id;

  INSERT INTO public.generated_document_workflow_events(
    tenant_id, document_id, actor_id, action, from_status, to_status, comment
  )
  VALUES (
    p_tenant_id, p_document_id, v_actor, 'cancelled',
    v_workflow.status, 'cancelled', v_comment
  );

  INSERT INTO public.audit_events(
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  )
  VALUES (
    p_tenant_id, v_actor, 'document.workflow.cancel', 'generated_documents',
    p_document_id::text,
    pg_catalog.jsonb_build_object(
      'from_status', v_workflow.status,
      'to_status', 'cancelled',
      'comment', v_comment
    ),
    pg_catalog.now()
  );

  RETURN 'cancelled';
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_generated_document_workflow(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_generated_document_workflow(uuid, uuid, text)
  TO authenticated;
COMMENT ON FUNCTION public.cancel_generated_document_workflow(uuid, uuid, text) IS
  'Cancels an unsigned generated document through its tenant-scoped approval workflow and records an immutable event.';

CREATE OR REPLACE FUNCTION public.fn_require_generated_document_workflow_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_workflow_status text;
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Documento cancelado e imutável.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT w.status
      INTO v_workflow_status
    FROM public.generated_document_workflows AS w
    WHERE w.tenant_id = OLD.tenant_id
      AND w.document_id = OLD.id
    FOR UPDATE;

    IF v_workflow_status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'Cancele o documento pelo fluxo de aprovação.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_require_generated_document_workflow_cancellation()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_require_generated_document_workflow_cancellation() IS
  'Prevents bypassing workflow cancellation and keeps cancelled generated documents immutable.';

DROP TRIGGER IF EXISTS trg_require_generated_document_workflow_cancellation
  ON public.generated_documents;
CREATE TRIGGER trg_require_generated_document_workflow_cancellation
BEFORE UPDATE ON public.generated_documents
FOR EACH ROW
EXECUTE FUNCTION public.fn_require_generated_document_workflow_cancellation();

COMMIT;
