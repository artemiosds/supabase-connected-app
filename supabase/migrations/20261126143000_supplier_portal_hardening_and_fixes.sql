-- Endurecimento de segurança e correção funcional do Portal de Autoatendimento do Fornecedor:
-- 1) Permite que RPCs SECURITY DEFINER controladas informem created_by quando auth.uid() for NULL, sem relaxar inserts diretos.
-- 2) Garante checagem comercial e de módulo em get_supplier_portal_data e submit_supplier_portal_document.
-- 3) Corrige vínculo de checklist quando homologation_id no token é NULL, valida URL HTTP(S) segura, bloqueia envio vazio/homologação encerrada, usa colunas reais em supplier_homologation_events ('completion_received') e registra audit_events.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_guard_supplier_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_supplier_tenant uuid;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.created_by := v_uid;
      NEW.updated_by := v_uid;
    ELSE
      IF NEW.created_by IS NULL THEN
        RAISE EXCEPTION 'Autor do documento obrigatorio.';
      END IF;
      NEW.updated_by := COALESCE(NEW.updated_by, NEW.created_by);
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria, fornecedor e dados de criacao sao imutaveis.';
    END IF;
    NEW.updated_by := COALESCE(v_uid, NEW.updated_by, OLD.updated_by);
    NEW.updated_at := now();
  END IF;

  SELECT s.tenant_id INTO v_supplier_tenant
  FROM public.suppliers s
  WHERE s.id = NEW.supplier_id;

  IF v_supplier_tenant IS NULL OR v_supplier_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'O documento e o fornecedor precisam pertencer a mesma Secretaria.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_supplier_portal_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_rec            record;
  v_token          text := pg_catalog.btrim(COALESCE(p_token, ''));
  v_supplier_json  jsonb;
  v_tenant_json    jsonb;
  v_homolog_json   jsonb;
  v_checklist_json jsonb;
  v_docs_json      jsonb;
BEGIN
  IF pg_catalog.length(v_token) < 32 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token inválido ou inexistente.');
  END IF;

  SELECT
    spt.id, spt.tenant_id, spt.supplier_id, spt.homologation_id,
    spt.expires_at, spt.is_revoked,
    s.legal_name, s.trade_name, s.cnpj, s.category, s.status AS supplier_status,
    t.name AS tenant_name, t.status AS tenant_status
  INTO v_rec
  FROM public.supplier_portal_tokens spt
  JOIN public.suppliers s ON s.id = spt.supplier_id AND s.tenant_id = spt.tenant_id
  JOIN public.tenants   t ON t.id = spt.tenant_id
  WHERE spt.token = v_token;

  IF v_rec IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token inválido ou inexistente.');
  END IF;

  IF v_rec.is_revoked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este link de acesso foi revogado pela Secretaria.');
  END IF;

  IF v_rec.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este link de acesso expirou. Solicite um novo à Secretaria.');
  END IF;

  IF v_rec.tenant_status <> 'active'
     OR NOT app_auth.is_tenant_in_good_standing(v_rec.tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(v_rec.tenant_id, 'fornecedores') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Portal temporariamente indisponível para esta Secretaria.');
  END IF;

  v_supplier_json := jsonb_build_object(
    'id', v_rec.supplier_id,
    'legal_name', v_rec.legal_name,
    'trade_name', v_rec.trade_name,
    'cnpj', v_rec.cnpj,
    'category', v_rec.category,
    'status', v_rec.supplier_status
  );

  v_tenant_json := jsonb_build_object(
    'id', v_rec.tenant_id,
    'name', v_rec.tenant_name
  );

  SELECT jsonb_build_object(
    'id', sh.id,
    'status', sh.status,
    'category', sh.category,
    'conclusion_status', sh.conclusion_status,
    'conclusion_notes', sh.conclusion_notes,
    'created_at', sh.created_at
  )
  INTO v_homolog_json
  FROM public.supplier_homologations sh
  WHERE sh.tenant_id = v_rec.tenant_id
    AND sh.supplier_id = v_rec.supplier_id
    AND (v_rec.homologation_id IS NULL OR sh.id = v_rec.homologation_id)
  ORDER BY sh.created_at DESC
  LIMIT 1;

  IF v_homolog_json IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', ci.id,
          'title', ci.title,
          'description', ci.description,
          'document_type', ci.document_type,
          'is_mandatory', ci.is_mandatory,
          'verification_status', ci.verification_status,
          'notes', ci.notes
        )
        ORDER BY ci.is_mandatory DESC, ci.title ASC
      ),
      '[]'::jsonb
    )
    INTO v_checklist_json
    FROM public.supplier_homologation_checklist_items ci
    WHERE ci.tenant_id = v_rec.tenant_id
      AND ci.homologation_id = (v_homolog_json->>'id')::uuid;
  ELSE
    v_checklist_json := '[]'::jsonb;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sd.id,
        'title', sd.title,
        'document_type', sd.document_type,
        'expires_at', sd.expires_at,
        'status', sd.status
      )
      ORDER BY sd.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_docs_json
  FROM public.supplier_documents sd
  WHERE sd.tenant_id = v_rec.tenant_id
    AND sd.supplier_id = v_rec.supplier_id
    AND sd.status = 'active';

  RETURN jsonb_build_object(
    'success', true,
    'supplier', v_supplier_json,
    'tenant', v_tenant_json,
    'homologation', v_homolog_json,
    'checklist_items', v_checklist_json,
    'documents', v_docs_json,
    'expires_at', v_rec.expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_supplier_portal_document(
  p_token text,
  p_checklist_item_id uuid DEFAULT NULL::uuid,
  p_title text DEFAULT NULL::text,
  p_document_type text DEFAULT 'outros'::text,
  p_file_name text DEFAULT NULL::text,
  p_storage_path text DEFAULT NULL::text,
  p_external_url text DEFAULT NULL::text,
  p_expires_at date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_rec           record;
  v_token         text := pg_catalog.btrim(COALESCE(p_token, ''));
  v_doc_id        uuid;
  v_homolog_id    uuid;
  v_homolog_stat  text;
  v_item_rec      record;
  v_creator_id    uuid;
  v_title         text;
  v_doc_type      text;
  v_url           text;
  v_protocol      text;
BEGIN
  IF pg_catalog.length(v_token) < 32 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token de acesso inválido.');
  END IF;

  SELECT
    spt.id, spt.tenant_id, spt.supplier_id, spt.homologation_id,
    spt.expires_at, spt.is_revoked, spt.created_by,
    t.status AS tenant_status
  INTO v_rec
  FROM public.supplier_portal_tokens spt
  JOIN public.tenants t ON t.id = spt.tenant_id
  WHERE spt.token = v_token
  FOR UPDATE OF spt;

  IF v_rec IS NULL OR v_rec.is_revoked OR v_rec.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token de acesso inválido, revogado ou expirado.');
  END IF;

  IF v_rec.tenant_status <> 'active'
     OR NOT app_auth.is_tenant_in_good_standing(v_rec.tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(v_rec.tenant_id, 'fornecedores') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Envio temporariamente indisponível para esta Secretaria.');
  END IF;

  v_url := NULLIF(pg_catalog.btrim(COALESCE(p_external_url, '')), '');
  IF v_url IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe o link HTTP/HTTPS do documento ou certidão.');
  END IF;

  IF pg_catalog.length(v_url) > 2048
     OR v_url !~* '^https?://[^[:space:]@/]+([/?#][^[:space:]]*)?$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link inválido. Utilize uma URL http:// ou https:// pública e sem credenciais.');
  END IF;

  v_title := COALESCE(NULLIF(pg_catalog.btrim(p_title), ''), 'Documento enviado pelo fornecedor');
  IF pg_catalog.length(pg_catalog.btrim(v_title)) NOT BETWEEN 2 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'O título do documento deve ter entre 2 e 180 caracteres.');
  END IF;

  v_doc_type := CASE
    WHEN COALESCE(pg_catalog.btrim(p_document_type), '') = ANY (ARRAY[
      'contrato', 'certidao_federal', 'certidao_estadual', 'certidao_municipal',
      'fgts', 'trabalhista', 'sanitaria', 'alvara', 'proposta', 'outros'
    ]) THEN pg_catalog.btrim(p_document_type)
    ELSE 'outros'
  END;

  v_creator_id := v_rec.created_by;
  v_homolog_id := v_rec.homologation_id;

  IF p_checklist_item_id IS NOT NULL THEN
    SELECT
      ci.id, ci.homologation_id, ci.verification_status,
      sh.status AS homolog_status
    INTO v_item_rec
    FROM public.supplier_homologation_checklist_items ci
    JOIN public.supplier_homologations sh ON sh.id = ci.homologation_id
    WHERE ci.id = p_checklist_item_id
      AND ci.tenant_id = v_rec.tenant_id
      AND sh.tenant_id = v_rec.tenant_id
      AND sh.supplier_id = v_rec.supplier_id
      AND (v_homolog_id IS NULL OR ci.homologation_id = v_homolog_id)
    FOR UPDATE OF ci;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Item de checklist não encontrado para este fornecedor.');
    END IF;

    IF v_item_rec.homolog_status IN ('completed', 'cancelled') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Esta análise de homologação já foi encerrada e não aceita novos envios.');
    END IF;

    IF v_item_rec.verification_status = 'verified' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Este item já foi conferido e aprovado pela Secretaria.');
    END IF;

    v_homolog_id   := v_item_rec.homologation_id;
    v_homolog_stat := v_item_rec.homolog_status;
  ELSIF v_homolog_id IS NOT NULL THEN
    SELECT sh.status INTO v_homolog_stat
    FROM public.supplier_homologations sh
    WHERE sh.id = v_homolog_id
      AND sh.tenant_id = v_rec.tenant_id
      AND sh.supplier_id = v_rec.supplier_id;

    IF v_homolog_stat IN ('completed', 'cancelled') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Esta análise de homologação já foi encerrada e não aceita novos envios.');
    END IF;
  END IF;

  INSERT INTO public.supplier_documents (
    tenant_id, supplier_id, title, document_type,
    storage_provider, file_name, storage_path, external_url, expires_at,
    status, created_by, updated_by
  ) VALUES (
    v_rec.tenant_id, v_rec.supplier_id, v_title, v_doc_type,
    'external_link', NULL, NULL, v_url, p_expires_at,
    'active', v_creator_id, v_creator_id
  )
  RETURNING id INTO v_doc_id;

  v_protocol := 'PROTO-' || upper(substr(v_doc_id::text, 1, 8));

  IF p_checklist_item_id IS NOT NULL THEN
    UPDATE public.supplier_homologation_checklist_items
    SET
      verification_status = 'received',
      document_id         = v_doc_id,
      verified_at         = now(),
      notes               = 'Documento enviado via Portal do Fornecedor (' || v_protocol || ')'
    WHERE id = p_checklist_item_id
      AND tenant_id = v_rec.tenant_id
      AND homologation_id = v_homolog_id;
  END IF;

  IF v_homolog_id IS NOT NULL THEN
    IF v_homolog_stat IN ('draft', 'awaiting_completion') THEN
      UPDATE public.supplier_homologations
      SET status = 'in_review',
          updated_by = v_creator_id,
          updated_at = now()
      WHERE id = v_homolog_id
        AND tenant_id = v_rec.tenant_id;
    END IF;

    INSERT INTO public.supplier_homologation_events (
      tenant_id, homologation_id, event_type,
      from_status, to_status, description, evidence_url, created_by
    ) VALUES (
      v_rec.tenant_id,
      v_homolog_id,
      'completion_received',
      v_homolog_stat,
      CASE WHEN v_homolog_stat IN ('draft', 'awaiting_completion') THEN 'in_review' ELSE v_homolog_stat END,
      'Documento "' || v_title || '" recebido pelo Portal do Fornecedor (' || v_protocol || ').',
      v_url,
      v_creator_id
    );
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  ) VALUES (
    v_rec.tenant_id,
    NULL,
    'supplier_portal.document_submitted',
    'supplier_documents',
    v_doc_id::text,
    jsonb_build_object(
      'supplier_id', v_rec.supplier_id,
      'homologation_id', v_homolog_id,
      'checklist_item_id', p_checklist_item_id,
      'protocol', v_protocol
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'document_id', v_doc_id,
    'protocol', v_protocol
  );
END;
$function$;

COMMIT;
