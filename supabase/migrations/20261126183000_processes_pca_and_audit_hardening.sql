-- Hardening do PCA (Decreto nº 10.947/2022 e Lei nº 14.133/2021 art. 12, VII),
-- Pesquisa de Preços (IN SEGES nº 65/2021) e Rastreabilidade.

-- 1) Campos obrigatórios do DFD/PCA e fluxo completo de revisão/devolução/cancelamento
ALTER TABLE public.annual_procurement_demands
  ADD COLUMN IF NOT EXISTS requesting_unit text,
  ADD COLUMN IF NOT EXISTS responsible_name text,
  ADD COLUMN IF NOT EXISTS estimated_total_value numeric(16,2),
  ADD COLUMN IF NOT EXISTS desired_date date,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'bens',
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.annual_procurement_demands
  DROP CONSTRAINT IF EXISTS annual_procurement_demands_estimated_total_check,
  DROP CONSTRAINT IF EXISTS annual_procurement_demands_priority_check,
  DROP CONSTRAINT IF EXISTS annual_procurement_demands_category_check,
  DROP CONSTRAINT IF EXISTS annual_procurement_demands_review_status_check;

ALTER TABLE public.annual_procurement_demands
  ADD CONSTRAINT annual_procurement_demands_estimated_total_check
    CHECK (estimated_total_value IS NULL OR estimated_total_value >= 0),
  ADD CONSTRAINT annual_procurement_demands_priority_check
    CHECK (priority = ANY (ARRAY['urgente'::text, 'alta'::text, 'normal'::text, 'baixa'::text])),
  ADD CONSTRAINT annual_procurement_demands_category_check
    CHECK (category = ANY (ARRAY['bens'::text, 'servicos'::text, 'obras'::text, 'tic'::text, 'outro'::text])),
  ADD CONSTRAINT annual_procurement_demands_review_status_check
    CHECK (review_status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'converted'::text]));

UPDATE public.annual_procurement_demands
SET review_status = CASE
  WHEN process_id IS NOT NULL THEN 'converted'
  WHEN approved_at IS NOT NULL THEN 'approved'
  ELSE 'submitted'
END
WHERE review_status = 'submitted'
  AND (process_id IS NOT NULL OR approved_at IS NOT NULL);

-- Alinhar policy de leitura e capacidades do PCA ao módulo 'pca'
DROP POLICY IF EXISTS annual_demands_read ON public.annual_procurement_demands;
CREATE POLICY annual_demands_read
  ON public.annual_procurement_demands
  FOR SELECT
  TO authenticated
  USING (
    app_auth.has_tenant_data_permission(tenant_id, 'documents:view')
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id, 'pca')
  );

CREATE OR REPLACE FUNCTION public.annual_demand_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean, can_create boolean, can_approve boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    app_auth.has_tenant_data_permission(p_tenant_id, 'documents:view')
      AND app_auth.is_tenant_in_good_standing(p_tenant_id)
      AND app_auth.is_tenant_module_enabled(p_tenant_id, 'pca'),
    app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
      AND app_auth.is_tenant_in_good_standing(p_tenant_id)
      AND app_auth.is_tenant_module_enabled(p_tenant_id, 'pca'),
    (
      app_auth.has_tenant_data_permission(p_tenant_id, 'documents:approve')
      OR app_auth.has_tenant_data_permission(p_tenant_id, 'procurement:approve_price')
    )
      AND app_auth.is_tenant_in_good_standing(p_tenant_id)
      AND app_auth.is_tenant_module_enabled(p_tenant_id, 'pca');
$function$;

REVOKE ALL ON FUNCTION public.annual_demand_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annual_demand_capabilities(uuid) TO authenticated;

-- Workflow completo de demandas do PCA com idempotência e metadados do Decreto 10.947/2022
CREATE OR REPLACE FUNCTION public.manage_annual_demand(
  p_tenant_id uuid,
  p_id uuid,
  p_action text,
  p_data jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := (SELECT auth.uid());
  demand public.annual_procurement_demands;
  process uuid;
  item jsonb;
  qty numeric;
  unit_price numeric;
  v_estimated_total numeric := 0;
  v_has_unit_prices boolean := false;
  v_explicit_total numeric;
  v_priority text;
  v_category text;
  v_requesting_unit text;
  v_responsible_name text;
  v_desired_date date;
  v_clean_items jsonb := '[]'::jsonb;
  v_reason text;
  v_existing_tenant uuid;
BEGIN
  IF actor IS NULL
     OR p_id IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('submit', 'update', 'approve', 'reject', 'cancel', 'convert')
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:view')
     OR NOT (
       CASE
         WHEN p_action IN ('approve', 'reject') THEN
           app_auth.has_tenant_data_permission(p_tenant_id, 'documents:approve')
           OR app_auth.has_tenant_data_permission(p_tenant_id, 'procurement:approve_price')
         WHEN p_action IN ('update', 'cancel') THEN
           app_auth.has_tenant_data_permission(p_tenant_id, 'documents:update')
           OR app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
         ELSE
           app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
       END
     )
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'pca')
     OR (p_action = 'convert' AND NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos'))
     OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND status = 'active')
  THEN
    RAISE EXCEPTION 'Operação indisponível ou sem permissão nesta Secretaria.' USING ERRCODE = '42501';
  END IF;

  IF p_action IN ('submit', 'update') THEN
    IF p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) <> 'object' THEN
      RAISE EXCEPTION 'Dados da demanda inválidos.';
    END IF;
    IF pg_catalog.jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_data->'items') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Informe de 1 a 200 itens.';
    END IF;

    IF p_action = 'submit' THEN
      SELECT d.tenant_id INTO v_existing_tenant
      FROM public.annual_procurement_demands d
      WHERE d.id = p_id;
      IF FOUND THEN
        IF v_existing_tenant = p_tenant_id THEN
          RETURN p_id;
        ELSE
          RAISE EXCEPTION 'Identificador de demanda indisponível.' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;

    v_priority := COALESCE(NULLIF(pg_catalog.btrim(p_data->>'priority'), ''), 'normal');
    IF v_priority NOT IN ('urgente', 'alta', 'normal', 'baixa') THEN
      RAISE EXCEPTION 'Grau de prioridade inválido.';
    END IF;

    v_category := COALESCE(NULLIF(pg_catalog.btrim(p_data->>'category'), ''), 'bens');
    IF v_category NOT IN ('bens', 'servicos', 'obras', 'tic', 'outro') THEN
      RAISE EXCEPTION 'Categoria do objeto inválida.';
    END IF;

    v_requesting_unit := NULLIF(pg_catalog.btrim(p_data->>'requesting_unit'), '');
    v_responsible_name := NULLIF(pg_catalog.btrim(p_data->>'responsible_name'), '');
    v_desired_date := NULLIF(pg_catalog.btrim(p_data->>'desired_date'), '')::date;

    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_data->'items') LOOP
      qty := (item->>'quantity')::numeric;
      IF pg_catalog.jsonb_typeof(item->'description') IS DISTINCT FROM 'string'
         OR pg_catalog.length(pg_catalog.btrim(item->>'description')) NOT BETWEEN 3 AND 500
         OR pg_catalog.jsonb_typeof(item->'unit') IS DISTINCT FROM 'string'
         OR pg_catalog.length(pg_catalog.btrim(item->>'unit')) NOT BETWEEN 1 AND 30
         OR pg_catalog.jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
         OR qty <= 0 OR qty >= 10000000000 OR qty <> pg_catalog.round(qty, 4)
      THEN
        RAISE EXCEPTION 'Confira descrição, unidade e quantidade dos itens.';
      END IF;

      unit_price := CASE
        WHEN item ? 'estimated_unit_price'
             AND item->>'estimated_unit_price' IS NOT NULL
             AND pg_catalog.btrim(item->>'estimated_unit_price') <> ''
          THEN (item->>'estimated_unit_price')::numeric
        ELSE NULL
      END;
      IF unit_price IS NOT NULL THEN
        IF unit_price < 0 OR unit_price >= 10000000000 THEN
          RAISE EXCEPTION 'Valor unitário estimado inválido.';
        END IF;
        v_has_unit_prices := true;
        v_estimated_total := v_estimated_total + pg_catalog.round(qty * unit_price, 2);
      END IF;

      v_clean_items := v_clean_items || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'description', pg_catalog.btrim(item->>'description'),
            'unit', pg_catalog.btrim(item->>'unit'),
            'quantity', qty,
            'estimated_unit_price', unit_price,
            'catmat_code', NULLIF(pg_catalog.btrim(item->>'catmat_code'), '')
          )
        )
      );
    END LOOP;

    v_explicit_total := CASE
      WHEN p_data ? 'estimated_total_value'
           AND p_data->>'estimated_total_value' IS NOT NULL
           AND pg_catalog.btrim(p_data->>'estimated_total_value') <> ''
        THEN (p_data->>'estimated_total_value')::numeric
      WHEN v_has_unit_prices THEN pg_catalog.round(v_estimated_total, 2)
      ELSE NULL
    END;
    IF v_explicit_total IS NOT NULL AND v_explicit_total < 0 THEN
      RAISE EXCEPTION 'Valor estimado da demanda não pode ser negativo.';
    END IF;

    IF p_action = 'submit' THEN
      INSERT INTO public.annual_procurement_demands(
        id, tenant_id, plan_year, title, justification, items, submitted_by,
        requesting_unit, responsible_name, estimated_total_value, desired_date,
        priority, category, review_status
      )
      VALUES(
        p_id, p_tenant_id, (p_data->>'year')::integer, pg_catalog.btrim(p_data->>'title'),
        pg_catalog.btrim(p_data->>'justification'), v_clean_items, actor,
        v_requesting_unit, v_responsible_name, v_explicit_total, v_desired_date,
        v_priority, v_category, 'submitted'
      );

      INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
      VALUES(
        p_tenant_id, actor, 'annual_demand.submitted', 'annual_procurement_demands', p_id::text,
        pg_catalog.jsonb_build_object('plan_year', (p_data->>'year')::integer, 'title', pg_catalog.btrim(p_data->>'title')),
        pg_catalog.now()
      );
      RETURN p_id;
    ELSE
      SELECT * INTO STRICT demand
      FROM public.annual_procurement_demands
      WHERE tenant_id = p_tenant_id AND id = p_id
      FOR UPDATE;

      IF demand.process_id IS NOT NULL OR demand.approved_at IS NOT NULL OR demand.review_status IN ('converted', 'cancelled') THEN
        RAISE EXCEPTION 'Somente demandas em análise ou devolvidas para ajuste podem ser editadas.';
      END IF;

      UPDATE public.annual_procurement_demands
      SET plan_year = (p_data->>'year')::integer,
          title = pg_catalog.btrim(p_data->>'title'),
          justification = pg_catalog.btrim(p_data->>'justification'),
          items = v_clean_items,
          requesting_unit = v_requesting_unit,
          responsible_name = v_responsible_name,
          estimated_total_value = v_explicit_total,
          desired_date = v_desired_date,
          priority = v_priority,
          category = v_category,
          review_status = 'submitted',
          rejection_reason = NULL
      WHERE tenant_id = p_tenant_id AND id = p_id;

      INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
      VALUES(
        p_tenant_id, actor, 'annual_demand.updated', 'annual_procurement_demands', p_id::text,
        pg_catalog.jsonb_build_object('plan_year', (p_data->>'year')::integer, 'title', pg_catalog.btrim(p_data->>'title')),
        pg_catalog.now()
      );
      RETURN p_id;
    END IF;
  END IF;

  SELECT * INTO STRICT demand
  FROM public.annual_procurement_demands
  WHERE tenant_id = p_tenant_id AND id = p_id
  FOR UPDATE;

  IF p_action = 'approve' THEN
    IF demand.review_status = 'cancelled' THEN
      RAISE EXCEPTION 'Demanda cancelada não pode ser aprovada.';
    END IF;
    UPDATE public.annual_procurement_demands
    SET approved_at = COALESCE(approved_at, pg_catalog.now()),
        approved_by = COALESCE(approved_by, actor),
        review_status = CASE WHEN process_id IS NOT NULL THEN 'converted' ELSE 'approved' END,
        reviewed_by = actor,
        reviewed_at = pg_catalog.now(),
        rejection_reason = NULL
    WHERE id = p_id AND tenant_id = p_tenant_id;

    INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
    VALUES(
      p_tenant_id, actor, 'annual_demand.approved', 'annual_procurement_demands', p_id::text,
      pg_catalog.jsonb_build_object('plan_year', demand.plan_year, 'title', demand.title),
      pg_catalog.now()
    );
    RETURN p_id;
  END IF;

  IF p_action = 'reject' THEN
    IF demand.process_id IS NOT NULL OR demand.review_status = 'cancelled' THEN
      RAISE EXCEPTION 'Não é possível devolver uma demanda já convertida ou cancelada.';
    END IF;
    v_reason := NULLIF(pg_catalog.btrim(COALESCE(p_data->>'reason', '')), '');
    IF v_reason IS NULL OR pg_catalog.length(v_reason) < 10 THEN
      RAISE EXCEPTION 'Informe o motivo da devolução para ajuste (mínimo de 10 caracteres).';
    END IF;
    UPDATE public.annual_procurement_demands
    SET approved_at = NULL,
        approved_by = NULL,
        review_status = 'rejected',
        rejection_reason = v_reason,
        reviewed_by = actor,
        reviewed_at = pg_catalog.now()
    WHERE id = p_id AND tenant_id = p_tenant_id;

    INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
    VALUES(
      p_tenant_id, actor, 'annual_demand.rejected', 'annual_procurement_demands', p_id::text,
      pg_catalog.jsonb_build_object('reason', v_reason),
      pg_catalog.now()
    );
    RETURN p_id;
  END IF;

  IF p_action = 'cancel' THEN
    IF demand.process_id IS NOT NULL THEN
      RAISE EXCEPTION 'Demanda já convertida em processo não pode ser cancelada.';
    END IF;
    UPDATE public.annual_procurement_demands
    SET approved_at = NULL,
        approved_by = NULL,
        review_status = 'cancelled',
        reviewed_by = actor,
        reviewed_at = pg_catalog.now()
    WHERE id = p_id AND tenant_id = p_tenant_id;

    INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
    VALUES(
      p_tenant_id, actor, 'annual_demand.cancelled', 'annual_procurement_demands', p_id::text,
      pg_catalog.jsonb_build_object('plan_year', demand.plan_year, 'title', demand.title),
      pg_catalog.now()
    );
    RETURN p_id;
  END IF;

  -- convert
  IF demand.process_id IS NOT NULL THEN
    RETURN demand.process_id;
  END IF;
  IF demand.approved_at IS NULL OR demand.review_status <> 'approved' THEN
    RAISE EXCEPTION 'Aprove a demanda antes de criar o processo.';
  END IF;

  process := public.create_procurement_process_with_checklist(
    p_tenant_id,
    pg_catalog.btrim(p_data->>'number'),
    demand.title,
    demand.justification,
    COALESCE(NULLIF(pg_catalog.btrim(p_data->>'modality'), ''), 'pregao'),
    demand.priority,
    demand.requesting_unit,
    demand.responsible_name,
    demand.estimated_total_value,
    demand.desired_date
  );

  INSERT INTO public.procurement_items(
    tenant_id, process_id, line_number, description, unit, quantity,
    estimated_unit_price, estimated_price_source, created_by, updated_by
  )
  SELECT
    p_tenant_id,
    process,
    ordinality,
    pg_catalog.btrim(value->>'description'),
    pg_catalog.btrim(value->>'unit'),
    (value->>'quantity')::numeric,
    CASE
      WHEN value ? 'estimated_unit_price' AND (value->>'estimated_unit_price') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (value->>'estimated_unit_price')::numeric
      ELSE NULL
    END,
    'manual',
    actor,
    actor
  FROM pg_catalog.jsonb_array_elements(demand.items) WITH ORDINALITY;

  UPDATE public.process_items
  SET is_done = true,
      updated_by = actor
  WHERE tenant_id = p_tenant_id
    AND process_id = process
    AND title = 'Previsão no PCA';

  UPDATE public.annual_procurement_demands
  SET process_id = process,
      review_status = 'converted'
  WHERE id = p_id AND tenant_id = p_tenant_id;

  INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES(
    p_tenant_id, actor, 'annual_demand.converted', 'annual_procurement_demands', p_id::text,
    pg_catalog.jsonb_build_object('process_id', process, 'process_number', pg_catalog.btrim(p_data->>'number')),
    pg_catalog.now()
  );

  RETURN process;
END;
$function$;

-- 2) Contar fontes distintas na aprovação de preço (art. 6º, § 5º IN SEGES 65/2021)
-- e impedir cotação com data futura em fn_guard_procurement_quote_source_metadata
CREATE OR REPLACE FUNCTION public.fn_guard_procurement_quote_source_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.quoted_at > CURRENT_DATE THEN
    RAISE EXCEPTION 'A data da cotação não pode ser futura.';
  END IF;

  IF TG_OP='UPDATE' AND ROW(
      NEW.source_type,NEW.reference_identifier,NEW.accessed_at,NEW.source_tax_id,
      NEW.source_contact_name,NEW.source_contact_email,NEW.source_contact_phone,NEW.source_address,
      NEW.supplier_selection_justification,NEW.supplier_consultation_sent_at,
      NEW.evidence_storage_path,NEW.evidence_file_name,NEW.evidence_mime_type,NEW.evidence_file_size,
      NEW.supplier_consultation_response_deadline
    ) IS NOT DISTINCT FROM ROW(
      OLD.source_type,OLD.reference_identifier,OLD.accessed_at,OLD.source_tax_id,
      OLD.source_contact_name,OLD.source_contact_email,OLD.source_contact_phone,OLD.source_address,
      OLD.supplier_selection_justification,OLD.supplier_consultation_sent_at,
      OLD.evidence_storage_path,OLD.evidence_file_name,OLD.evidence_mime_type,OLD.evidence_file_size,
      OLD.supplier_consultation_response_deadline
    ) THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type IN ('painel_precos','contratacoes_publicas','midia_especializada','site_especializado','banco_precos_saude')
    AND NEW.accessed_at IS NULL THEN
    RAISE EXCEPTION 'Registre a data e hora de acesso da fonte consultada.';
  END IF;

  IF NEW.source_type='fornecedor' AND pg_catalog.length(pg_catalog.btrim(COALESCE(NEW.supplier_selection_justification,'')))<10 THEN
    RAISE EXCEPTION 'A cotação direta exige justificativa da escolha do fornecedor (mínimo de 10 caracteres).';
  END IF;
  IF NEW.source_type='fornecedor' AND (
    NEW.supplier_consultation_sent_at IS NULL
    OR NEW.supplier_consultation_response_deadline IS NULL
    OR NEW.supplier_consultation_response_deadline<NEW.supplier_consultation_sent_at
  ) THEN
    RAISE EXCEPTION 'A cotação direta exige data de envio da solicitação e prazo de resposta compatível.';
  END IF;
  IF NEW.source_type='fornecedor' AND (
    NULLIF(pg_catalog.btrim(NEW.source_tax_id),'') IS NULL
    OR NULLIF(pg_catalog.btrim(NEW.source_contact_name),'') IS NULL
    OR NULLIF(pg_catalog.btrim(NEW.source_contact_email),'') IS NULL
    OR NULLIF(pg_catalog.btrim(NEW.source_contact_phone),'') IS NULL
    OR NULLIF(pg_catalog.btrim(NEW.source_address),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'A proposta formal exige CPF/CNPJ, responsável, e-mail, telefone e endereço do fornecedor.';
  END IF;

  IF NEW.evidence_storage_path IS NOT NULL AND (
    split_part(NEW.evidence_storage_path,'/',1) IS DISTINCT FROM NEW.tenant_id::text
    OR split_part(NEW.evidence_storage_path,'/',2) IS DISTINCT FROM 'procurement-quotes'
    OR split_part(NEW.evidence_storage_path,'/',3) IS DISTINCT FROM NEW.procurement_item_id::text
    OR split_part(NEW.evidence_storage_path,'/',4) IS DISTINCT FROM NEW.id::text
    OR NEW.evidence_storage_path !~* '[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
  ) THEN
    RAISE EXCEPTION 'O comprovante precisa estar vinculado à Secretaria, ao item e à cotação corretos.';
  END IF;

  IF NEW.source_type='nota_fiscal_eletronica'
    AND (NULLIF(pg_catalog.btrim(NEW.reference_identifier),'') IS NULL OR NEW.accessed_at IS NULL) THEN
    RAISE EXCEPTION 'Informe a identificação da nota fiscal e a data/hora da consulta.';
  END IF;

  IF NEW.source_type='outro' AND NULLIF(pg_catalog.btrim(NEW.reference_identifier),'') IS NULL
    AND NULLIF(pg_catalog.btrim(NEW.reference_url),'') IS NULL AND NULLIF(pg_catalog.btrim(NEW.notes),'') IS NULL THEN
    RAISE EXCEPTION 'Identifique a fonte ou registre observação que permita rastrear a consulta.';
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Contar fontes distintas (fornecedor/CNPJ/nome da fonte) na aprovação de preço (art. 6º, § 5º da IN SEGES nº 65/2021)
CREATE OR REPLACE FUNCTION public.approve_procurement_item_price(
  p_tenant_id uuid,
  p_item_id uuid,
  p_method text,
  p_method_justification text,
  p_exceptional_justification text DEFAULT NULL::text,
  p_other_unit_price numeric DEFAULT NULL::numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_item public.procurement_items%ROWTYPE;
  v_count integer;
  v_distinct_sources integer;
  v_average numeric(16,4);
  v_median numeric(16,4);
  v_lowest numeric(16,4);
  v_stddev numeric;
  v_cv numeric;
  v_price numeric(16,4);
  v_total numeric(16,2);
  v_values jsonb;
  v_sources jsonb;
  v_calc jsonb;
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
       app_auth.has_tenant_data_permission(p_tenant_id, 'procurement:approve_price')
       OR app_auth.has_tenant_data_permission(p_tenant_id, 'documents:approve')
     )
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar o preço estimado nesta Secretaria.' USING ERRCODE = '42501';
  END IF;

  IF p_method NOT IN ('media', 'mediana', 'menor', 'outro') THEN
    RAISE EXCEPTION 'Método estatístico inválido.';
  END IF;
  IF p_method_justification IS NULL OR pg_catalog.length(pg_catalog.btrim(p_method_justification)) < 10 THEN
    RAISE EXCEPTION 'Justifique a escolha do método estatístico (mínimo de 10 caracteres).';
  END IF;
  IF p_method = 'outro' AND (p_other_unit_price IS NULL OR p_other_unit_price < 0 OR pg_catalog.length(pg_catalog.btrim(p_method_justification)) < 20) THEN
    RAISE EXCEPTION 'O método alternativo exige preço válido e justificativa detalhada (mínimo de 20 caracteres).';
  END IF;

  SELECT * INTO v_item
  FROM public.procurement_items i
  WHERE i.tenant_id = p_tenant_id AND i.id = p_item_id AND i.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item da pesquisa não encontrado ou inativo.';
  END IF;

  SELECT
    count(*)::integer,
    count(DISTINCT COALESCE(
      q.supplier_id::text,
      NULLIF(pg_catalog.btrim(q.source_tax_id), ''),
      NULLIF(pg_catalog.btrim(q.source_name), ''),
      q.id::text
    ))::integer,
    avg(q.total_price / NULLIF(q.quantity, 0))::numeric(16,4),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY q.total_price / NULLIF(q.quantity, 0))::numeric(16,4),
    min(q.total_price / NULLIF(q.quantity, 0))::numeric(16,4),
    stddev_samp(q.total_price / NULLIF(q.quantity, 0)),
    jsonb_agg(q.total_price / NULLIF(q.quantity, 0) ORDER BY q.total_price / NULLIF(q.quantity, 0))
  INTO v_count, v_distinct_sources, v_average, v_median, v_lowest, v_stddev, v_values
  FROM public.procurement_price_quotes q
  WHERE q.tenant_id = p_tenant_id
    AND q.procurement_item_id = p_item_id
    AND q.is_active = true
    AND q.quantity > 0
    AND q.total_price IS NOT NULL;

  IF EXISTS (
    SELECT 1 FROM public.procurement_price_quotes q
    WHERE q.tenant_id = p_tenant_id AND q.procurement_item_id = p_item_id
      AND q.is_active = true AND q.source_type = 'fornecedor'
      AND (
        q.evidence_storage_path IS NULL OR q.evidence_file_name IS NULL OR q.evidence_mime_type IS NULL
        OR q.supplier_selection_justification IS NULL
        OR q.supplier_consultation_sent_at IS NULL OR q.supplier_consultation_response_deadline IS NULL
        OR q.source_tax_id IS NULL OR q.source_contact_name IS NULL OR q.source_contact_email IS NULL
        OR q.source_contact_phone IS NULL OR q.source_address IS NULL
        OR split_part(q.evidence_storage_path, '/', 1) IS DISTINCT FROM q.tenant_id::text
        OR split_part(q.evidence_storage_path, '/', 2) IS DISTINCT FROM 'procurement-quotes'
        OR split_part(q.evidence_storage_path, '/', 3) IS DISTINCT FROM q.procurement_item_id::text
        OR split_part(q.evidence_storage_path, '/', 4) IS DISTINCT FROM q.id::text
        OR q.evidence_storage_path !~* '[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
        OR NOT EXISTS (
          SELECT 1
          FROM storage.objects o
          WHERE o.bucket_id = 'gfs-private-documents'
            AND o.name = q.evidence_storage_path
            AND o.metadata->>'mimetype' = q.evidence_mime_type
            AND q.evidence_mime_type IN (
              'application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'image/jpeg','image/png'
            )
            AND CASE
              WHEN COALESCE(NULLIF(o.metadata->>'size', ''), NULLIF(o.metadata->>'contentLength', '')) ~ '^[0-9]+$'
                THEN COALESCE(NULLIF(o.metadata->>'size', ''), NULLIF(o.metadata->>'contentLength', ''))::bigint BETWEEN 1 AND 20971520
                  AND COALESCE(NULLIF(o.metadata->>'size', ''), NULLIF(o.metadata->>'contentLength', ''))::bigint = q.evidence_file_size
              ELSE false
            END
        )
      )
  ) THEN
    RAISE EXCEPTION 'Complete os dados da proposta formal e anexe o comprovante de cada cotação direta antes de aprovar o preço.';
  END IF;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Registre ao menos uma cotação ativa antes de aprovar o preço.';
  END IF;
  IF (v_count < 3 OR v_distinct_sources < 3)
     AND (p_exceptional_justification IS NULL OR pg_catalog.length(pg_catalog.btrim(p_exceptional_justification)) < 10) THEN
    RAISE EXCEPTION 'Com menos de três fontes distintas de pesquisa, informe justificativa excepcional da autoridade competente.';
  END IF;

  v_price := CASE p_method
    WHEN 'media' THEN v_average
    WHEN 'mediana' THEN v_median
    WHEN 'menor' THEN v_lowest
    ELSE p_other_unit_price::numeric(16,4)
  END;
  v_total := round(v_price * v_item.quantity, 2);
  IF v_average > 0 AND v_stddev IS NOT NULL THEN
    v_cv := (v_stddev / v_average) * 100;
  ELSE
    v_cv := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'quote', to_jsonb(q),
    'supplier', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', s.id, 'legal_name', s.legal_name, 'cnpj', s.cnpj,
      'contact_name', s.contact_name, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
      'street', s.street, 'street_number', s.street_number, 'neighborhood', s.neighborhood,
      'city', s.city, 'state', s.state, 'postal_code', s.postal_code
    ) END
  ) ORDER BY q.quoted_at, q.id), '[]'::jsonb)
  INTO v_sources
  FROM public.procurement_price_quotes q
  LEFT JOIN public.suppliers s ON s.id = q.supplier_id AND s.tenant_id = q.tenant_id
  WHERE q.tenant_id = p_tenant_id AND q.procurement_item_id = p_item_id;

  v_calc := jsonb_build_object(
    'method', p_method,
    'method_justification', pg_catalog.btrim(p_method_justification),
    'exceptional_justification', NULLIF(pg_catalog.btrim(p_exceptional_justification), ''),
    'sample_count', v_count,
    'distinct_source_count', v_distinct_sources,
    'effective_unit_prices', COALESCE(v_values, '[]'::jsonb),
    'average', v_average,
    'median', v_median,
    'lowest', v_lowest,
    'sample_standard_deviation', v_stddev,
    'coefficient_of_variation', v_cv,
    'approved_unit_price', v_price,
    'quantity', v_item.quantity,
    'approved_total_price', v_total,
    'formula', 'Preço efetivo = total cotado com frete ÷ quantidade cotada; total aprovado = preço unitário aprovado × quantidade do item.'
  );

  UPDATE public.procurement_price_approvals
  SET status = 'superseded', superseded_at = now()
  WHERE tenant_id = p_tenant_id AND procurement_item_id = p_item_id AND status = 'approved';

  INSERT INTO public.procurement_price_approvals(
    tenant_id, process_id, procurement_item_id, method, method_justification,
    exceptional_justification, approved_unit_price, approved_total_price, sample_count,
    source_snapshot, calculation_snapshot, status, approved_by, approved_at
  )
  VALUES(
    p_tenant_id, v_item.process_id, p_item_id, p_method, pg_catalog.btrim(p_method_justification),
    NULLIF(pg_catalog.btrim(p_exceptional_justification), ''), v_price, v_total, v_count,
    v_sources, v_calc, 'approved', v_actor, now()
  )
  RETURNING id INTO v_id;

  PERFORM pg_catalog.set_config('app_auth.price_estimate_write', 'on', true);
  UPDATE public.procurement_items
  SET estimated_unit_price = v_price, estimated_price_source = 'approved', updated_by = v_actor
  WHERE tenant_id = p_tenant_id AND id = p_item_id;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write', '', true);

  PERFORM app_auth.recalculate_procurement_process_estimate(p_tenant_id, v_item.process_id, v_actor, true);

  INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES(
    p_tenant_id, v_actor, 'procurement.price_estimated.approved', 'procurement_price_approvals', v_id::text,
    jsonb_build_object(
      'process_id', v_item.process_id,
      'item_id', p_item_id,
      'method', p_method,
      'approved_unit_price', v_price,
      'approved_total_price', v_total,
      'sample_count', v_count,
      'distinct_source_count', v_distinct_sources,
      'exceptional_justification', NULLIF(pg_catalog.btrim(p_exceptional_justification), '')
    ),
    now()
  );
  RETURN v_id;
END;
$function$;
