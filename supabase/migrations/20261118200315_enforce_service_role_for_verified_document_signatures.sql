BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- Custom GUCs are transaction-local but are not secret: an authenticated SQL
-- client can set them. A signature transition therefore also requires the
-- service-role JWT used only by the trusted Edge Function.
CREATE OR REPLACE FUNCTION public.fn_guard_generated_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_supplier_tenant uuid;
  v_template_tenant uuid;
  v_workflow_status text;
  v_verified_actor uuid;
  v_actor_email text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' THEN
      RAISE EXCEPTION 'Novos documentos precisam iniciar como rascunho.';
    END IF;
    NEW.created_by:=(SELECT auth.uid());
    NEW.updated_by:=(SELECT auth.uid());
    NEW.created_at:=now();
    NEW.updated_at:=now();
    NEW.signed_by:=NULL;
    NEW.signed_name:=NULL;
    NEW.signed_email:=NULL;
    NEW.signed_at:=NULL;
    NEW.signature_statement:=NULL;
    NEW.signed_pdf_storage_path:=NULL;
    NEW.signed_pdf_sha256:=NULL;
    NEW.signed_pdf_size:=NULL;
    NEW.signed_pdf_mime_type:=NULL;
    NEW.signed_content_sha256:=NULL;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria e dados de criação são imutáveis.';
    END IF;
    IF OLD.status='signed' THEN
      RAISE EXCEPTION 'Documento assinado é imutável.';
    END IF;

    SELECT w.status INTO v_workflow_status
    FROM public.generated_document_workflows w
    WHERE w.tenant_id=OLD.tenant_id AND w.document_id=OLD.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fluxo documental não inicializado; alteração bloqueada.' USING ERRCODE='42501';
    END IF;

    IF v_workflow_status IN ('pending_approval','approved','signed','cancelled')
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
      RAISE EXCEPTION 'Documento enviado, aprovado ou encerrado não pode ser alterado. Solicite devolução antes de editar.'
        USING ERRCODE='42501';
    END IF;

    IF NEW.status='signed' THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'A assinatura só pode ser finalizada pelo serviço seguro de documentos.' USING ERRCODE='42501';
      END IF;
      v_verified_actor:=NULLIF(pg_catalog.current_setting('app_auth.verified_signer_id',true),'')::uuid;
      IF v_verified_actor IS NULL THEN
        RAISE EXCEPTION 'A assinatura exige validação do arquivo PDF final pelo serviço seguro.' USING ERRCODE='42501';
      END IF;
      IF NOT app_auth.user_has_tenant_data_permission(v_verified_actor,OLD.tenant_id,'documents:sign') THEN
        RAISE EXCEPTION 'O usuário autenticado não possui permissão para assinar este documento.' USING ERRCODE='42501';
      END IF;
      IF NEW.signed_pdf_storage_path IS NULL
        OR NEW.signed_pdf_sha256 IS DISTINCT FROM pg_catalog.current_setting('app_auth.verified_file_sha256',true)
        OR NEW.signed_content_sha256 IS DISTINCT FROM pg_catalog.current_setting('app_auth.verified_content_sha256',true)
        OR NEW.signed_pdf_mime_type IS DISTINCT FROM 'application/pdf'
        OR NEW.signed_pdf_size IS NULL
        OR NEW.signed_pdf_size<1
        OR NEW.signed_pdf_size>20971520 THEN
        RAISE EXCEPTION 'Metadados do PDF final não correspondem ao arquivo validado.' USING ERRCODE='42501';
      END IF;
      NEW.title:=OLD.title;
      NEW.content_snapshot:=OLD.content_snapshot;
      NEW.supplier_id:=OLD.supplier_id;
      NEW.template_id:=OLD.template_id;
      NEW.signed_by:=v_verified_actor;
      SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),'Usuário')
        INTO NEW.signed_name
        FROM public.profiles p
        WHERE p.id=v_verified_actor;
      SELECT u.email INTO v_actor_email
        FROM auth.users u
        WHERE u.id=v_verified_actor;
      NEW.signed_email:=v_actor_email;
      NEW.signed_at:=now();
      NEW.signature_statement:='Assinatura eletrônica simples registrada após validação do PDF final. SHA-256 do arquivo: '
        || NEW.signed_pdf_sha256 || '. A assinatura simples não equivale à assinatura qualificada ICP-Brasil.';
      NEW.updated_by:=v_verified_actor;
    ELSE
      NEW.signed_by:=NULL;
      NEW.signed_name:=NULL;
      NEW.signed_email:=NULL;
      NEW.signed_at:=NULL;
      NEW.signature_statement:=NULL;
      NEW.signed_pdf_storage_path:=NULL;
      NEW.signed_pdf_sha256:=NULL;
      NEW.signed_pdf_size:=NULL;
      NEW.signed_pdf_mime_type:=NULL;
      NEW.signed_content_sha256:=NULL;
      NEW.updated_by:=(SELECT auth.uid());
    END IF;
    NEW.updated_at:=now();
  END IF;

  IF NEW.supplier_id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_supplier_tenant
    FROM public.suppliers s
    WHERE s.id=NEW.supplier_id;
    IF v_supplier_tenant IS NULL OR v_supplier_tenant<>NEW.tenant_id THEN
      RAISE EXCEPTION 'O documento e o fornecedor precisam pertencer à mesma Secretaria.';
    END IF;
  END IF;
  IF NEW.template_id IS NOT NULL THEN
    SELECT t.tenant_id INTO v_template_tenant
    FROM public.document_templates t
    WHERE t.id=NEW.template_id;
    IF v_template_tenant IS NULL OR v_template_tenant<>NEW.tenant_id THEN
      RAISE EXCEPTION 'O modelo e o documento precisam pertencer à mesma Secretaria.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_require_document_approval_before_sign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_status text;
  v_actor uuid;
BEGIN
  IF NEW.status='signed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT w.status INTO v_status
    FROM public.generated_document_workflows w
    WHERE w.tenant_id=OLD.tenant_id AND w.document_id=OLD.id;
    IF v_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'O documento precisa ser aprovado por outro usuário antes da assinatura.';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'A assinatura precisa ser finalizada pelo serviço seguro de documentos.' USING ERRCODE='42501';
    END IF;
    v_actor:=NULLIF(pg_catalog.current_setting('app_auth.verified_signer_id',true),'')::uuid;
    IF v_actor IS NULL OR NOT app_auth.user_has_tenant_data_permission(v_actor,OLD.tenant_id,'documents:sign') THEN
      RAISE EXCEPTION 'A assinatura precisa ser autenticada e autorizada.' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_generated_document_signature(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_document_id uuid,
  p_storage_path text,
  p_file_sha256 text,
  p_file_size bigint,
  p_content_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_document public.generated_documents%ROWTYPE;
  v_workflow_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'A finalização da assinatura é exclusiva do serviço seguro.' USING ERRCODE='42501';
  END IF;
  IF p_actor_id IS NULL
    OR NOT app_auth.user_has_tenant_data_permission(p_actor_id,p_tenant_id,'documents:sign')
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
    OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'documentos') THEN
    RAISE EXCEPTION 'Usuário não autorizado a assinar documentos desta Secretaria.' USING ERRCODE='42501';
  END IF;
  IF p_file_sha256 !~ '^[0-9a-f]{64}$'
    OR p_content_sha256 !~ '^[0-9a-f]{64}$'
    OR p_file_size NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'Hash ou tamanho do arquivo final inválido.';
  END IF;
  IF p_storage_path !~* ('^' || p_tenant_id::text || '/generated-documents/' || p_document_id::text || '/[0-9a-f-]{36}[.]pdf$') THEN
    RAISE EXCEPTION 'Caminho do PDF final não corresponde ao documento e à Secretaria.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id='gfs-private-documents'
      AND o.name=p_storage_path
      AND o.owner=p_actor_id
  ) THEN
    RAISE EXCEPTION 'O PDF final não foi enviado pelo usuário autenticado.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_document
  FROM public.generated_documents d
  WHERE d.id=p_document_id AND d.tenant_id=p_tenant_id
  FOR UPDATE;
  IF NOT FOUND OR v_document.status<>'draft' THEN
    RAISE EXCEPTION 'Documento não está disponível para assinatura.';
  END IF;
  SELECT w.status INTO v_workflow_status
  FROM public.generated_document_workflows w
  WHERE w.tenant_id=p_tenant_id AND w.document_id=p_document_id
  FOR UPDATE;
  IF v_workflow_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'O documento precisa estar aprovado antes da assinatura.';
  END IF;

  PERFORM pg_catalog.set_config('app_auth.verified_signer_id',p_actor_id::text,true);
  PERFORM pg_catalog.set_config('app_auth.verified_file_sha256',p_file_sha256,true);
  PERFORM pg_catalog.set_config('app_auth.verified_content_sha256',p_content_sha256,true);
  UPDATE public.generated_documents
  SET status='signed',
      signed_pdf_storage_path=p_storage_path,
      signed_pdf_sha256=p_file_sha256,
      signed_pdf_size=p_file_size,
      signed_pdf_mime_type='application/pdf',
      signed_content_sha256=p_content_sha256
  WHERE id=p_document_id AND tenant_id=p_tenant_id;
  SELECT * INTO v_document
  FROM public.generated_documents d
  WHERE d.id=p_document_id AND d.tenant_id=p_tenant_id;
  PERFORM pg_catalog.set_config('app_auth.verified_signer_id','',true);
  PERFORM pg_catalog.set_config('app_auth.verified_file_sha256','',true);
  PERFORM pg_catalog.set_config('app_auth.verified_content_sha256','',true);
  RETURN jsonb_build_object(
    'document_id',v_document.id,
    'signed_at',v_document.signed_at,
    'signed_by',v_document.signed_by,
    'sha256',v_document.signed_pdf_sha256,
    'file_size',v_document.signed_pdf_size,
    'storage_path',v_document.signed_pdf_storage_path
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_generated_document_signature(uuid,uuid,uuid,text,text,bigint,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_generated_document_signature(uuid,uuid,uuid,text,text,bigint,text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_generated_document_signature(uuid,uuid,uuid,text,text,bigint,text) IS
  'Finaliza assinatura simples apenas pelo serviço confiável após verificar PDF final, titularidade do upload, permissão e aprovação independente.';
COMMIT;
