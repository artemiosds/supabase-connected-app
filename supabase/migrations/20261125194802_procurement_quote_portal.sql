-- =============================================================================
-- Cotação Eletrônica pelo Portal do Fornecedor (Lei 14.133/2021)
-- Tabela procurement_quote_requests + RLS + RPCs seguras e imutabilidade
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.procurement_quote_requests (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id               uuid        NOT NULL,
  supplier_id              uuid        NOT NULL,
  token                    text        NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status                   text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'imported', 'cancelled')),
  selection_justification  text        NOT NULL
    CHECK (length(btrim(selection_justification)) BETWEEN 10 AND 1000),
  sent_at                  date        NOT NULL DEFAULT CURRENT_DATE,
  response_deadline        date        NOT NULL,
  expires_at               timestamptz NOT NULL DEFAULT (now() + interval '15 days'),
  notes                    text,
  submitted_at             timestamptz,
  submitted_payload        jsonb,
  submission_protocol      text,
  submission_sha256        text,
  imported_at              timestamptz,
  imported_by              uuid        REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_procurement_quote_requests PRIMARY KEY (id),
  CONSTRAINT ux_procurement_quote_requests_tid_id UNIQUE (tenant_id, id),
  CONSTRAINT chk_procurement_quote_requests_deadline CHECK (response_deadline >= sent_at),
  CONSTRAINT fk_quote_req_process_tenant FOREIGN KEY (tenant_id, process_id)
    REFERENCES public.procurement_processes(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_req_supplier_tenant FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES public.suppliers(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_quote_req_tenant_process
  ON public.procurement_quote_requests (tenant_id, process_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_req_supplier
  ON public.procurement_quote_requests (tenant_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_quote_req_pending_token
  ON public.procurement_quote_requests (token)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_quote_req_created_by
  ON public.procurement_quote_requests (created_by);

CREATE INDEX IF NOT EXISTS idx_quote_req_imported_by
  ON public.procurement_quote_requests (imported_by)
  WHERE imported_by IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_procurement_quote_requests_updated_at
  BEFORE UPDATE ON public.procurement_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_procurement_quote_requests_identity
  BEFORE UPDATE ON public.procurement_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_tenant_row_identity();

ALTER TABLE public.procurement_quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_quote_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.procurement_quote_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.procurement_quote_requests TO authenticated;

CREATE POLICY p_commercial_select_procurement_quote_requests
  ON public.procurement_quote_requests
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (
      (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
      AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'processos'))
    )
  );

CREATE POLICY p_procurement_quote_requests_select
  ON public.procurement_quote_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR app_auth.has_tenant_data_permission(tenant_id, 'documents:view')
  );

-- 1. Criar solicitação formal de cotação eletrônica para um fornecedor
CREATE OR REPLACE FUNCTION public.create_procurement_quote_request(
  p_tenant_id               uuid,
  p_process_id              uuid,
  p_supplier_id             uuid,
  p_selection_justification text,
  p_response_deadline       date,
  p_notes                   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor      uuid := (SELECT auth.uid());
  v_proc       record;
  v_sup        record;
  v_just       text := pg_catalog.btrim(COALESCE(p_selection_justification, ''));
  v_notes      text := NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), '');
  v_sent       date := CURRENT_DATE;
  v_expires_at timestamptz;
  v_req_id     uuid;
  v_token      text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar cotações nesta Secretaria.' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.length(v_just) < 10 OR pg_catalog.length(v_just) > 1000 THEN
    RAISE EXCEPTION 'Informe a justificativa da escolha do fornecedor (entre 10 e 1000 caracteres).';
  END IF;

  IF p_response_deadline IS NULL OR p_response_deadline < v_sent THEN
    RAISE EXCEPTION 'O prazo limite de resposta deve ser igual ou posterior à data atual.';
  END IF;

  SELECT p.id, p.number, p.status
  INTO v_proc
  FROM public.procurement_processes p
  WHERE p.tenant_id = p_tenant_id AND p.id = p_process_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processo não encontrado nesta Secretaria.';
  END IF;

  IF v_proc.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Não é possível solicitar cotações para processo encerrado ou cancelado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.procurement_items i
    WHERE i.tenant_id = p_tenant_id AND i.process_id = p_process_id AND i.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cadastre ao menos um item ativo no processo antes de gerar o link de cotação.';
  END IF;

  SELECT s.id, s.legal_name, s.status
  INTO v_sup
  FROM public.suppliers s
  WHERE s.tenant_id = p_tenant_id AND s.id = p_supplier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fornecedor não encontrado nesta Secretaria.';
  END IF;

  IF v_sup.status <> 'active' THEN
    RAISE EXCEPTION 'Apenas fornecedores ativos podem receber solicitações de cotação.';
  END IF;

  -- Cancela solicitação pendente anterior do mesmo fornecedor neste processo
  UPDATE public.procurement_quote_requests
  SET status = 'cancelled', updated_by = v_actor, updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND process_id = p_process_id
    AND supplier_id = p_supplier_id
    AND status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := ((p_response_deadline + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  IF v_expires_at < now() + interval '24 hours' THEN
    v_expires_at := now() + interval '24 hours';
  END IF;

  INSERT INTO public.procurement_quote_requests (
    tenant_id, process_id, supplier_id, token, status,
    selection_justification, sent_at, response_deadline, expires_at, notes,
    created_by, updated_by
  ) VALUES (
    p_tenant_id, p_process_id, p_supplier_id, v_token, 'pending',
    v_just, v_sent, p_response_deadline, v_expires_at, v_notes,
    v_actor, v_actor
  )
  RETURNING id INTO v_req_id;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    p_tenant_id,
    v_actor,
    'procurement.quote_request.created',
    'procurement_quote_requests',
    v_req_id::text,
    jsonb_build_object(
      'process_id', p_process_id,
      'process_number', v_proc.number,
      'supplier_id', p_supplier_id,
      'response_deadline', p_response_deadline
    ),
    now()
  );

  RETURN jsonb_build_object(
    'id', v_req_id,
    'token', v_token,
    'sent_at', v_sent,
    'response_deadline', p_response_deadline,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_procurement_quote_request(uuid, uuid, uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_procurement_quote_request(uuid, uuid, uuid, text, date, text) TO authenticated;

-- 2. Cancelar solicitação pendente
CREATE OR REPLACE FUNCTION public.cancel_procurement_quote_request(
  p_tenant_id  uuid,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar esta solicitação.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.procurement_quote_requests
  SET status = 'cancelled', updated_by = v_actor, updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND id = p_request_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já respondida/encerrada.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_procurement_quote_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_procurement_quote_request(uuid, uuid) TO authenticated;

-- 3. Marcar solicitação submetida como importada para matriz
CREATE OR REPLACE FUNCTION public.mark_procurement_quote_request_imported(
  p_tenant_id  uuid,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_req   public.procurement_quote_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos') THEN
    RAISE EXCEPTION 'Sem permissão para importar esta proposta.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req
  FROM public.procurement_quote_requests
  WHERE tenant_id = p_tenant_id AND id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de cotação não encontrada.';
  END IF;

  IF v_req.status = 'imported' THEN
    RETURN;
  END IF;

  IF v_req.status <> 'submitted' THEN
    RAISE EXCEPTION 'Apenas propostas já enviadas pelo fornecedor podem ser importadas.';
  END IF;

  UPDATE public.procurement_quote_requests
  SET status = 'imported',
      imported_at = now(),
      imported_by = v_actor,
      updated_by = v_actor,
      updated_at = now()
  WHERE id = v_req.id;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    p_tenant_id,
    v_actor,
    'procurement.quote_request.imported',
    'procurement_quote_requests',
    v_req.id::text,
    jsonb_build_object(
      'process_id', v_req.process_id,
      'supplier_id', v_req.supplier_id,
      'protocol', v_req.submission_protocol,
      'sha256', v_req.submission_sha256
    ),
    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_procurement_quote_request_imported(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_procurement_quote_request_imported(uuid, uuid) TO authenticated;

-- 4. Consulta pública via token (Portal do Fornecedor)
CREATE OR REPLACE FUNCTION public.get_procurement_quote_portal_data(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec        record;
  v_items_json jsonb;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(pg_catalog.btrim(p_token)) < 32 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link de cotação inválido.');
  END IF;

  SELECT
    r.id, r.tenant_id, r.process_id, r.supplier_id, r.status,
    r.sent_at, r.response_deadline, r.expires_at, r.notes,
    r.submitted_at, r.submission_protocol, r.submission_sha256, r.submitted_payload,
    t.name AS tenant_name, t.status AS tenant_status,
    p.number AS process_number, p.title AS process_title, p.description AS process_description,
    p.modality AS process_modality, p.status AS process_status,
    s.legal_name, s.trade_name, s.cnpj, s.contact_name, s.contact_email, s.contact_phone,
    s.street, s.street_number, s.complement, s.neighborhood, s.city, s.state, s.postal_code
  INTO v_rec
  FROM public.procurement_quote_requests r
  JOIN public.tenants t ON t.id = r.tenant_id
  JOIN public.procurement_processes p ON p.tenant_id = r.tenant_id AND p.id = r.process_id
  JOIN public.suppliers s ON s.tenant_id = r.tenant_id AND s.id = r.supplier_id
  WHERE r.token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link de cotação inválido ou inexistente.');
  END IF;

  IF v_rec.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta solicitação de cotação foi cancelada pela Secretaria.');
  END IF;

  IF v_rec.status = 'pending' AND v_rec.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'O prazo deste link de cotação expirou.');
  END IF;

  IF v_rec.tenant_status <> 'active'
     OR NOT app_auth.is_tenant_in_good_standing(v_rec.tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(v_rec.tenant_id, 'processos') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitação temporariamente indisponível nesta Secretaria.');
  END IF;

  IF v_rec.process_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'O processo de compra vinculado foi cancelado.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'line_number', i.line_number,
        'description', i.description,
        'technical_specification', i.technical_specification,
        'unit', i.unit,
        'quantity', i.quantity
      )
      ORDER BY i.line_number, i.id
    ),
    '[]'::jsonb
  )
  INTO v_items_json
  FROM public.procurement_items i
  WHERE i.tenant_id = v_rec.tenant_id
    AND i.process_id = v_rec.process_id
    AND i.is_active = true;

  RETURN jsonb_build_object(
    'success', true,
    'request', jsonb_build_object(
      'id', v_rec.id,
      'status', v_rec.status,
      'sent_at', v_rec.sent_at,
      'response_deadline', v_rec.response_deadline,
      'expires_at', v_rec.expires_at,
      'notes', v_rec.notes,
      'submitted_at', v_rec.submitted_at,
      'submission_protocol', v_rec.submission_protocol,
      'submission_sha256', v_rec.submission_sha256,
      'submitted_payload', v_rec.submitted_payload
    ),
    'tenant', jsonb_build_object(
      'id', v_rec.tenant_id,
      'name', v_rec.tenant_name
    ),
    'process', jsonb_build_object(
      'id', v_rec.process_id,
      'number', v_rec.process_number,
      'title', v_rec.process_title,
      'description', v_rec.process_description,
      'modality', v_rec.process_modality
    ),
    'supplier', jsonb_build_object(
      'id', v_rec.supplier_id,
      'legal_name', v_rec.legal_name,
      'trade_name', v_rec.trade_name,
      'cnpj', v_rec.cnpj,
      'contact_name', v_rec.contact_name,
      'contact_email', v_rec.contact_email,
      'contact_phone', v_rec.contact_phone,
      'street', v_rec.street,
      'street_number', v_rec.street_number,
      'complement', v_rec.complement,
      'neighborhood', v_rec.neighborhood,
      'city', v_rec.city,
      'state', v_rec.state,
      'postal_code', v_rec.postal_code
    ),
    'items', v_items_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_procurement_quote_portal_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_procurement_quote_portal_data(text) TO PUBLIC, anon, authenticated;

-- 5. Submissão oficial da cotação pelo fornecedor (uso único e imutável com SHA-256)
CREATE OR REPLACE FUNCTION public.submit_procurement_quote_portal(
  p_token   text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec           public.procurement_quote_requests%ROWTYPE;
  v_proc_status   text;
  v_contact_name  text;
  v_contact_email text;
  v_contact_phone text;
  v_address       text;
  v_delivery_term text;
  v_payment_terms text;
  v_warranty      text;
  v_notes         text;
  v_item_raw      jsonb;
  v_item_id       uuid;
  v_item_row      record;
  v_quoted        boolean;
  v_unit_price    numeric(16,4);
  v_delivery_cost numeric(16,2);
  v_brand_model   text;
  v_norm_items    jsonb := '[]'::jsonb;
  v_quoted_count  integer := 0;
  v_canonical     jsonb;
  v_protocol      text;
  v_sha256        text;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(pg_catalog.btrim(p_token)) < 32 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link de cotação inválido.');
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR pg_catalog.length(p_payload::text) > 65536 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payload da proposta inválido ou acima do limite permitido.');
  END IF;

  SELECT * INTO v_rec
  FROM public.procurement_quote_requests r
  WHERE r.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitação de cotação não encontrada.');
  END IF;

  IF v_rec.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta solicitação foi cancelada pela Secretaria.');
  END IF;

  IF v_rec.status IN ('submitted', 'imported') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Esta cotação já foi protocolada anteriormente (' || COALESCE(v_rec.submission_protocol, 'PROTOCOLADA') || ').'
    );
  END IF;

  IF v_rec.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'O prazo de envio desta cotação expirou.');
  END IF;

  SELECT p.status INTO v_proc_status
  FROM public.procurement_processes p
  WHERE p.tenant_id = v_rec.tenant_id AND p.id = v_rec.process_id;

  IF v_proc_status = 'cancelled'
     OR NOT app_auth.is_tenant_in_good_standing(v_rec.tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(v_rec.tenant_id, 'processos') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Processo encerrado ou Secretaria indisponível para envio.');
  END IF;

  v_contact_name  := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'contact_name', '')), '');
  v_contact_email := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'contact_email', '')), '');
  v_contact_phone := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'contact_phone', '')), '');
  v_address       := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'address', '')), '');
  v_delivery_term := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'delivery_term', '')), '');
  v_payment_terms := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'payment_terms', '')), '');
  v_warranty      := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'warranty_terms', '')), '');
  v_notes         := NULLIF(pg_catalog.btrim(COALESCE(p_payload->>'notes', '')), '');

  IF v_contact_name IS NULL OR v_contact_email IS NULL OR v_contact_phone IS NULL OR v_address IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe responsável, e-mail, telefone e endereço completos da empresa.');
  END IF;

  IF v_delivery_term IS NULL OR v_payment_terms IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe prazo de entrega e condições de pagamento.');
  END IF;

  IF jsonb_typeof(p_payload->'items') <> 'array' OR jsonb_array_length(p_payload->'items') = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe os itens cotados da proposta.');
  END IF;

  FOR v_item_raw IN SELECT value FROM jsonb_array_elements(p_payload->'items')
  LOOP
    BEGIN
      v_item_id := (v_item_raw->>'item_id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('success', false, 'error', 'Identificador de item inválido na proposta.');
    END;

    SELECT i.id, i.line_number, i.description, i.unit, i.quantity
    INTO v_item_row
    FROM public.procurement_items i
    WHERE i.tenant_id = v_rec.tenant_id
      AND i.process_id = v_rec.process_id
      AND i.id = v_item_id
      AND i.is_active = true;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'A proposta contém item inexistente ou inativo neste processo.');
    END IF;

    v_quoted := COALESCE((v_item_raw->>'quoted')::boolean, false);
    v_brand_model := NULLIF(pg_catalog.btrim(COALESCE(v_item_raw->>'brand_model', '')), '');

    IF v_quoted THEN
      BEGIN
        v_unit_price := (v_item_raw->>'unit_price')::numeric(16,4);
        v_delivery_cost := COALESCE((v_item_raw->>'delivery_cost')::numeric(16,2), 0);
      EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valor numérico inválido para o item ' || v_item_row.line_number || '.');
      END;

      IF v_unit_price IS NULL OR v_unit_price <= 0 OR v_delivery_cost < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Preço unitário deve ser maior que zero e frete não pode ser negativo (item ' || v_item_row.line_number || ').');
      END IF;

      v_quoted_count := v_quoted_count + 1;
      v_norm_items := v_norm_items || jsonb_build_object(
        'item_id', v_item_row.id,
        'line_number', v_item_row.line_number,
        'description', v_item_row.description,
        'unit', v_item_row.unit,
        'quantity', v_item_row.quantity,
        'quoted', true,
        'unit_price', v_unit_price,
        'delivery_cost', v_delivery_cost,
        'total_price', pg_catalog.round((v_item_row.quantity * v_unit_price) + v_delivery_cost, 2),
        'brand_model', v_brand_model
      );
    ELSE
      v_norm_items := v_norm_items || jsonb_build_object(
        'item_id', v_item_row.id,
        'line_number', v_item_row.line_number,
        'description', v_item_row.description,
        'unit', v_item_row.unit,
        'quantity', v_item_row.quantity,
        'quoted', false,
        'unit_price', null,
        'delivery_cost', 0,
        'total_price', 0,
        'brand_model', null
      );
    END IF;
  END LOOP;

  IF v_quoted_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cote ao menos um item com preço unitário válido antes de protocolar.');
  END IF;

  v_canonical := jsonb_build_object(
    'request_id', v_rec.id,
    'process_id', v_rec.process_id,
    'supplier_id', v_rec.supplier_id,
    'contact_name', v_contact_name,
    'contact_email', v_contact_email,
    'contact_phone', v_contact_phone,
    'address', v_address,
    'delivery_term', v_delivery_term,
    'payment_terms', v_payment_terms,
    'warranty_terms', v_warranty,
    'notes', v_notes,
    'items', v_norm_items
  );

  v_protocol := 'COT-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(v_rec.id::text, '-', ''), 1, 8));
  v_sha256 := encode(
    extensions.digest(pg_catalog.convert_to(v_canonical::text, 'UTF8'), 'sha256'),
    'hex'
  );

  UPDATE public.procurement_quote_requests
  SET status = 'submitted',
      submitted_at = now(),
      submitted_payload = v_canonical,
      submission_protocol = v_protocol,
      submission_sha256 = v_sha256,
      updated_at = now()
  WHERE id = v_rec.id;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    v_rec.tenant_id,
    NULL,
    'procurement.quote_request.submitted',
    'procurement_quote_requests',
    v_rec.id::text,
    jsonb_build_object(
      'process_id', v_rec.process_id,
      'supplier_id', v_rec.supplier_id,
      'protocol', v_protocol,
      'sha256', v_sha256,
      'quoted_items', v_quoted_count
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'protocol', v_protocol,
    'sha256', v_sha256,
    'submitted_at', now(),
    'quoted_items', v_quoted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_procurement_quote_portal(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_procurement_quote_portal(text, jsonb) TO PUBLIC, anon, authenticated;
