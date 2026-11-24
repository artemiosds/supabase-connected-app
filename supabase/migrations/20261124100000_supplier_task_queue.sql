-- =============================================================================
-- ENTREGA 4: Automação Operacional e Monitoramento de Pendências
-- Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores
-- Migration: 20261124100000_supplier_task_queue.sql
-- =============================================================================

-- 1. TABELA: supplier_pending_tasks
CREATE TABLE IF NOT EXISTS public.supplier_pending_tasks (
    id              uuid                     NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       uuid                     NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id     uuid                     NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,

    task_type       text                     NOT NULL,
    reference_table text,
    reference_id    uuid,

    priority        text                     NOT NULL DEFAULT 'medium',
    status          text                     NOT NULL DEFAULT 'open',

    title           text                     NOT NULL,
    description     text,
    due_date        date,

    assigned_to     uuid                     REFERENCES public.profiles(id) ON DELETE SET NULL,

    resolved_at     timestamptz,
    resolved_by     uuid                     REFERENCES auth.users(id) ON DELETE SET NULL,
    resolution_notes text,

    auto_generated  boolean                  NOT NULL DEFAULT false,

    created_by      uuid                     NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      timestamptz              NOT NULL DEFAULT now(),
    updated_at      timestamptz              NOT NULL DEFAULT now(),

    CONSTRAINT pk_supplier_pending_tasks        PRIMARY KEY (id),
    CONSTRAINT ux_supplier_pending_tasks_tid_id UNIQUE (tenant_id, id),

    CONSTRAINT ck_supplier_pending_tasks_task_type CHECK (task_type IN (
        'document_expired',
        'document_expiring',
        'regularity_expired',
        'regularity_irregular',
        'homologation_pending',
        'complementation_requested',
        'sanction_recorded',
        'manual'
    )),
    CONSTRAINT ck_supplier_pending_tasks_priority CHECK (priority IN (
        'critical', 'high', 'medium', 'low'
    )),
    CONSTRAINT ck_supplier_pending_tasks_status CHECK (status IN (
        'open', 'in_progress', 'resolved', 'dismissed'
    ))
);

-- Índices de desempenho
CREATE INDEX IF NOT EXISTS idx_supplier_pending_tasks_tenant
    ON public.supplier_pending_tasks (tenant_id);

CREATE INDEX IF NOT EXISTS idx_supplier_pending_tasks_supplier
    ON public.supplier_pending_tasks (tenant_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_pending_tasks_status
    ON public.supplier_pending_tasks (tenant_id, status)
    WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_supplier_pending_tasks_priority
    ON public.supplier_pending_tasks (tenant_id, priority, status)
    WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_supplier_pending_tasks_due_date
    ON public.supplier_pending_tasks (tenant_id, due_date)
    WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_supplier_pending_tasks_ref
    ON public.supplier_pending_tasks (reference_table, reference_id)
    WHERE reference_table IS NOT NULL;

-- 2. Trigger para atualizar updated_at
CREATE OR REPLACE TRIGGER trg_supplier_pending_tasks_updated_at
  BEFORE UPDATE ON public.supplier_pending_tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 3. Habilitar e Forçar RLS
ALTER TABLE public.supplier_pending_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_pending_tasks FORCE ROW LEVEL SECURITY;

-- 4. Políticas restritivas comerciais
CREATE POLICY p_commercial_select_supplier_pending_tasks ON public.supplier_pending_tasks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores'))));

CREATE POLICY p_commercial_insert_supplier_pending_tasks ON public.supplier_pending_tasks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

CREATE POLICY p_commercial_update_supplier_pending_tasks ON public.supplier_pending_tasks
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')))
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

-- 5. Políticas permissivas por permissões de Secretaria
CREATE POLICY p_supplier_pending_tasks_select ON public.supplier_pending_tasks
  FOR SELECT TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:view'));

CREATE POLICY p_supplier_pending_tasks_insert ON public.supplier_pending_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    app_auth.has_supplier_permission(tenant_id, 'suppliers:update')
    AND created_by = (SELECT auth.uid())
  );

CREATE POLICY p_supplier_pending_tasks_update ON public.supplier_pending_tasks
  FOR UPDATE TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
  WITH CHECK (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'));

-- 6. Trigger automático para documentos a vencer / vencidos
CREATE OR REPLACE FUNCTION public.fn_auto_create_document_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days_to_expire   integer;
    v_task_type        text;
    v_priority         text;
    v_title            text;
    v_description      text;
    v_due_date         date;
    v_supplier_name    text;
    v_doc_name         text;
    v_already_exists   boolean;
    v_service_user_id  uuid;
BEGIN
    IF NEW.expires_at IS NULL THEN
        RETURN NEW;
    END IF;

    v_days_to_expire := (NEW.expires_at::date - CURRENT_DATE);

    IF v_days_to_expire > 30 THEN
        RETURN NEW;
    END IF;

    IF v_days_to_expire < 0 THEN
        v_task_type := 'document_expired';
        v_priority  := 'critical';
    ELSIF v_days_to_expire <= 7 THEN
        v_task_type := 'document_expiring';
        v_priority  := 'high';
    ELSIF v_days_to_expire <= 15 THEN
        v_task_type := 'document_expiring';
        v_priority  := 'medium';
    ELSE
        v_task_type := 'document_expiring';
        v_priority  := 'low';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM   public.supplier_pending_tasks spt
        WHERE  spt.tenant_id       = NEW.tenant_id
          AND  spt.supplier_id     = NEW.supplier_id
          AND  spt.task_type       = v_task_type
          AND  spt.reference_table = 'supplier_documents'
          AND  spt.reference_id    = NEW.id
          AND  spt.status IN ('open', 'in_progress')
    ) INTO v_already_exists;

    IF v_already_exists THEN
        RETURN NEW;
    END IF;

    SELECT s.legal_name INTO v_supplier_name
    FROM   public.suppliers s
    WHERE  s.id = NEW.supplier_id;

    v_doc_name := COALESCE(NEW.document_type, 'Documento');

    IF v_task_type = 'document_expired' THEN
        v_title       := 'Documento VENCIDO: ' || v_doc_name || ' — ' || COALESCE(v_supplier_name, 'Fornecedor');
        v_description := 'O documento "' || v_doc_name || '" do fornecedor ' || COALESCE(v_supplier_name, NEW.supplier_id::text)
                      || ' venceu em ' || TO_CHAR(NEW.expires_at::date, 'DD/MM/YYYY') || '. Providenciar substituição imediata.';
        v_due_date    := CURRENT_DATE;
    ELSE
        v_title       := 'Documento vencendo em ' || v_days_to_expire || ' dias: ' || v_doc_name;
        v_description := 'O documento "' || v_doc_name || '" do fornecedor ' || COALESCE(v_supplier_name, NEW.supplier_id::text)
                      || ' vencerá em ' || TO_CHAR(NEW.expires_at::date, 'DD/MM/YYYY') || '. Solicitar substituição preventiva.';
        v_due_date    := NEW.expires_at::date;
    END IF;

    v_service_user_id := COALESCE((SELECT auth.uid()), NEW.created_by);

    INSERT INTO public.supplier_pending_tasks (
        tenant_id, supplier_id, task_type, reference_table, reference_id,
        priority, status, title, description, due_date,
        auto_generated, created_by
    ) VALUES (
        NEW.tenant_id, NEW.supplier_id, v_task_type, 'supplier_documents', NEW.id,
        v_priority, 'open', v_title, v_description, v_due_date,
        true, v_service_user_id
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE  table_schema = 'public'
          AND  table_name   = 'supplier_documents'
    ) THEN
        DROP TRIGGER IF EXISTS trg_supplier_documents_auto_task ON public.supplier_documents;
        CREATE TRIGGER trg_supplier_documents_auto_task
            AFTER INSERT OR UPDATE OF expires_at, status
            ON public.supplier_documents
            FOR EACH ROW
            EXECUTE FUNCTION public.fn_auto_create_document_task();
    END IF;
END;
$$;

-- 7. RPC: create_supplier_task
CREATE OR REPLACE FUNCTION public.create_supplier_task(
    p_tenant_id       uuid,
    p_supplier_id     uuid,
    p_task_type       text,
    p_title           text,
    p_description     text       DEFAULT NULL,
    p_priority        text       DEFAULT 'medium',
    p_due_date        date       DEFAULT NULL,
    p_assigned_to     uuid       DEFAULT NULL,
    p_reference_table text       DEFAULT NULL,
    p_reference_id    uuid       DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_task_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF NOT app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update') THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente para criar tarefas de fornecedor.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = p_supplier_id AND s.tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Fornecedor não encontrado nesta Secretaria.';
    END IF;

    INSERT INTO public.supplier_pending_tasks (
        tenant_id, supplier_id, task_type, title, description,
        priority, due_date, assigned_to,
        reference_table, reference_id,
        auto_generated, created_by
    ) VALUES (
        p_tenant_id, p_supplier_id, p_task_type, p_title, p_description,
        p_priority, p_due_date, p_assigned_to,
        p_reference_table, p_reference_id,
        false, v_user_id
    )
    RETURNING id INTO v_task_id;

    RETURN v_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_supplier_task(uuid, uuid, text, text, text, text, date, uuid, text, uuid) TO authenticated;

-- 8. RPC: resolve_supplier_task
CREATE OR REPLACE FUNCTION public.resolve_supplier_task(
    p_tenant_id        uuid,
    p_task_id          uuid,
    p_resolution_notes text   DEFAULT NULL,
    p_action           text   DEFAULT 'resolved'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF NOT app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update') THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente para resolver tarefas de fornecedor.';
    END IF;

    IF p_action NOT IN ('resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Ação inválida: deve ser resolved ou dismissed.';
    END IF;

    UPDATE public.supplier_pending_tasks
    SET
        status           = p_action,
        resolved_at      = now(),
        resolved_by      = v_user_id,
        resolution_notes = p_resolution_notes,
        updated_at       = now()
    WHERE id        = p_task_id
      AND tenant_id = p_tenant_id
      AND status IN ('open', 'in_progress');

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_supplier_task(uuid, uuid, text, text) TO authenticated;

-- 9. RPC: get_supplier_pending_tasks_summary
CREATE OR REPLACE FUNCTION public.get_supplier_pending_tasks_summary(
    p_tenant_id uuid
)
RETURNS TABLE (
    open_count      bigint,
    critical_count  bigint,
    overdue_count   bigint,
    high_count      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT app_auth.has_supplier_permission(p_tenant_id, 'suppliers:view') THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE spt.status IN ('open', 'in_progress'))                                  AS open_count,
        COUNT(*) FILTER (WHERE spt.priority = 'critical' AND spt.status IN ('open','in_progress'))     AS critical_count,
        COUNT(*) FILTER (WHERE spt.due_date < CURRENT_DATE AND spt.status IN ('open','in_progress'))   AS overdue_count,
        COUNT(*) FILTER (WHERE spt.priority = 'high' AND spt.status IN ('open','in_progress'))         AS high_count
    FROM public.supplier_pending_tasks spt
    WHERE spt.tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_pending_tasks_summary(uuid) TO authenticated;

-- 10. RPC: list_supplier_pending_tasks
CREATE OR REPLACE FUNCTION public.list_supplier_pending_tasks(
    p_tenant_id   uuid,
    p_supplier_id uuid       DEFAULT NULL,
    p_status      text       DEFAULT NULL,
    p_priority    text       DEFAULT NULL,
    p_task_type   text       DEFAULT NULL,
    p_limit       integer    DEFAULT 50,
    p_offset      integer    DEFAULT 0
)
RETURNS TABLE (
    id              uuid,
    supplier_id     uuid,
    supplier_name   text,
    task_type       text,
    priority        text,
    status          text,
    title           text,
    description     text,
    due_date        date,
    assigned_to     uuid,
    assigned_name   text,
    auto_generated  boolean,
    created_at      timestamptz,
    resolved_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT app_auth.has_supplier_permission(p_tenant_id, 'suppliers:view') THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    RETURN QUERY
    SELECT
        spt.id,
        spt.supplier_id,
        s.legal_name           AS supplier_name,
        spt.task_type,
        spt.priority,
        spt.status,
        spt.title,
        spt.description,
        spt.due_date,
        spt.assigned_to,
        p.full_name            AS assigned_name,
        spt.auto_generated,
        spt.created_at,
        spt.resolved_at
    FROM  public.supplier_pending_tasks spt
    JOIN  public.suppliers              s   ON s.id = spt.supplier_id
    LEFT JOIN public.profiles           p   ON p.id = spt.assigned_to
    WHERE spt.tenant_id = p_tenant_id
      AND (p_supplier_id IS NULL OR spt.supplier_id = p_supplier_id)
      AND (p_status      IS NULL OR spt.status      = p_status)
      AND (p_priority    IS NULL OR spt.priority    = p_priority)
      AND (p_task_type   IS NULL OR spt.task_type   = p_task_type)
    ORDER BY
        CASE spt.priority
            WHEN 'critical' THEN 1
            WHEN 'high'     THEN 2
            WHEN 'medium'   THEN 3
            WHEN 'low'      THEN 4
        END,
        spt.due_date NULLS LAST,
        spt.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_supplier_pending_tasks(uuid, uuid, text, text, text, integer, integer) TO authenticated;

-- 11. Registrar migração
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20261124100000', ARRAY['-- 20261124100000_supplier_task_queue'], 'supplier_task_queue')
ON CONFLICT (version) DO NOTHING;
