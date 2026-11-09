-- Restore operational tables absent from the versioned migration history.
-- Existing hosted tables and rows are preserved by CREATE TABLE IF NOT EXISTS.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS public.procurement_processes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 number text NOT NULL, title text NOT NULL, description text, modality text NOT NULL DEFAULT 'pregao',
 stage text NOT NULL DEFAULT 'planejamento', status text NOT NULL DEFAULT 'em_andamento',
 priority text NOT NULL DEFAULT 'normal', requesting_unit text, responsible_name text,
 estimated_value numeric CHECK (estimated_value IS NULL OR estimated_value >= 0), due_date date,
 created_by uuid NOT NULL REFERENCES auth.users(id), updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT procurement_processes_number_check CHECK (length(btrim(number)) BETWEEN 1 AND 60),
 CONSTRAINT procurement_processes_title_check CHECK (length(btrim(title)) BETWEEN 3 AND 300),
 CONSTRAINT procurement_processes_modality_check CHECK (modality IN ('pregao','concorrencia','dispensa','inexigibilidade','adesao_ata','outro')),
 CONSTRAINT procurement_processes_stage_check CHECK (stage IN ('planejamento','estudos','objeto','pesquisa','parecer','conclusao')),
 CONSTRAINT procurement_processes_status_check CHECK (status IN ('em_andamento','concluido','arquivado')),
 CONSTRAINT procurement_processes_priority_check CHECK (priority IN ('baixa','normal','alta','urgente')),
 CONSTRAINT procurement_processes_id_tenant_unique UNIQUE (id,tenant_id),
 CONSTRAINT uq_process_tenant_id UNIQUE (tenant_id,id), CONSTRAINT uq_process_number UNIQUE (tenant_id,number)
);
CREATE TABLE IF NOT EXISTS public.process_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 process_id uuid NOT NULL, stage text NOT NULL, title text NOT NULL, is_done boolean NOT NULL DEFAULT false,
 document_url text, sort_order integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES auth.users(id), updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT process_items_stage_check CHECK (stage IN ('planejamento','estudos','objeto','pesquisa','parecer','conclusao')),
 CONSTRAINT process_items_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 200),
 CONSTRAINT process_items_document_url_check CHECK (document_url IS NULL OR document_url ~* '^https://'),
 CONSTRAINT fk_item_process FOREIGN KEY (tenant_id,process_id) REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 number text NOT NULL, object text NOT NULL, supplier_id uuid, process_id uuid,
 modality text NOT NULL DEFAULT 'pregao', total_value numeric NOT NULL DEFAULT 0,
 start_date date NOT NULL, end_date date NOT NULL, manager_name text, inspector_name text, ordinance text,
 status text NOT NULL DEFAULT 'vigente', notes text,
 created_by uuid NOT NULL REFERENCES auth.users(id), updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT contracts_number_check CHECK (length(btrim(number)) BETWEEN 1 AND 60),
 CONSTRAINT contracts_object_check CHECK (length(btrim(object)) BETWEEN 3 AND 500),
 CONSTRAINT contracts_modality_check CHECK (modality IN ('pregao','concorrencia','dispensa','inexigibilidade','adesao_ata','outro')),
 CONSTRAINT contracts_status_check CHECK (status IN ('vigente','encerrado','rescindido','arquivado')),
 CONSTRAINT contracts_total_value_check CHECK (total_value >= 0), CONSTRAINT ck_contract_dates CHECK (end_date >= start_date),
 CONSTRAINT uq_contract_number UNIQUE (tenant_id,number), CONSTRAINT uq_contract_tenant_id UNIQUE (tenant_id,id),
 CONSTRAINT fk_contract_process FOREIGN KEY (tenant_id,process_id) REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_contract_supplier FOREIGN KEY (tenant_id,supplier_id) REFERENCES public.suppliers(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.contract_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 contract_id uuid NOT NULL, number text NOT NULL, kind text NOT NULL, new_end_date date,
 value_change numeric NOT NULL DEFAULT 0, signed_at date NOT NULL DEFAULT current_date, notes text,
 created_by uuid NOT NULL REFERENCES auth.users(id), updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT contract_amendments_number_check CHECK (length(btrim(number)) BETWEEN 1 AND 60),
 CONSTRAINT contract_amendments_kind_check CHECK (kind IN ('prorrogacao','acrescimo','supressao','outro')),
 CONSTRAINT uq_amendment_number UNIQUE (contract_id,number),
 CONSTRAINT fk_amendment_contract FOREIGN KEY (tenant_id,contract_id) REFERENCES public.contracts(tenant_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_processes_tenant_stage ON public.procurement_processes(tenant_id,stage);
CREATE INDEX IF NOT EXISTS ix_processes_created_by ON public.procurement_processes(created_by);
CREATE INDEX IF NOT EXISTS ix_processes_updated_by ON public.procurement_processes(updated_by);
CREATE INDEX IF NOT EXISTS ix_items_process ON public.process_items(tenant_id,process_id);
CREATE INDEX IF NOT EXISTS ix_items_created_by ON public.process_items(created_by);
CREATE INDEX IF NOT EXISTS ix_items_updated_by ON public.process_items(updated_by);
CREATE INDEX IF NOT EXISTS ix_contracts_process ON public.contracts(tenant_id,process_id);
CREATE INDEX IF NOT EXISTS ix_contracts_supplier ON public.contracts(tenant_id,supplier_id);
CREATE INDEX IF NOT EXISTS ix_contracts_tenant_end ON public.contracts(tenant_id,end_date);
CREATE INDEX IF NOT EXISTS ix_contracts_created_by ON public.contracts(created_by);
CREATE INDEX IF NOT EXISTS ix_contracts_updated_by ON public.contracts(updated_by);
CREATE INDEX IF NOT EXISTS ix_amend_contract ON public.contract_amendments(tenant_id,contract_id);
CREATE INDEX IF NOT EXISTS ix_amend_created_by ON public.contract_amendments(created_by);
CREATE INDEX IF NOT EXISTS ix_amend_updated_by ON public.contract_amendments(updated_by);

ALTER TABLE public.procurement_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_processes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.process_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_amendments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_processes,public.process_items,public.contracts,public.contract_amendments FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE ON public.procurement_processes,public.process_items,public.contracts,public.contract_amendments TO authenticated;
GRANT ALL ON public.procurement_processes,public.process_items,public.contracts,public.contract_amendments TO service_role;

DROP POLICY IF EXISTS p_processes_select ON public.procurement_processes;
CREATE POLICY p_processes_select ON public.procurement_processes FOR SELECT TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')) OR (SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_processes_insert ON public.procurement_processes;
CREATE POLICY p_processes_insert ON public.procurement_processes FOR INSERT TO authenticated WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create')) AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_processes_update ON public.procurement_processes;
CREATE POLICY p_processes_update ON public.procurement_processes FOR UPDATE TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))) WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));

DROP POLICY IF EXISTS p_items_select ON public.process_items;
CREATE POLICY p_items_select ON public.process_items FOR SELECT TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')) OR (SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_items_insert ON public.process_items;
CREATE POLICY p_items_insert ON public.process_items FOR INSERT TO authenticated WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create')) AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_items_update ON public.process_items;
CREATE POLICY p_items_update ON public.process_items FOR UPDATE TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))) WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));

DROP POLICY IF EXISTS p_contracts_select ON public.contracts;
CREATE POLICY p_contracts_select ON public.contracts FOR SELECT TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')) OR (SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_contracts_insert ON public.contracts;
CREATE POLICY p_contracts_insert ON public.contracts FOR INSERT TO authenticated WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create')) AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_contracts_update ON public.contracts;
CREATE POLICY p_contracts_update ON public.contracts FOR UPDATE TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))) WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));

DROP POLICY IF EXISTS p_amend_select ON public.contract_amendments;
CREATE POLICY p_amend_select ON public.contract_amendments FOR SELECT TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')) OR (SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_amend_insert ON public.contract_amendments;
CREATE POLICY p_amend_insert ON public.contract_amendments FOR INSERT TO authenticated WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_amend_update ON public.contract_amendments;
CREATE POLICY p_amend_update ON public.contract_amendments FOR UPDATE TO authenticated USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))) WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));
COMMIT;
