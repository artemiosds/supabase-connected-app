-- =============================================================================
-- ENTREGA 7: Portal Externo do Fornecedor / Autoatendimento e Envio
-- Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores
-- Migration: 20261124110000_supplier_portal.sql
-- =============================================================================

-- 1. TABELA: supplier_portal_tokens
CREATE TABLE IF NOT EXISTS public.supplier_portal_tokens (
    id               uuid                     NOT NULL DEFAULT gen_random_uuid(),
    tenant_id        uuid                     NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id      uuid                     NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    homologation_id  uuid                     REFERENCES public.supplier_homologations(id) ON DELETE SET NULL,

    token            text                     NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires_at       timestamptz              NOT NULL DEFAULT (now() + interval '30 days'),
    is_revoked       boolean                  NOT NULL DEFAULT false,

    created_by       uuid                     NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at       timestamptz              NOT NULL DEFAULT now(),
    updated_at       timestamptz              NOT NULL DEFAULT now(),

    CONSTRAINT pk_supplier_portal_tokens        PRIMARY KEY (id),
    CONSTRAINT ux_supplier_portal_tokens_tid_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_portal_tokens_token
    ON public.supplier_portal_tokens (token)
    WHERE is_revoked = false;

CREATE INDEX IF NOT EXISTS idx_supplier_portal_tokens_supplier
    ON public.supplier_portal_tokens (tenant_id, supplier_id);

-- 2. Trigger updated_at
CREATE OR REPLACE TRIGGER trg_supplier_portal_tokens_updated_at
  BEFORE UPDATE ON public.supplier_portal_tokens
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 3. Habilitar e Forçar RLS
ALTER TABLE public.supplier_portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_portal_tokens FORCE ROW LEVEL SECURITY;

-- 4. Políticas restritivas comerciais
CREATE POLICY p_commercial_select_supplier_portal_tokens ON public.supplier_portal_tokens
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores'))));

CREATE POLICY p_commercial_insert_supplier_portal_tokens ON public.supplier_portal_tokens
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

CREATE POLICY p_commercial_update_supplier_portal_tokens ON public.supplier_portal_tokens
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')))
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

-- 5. Políticas permissivas para equipe da Secretaria
CREATE POLICY p_supplier_portal_tokens_select ON public.supplier_portal_tokens
  FOR SELECT TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:view'));

CREATE POLICY p_supplier_portal_tokens_insert ON public.supplier_portal_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    app_auth.has_supplier_permission(tenant_id, 'suppliers:update')
    AND created_by = (SELECT auth.uid())
  );

CREATE POLICY p_supplier_portal_tokens_update ON public.supplier_portal_tokens
  FOR UPDATE TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
  WITH CHECK (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'));

-- 6. RPC: generate_supplier_portal_token
CREATE OR REPLACE FUNCTION public.generate_supplier_portal_token(
    p_tenant_id        uuid,
    p_supplier_id      uuid,
    p_homologation_id  uuid     DEFAULT NULL,
    p_days_valid       integer  DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id   uuid;
    v_token     text;
    v_expires   timestamptz;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF NOT app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update') THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente para gerar link de autoatendimento.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = p_supplier_id AND s.tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Fornecedor não encontrado nesta Secretaria.';
    END IF;

    -- Revogar tokens anteriores não expirados deste fornecedor se houver
    UPDATE public.supplier_portal_tokens
    SET is_revoked = true, updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND supplier_id = p_supplier_id
      AND is_revoked = false;

    v_token   := encode(gen_random_bytes(32), 'hex');
    v_expires := now() + (COALESCE(p_days_valid, 30) || ' days')::interval;

    INSERT INTO public.supplier_portal_tokens (
        tenant_id, supplier_id, homologation_id,
        token, expires_at, created_by
    ) VALUES (
        p_tenant_id, p_supplier_id, p_homologation_id,
        v_token, v_expires, v_user_id
    );

    RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_supplier_portal_token(uuid, uuid, uuid, integer) TO authenticated;

-- 7. RPC: get_supplier_portal_data (público via token seguro)
CREATE OR REPLACE FUNCTION public.get_supplier_portal_data(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rec            record;
    v_supplier_json  jsonb;
    v_tenant_json    jsonb;
    v_homolog_json   jsonb;
    v_checklist_json jsonb;
    v_docs_json      jsonb;
BEGIN
    -- Validar token
    SELECT
        spt.id, spt.tenant_id, spt.supplier_id, spt.homologation_id,
        spt.expires_at, spt.is_revoked,
        s.legal_name, s.trade_name, s.cnpj, s.category, s.status AS supplier_status,
        t.name AS tenant_name
    INTO v_rec
    FROM public.supplier_portal_tokens spt
    JOIN public.suppliers s ON s.id = spt.supplier_id
    JOIN public.tenants   t ON t.id = spt.tenant_id
    WHERE spt.token = p_token;

    IF v_rec IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Token inválido ou inexistente.');
    END IF;

    IF v_rec.is_revoked THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este link de acesso foi revogado pela Secretaria.');
    END IF;

    IF v_rec.expires_at < now() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este link de acesso expirou. Solicite um novo à Secretaria.');
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

    -- Buscar última homologação vinculada ou ativa
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

    -- Buscar itens do checklist pendentes/em análise
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
        WHERE ci.homologation_id = (v_homolog_json->>'id')::uuid;
    ELSE
        v_checklist_json := '[]'::jsonb;
    END IF;

    -- Buscar documentos já enviados pelo fornecedor
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
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_portal_data(text) TO anon, authenticated;

-- 8. RPC: submit_supplier_portal_document
CREATE OR REPLACE FUNCTION public.submit_supplier_portal_document(
    p_token              text,
    p_checklist_item_id  uuid     DEFAULT NULL,
    p_title              text     DEFAULT NULL,
    p_document_type      text     DEFAULT 'outros',
    p_file_name          text     DEFAULT NULL,
    p_storage_path       text     DEFAULT NULL,
    p_external_url       text     DEFAULT NULL,
    p_expires_at         date     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rec          record;
    v_doc_id       uuid;
    v_homolog_id   uuid;
    v_creator_id   uuid;
    v_title        text;
BEGIN
    -- Validar token
    SELECT spt.id, spt.tenant_id, spt.supplier_id, spt.homologation_id,
           spt.expires_at, spt.is_revoked, spt.created_by
    INTO v_rec
    FROM public.supplier_portal_tokens spt
    WHERE spt.token = p_token;

    IF v_rec IS NULL OR v_rec.is_revoked OR v_rec.expires_at < now() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Token de acesso inválido ou expirado.');
    END IF;

    v_creator_id := v_rec.created_by;
    v_homolog_id := v_rec.homologation_id;
    v_title      := COALESCE(p_title, p_file_name, 'Documento enviado pelo fornecedor');

    -- 1. Inserir na tabela de documentos
    INSERT INTO public.supplier_documents (
        tenant_id, supplier_id, title, document_type,
        file_name, storage_path, external_url, expires_at,
        status, created_by
    ) VALUES (
        v_rec.tenant_id, v_rec.supplier_id, v_title, p_document_type,
        p_file_name, p_storage_path, p_external_url, p_expires_at,
        'active', v_creator_id
    )
    RETURNING id INTO v_doc_id;

    -- 2. Se houver item de checklist, vincular e atualizar status
    IF p_checklist_item_id IS NOT NULL THEN
        UPDATE public.supplier_homologation_checklist_items
        SET
            verification_status = 'received',
            document_id         = v_doc_id,
            verified_at         = now(),
            notes               = 'Documento enviado via Portal do Fornecedor'
        WHERE id = p_checklist_item_id
          AND homologation_id = v_homolog_id;
    END IF;

    -- 3. Registrar evento de auditoria se houver homologação
    IF v_homolog_id IS NOT NULL THEN
        INSERT INTO public.supplier_homologation_events (
            tenant_id, homologation_id, event_type,
            to_status, notes, actor_id
        ) VALUES (
            v_rec.tenant_id, v_homolog_id, 'document_received',
            'in_review',
            'Documento "' || v_title || '" anexado pelo fornecedor via autoatendimento',
            v_creator_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'document_id', v_doc_id,
        'protocol', 'PROTO-' || upper(substr(v_doc_id::text, 1, 8))
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_supplier_portal_document(text, uuid, text, text, text, text, text, date) TO anon, authenticated;

-- 9. Registrar migration
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20261124110000', ARRAY['-- 20261124110000_supplier_portal'], 'supplier_portal')
ON CONFLICT (version) DO NOTHING;
