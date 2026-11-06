-- OBSOLETO — NÃO EXECUTAR.
-- Este rascunho foi substituído pelo estado real já existente no SMS2.
-- As tabelas procurement_processes, process_items, contracts e contract_amendments já existem
-- no projeto, com RLS habilitado/FORCE RLS e políticas comerciais aplicadas.
-- O DDL de criação não está reconciliado no histórico de migrations. É necessário preparar
-- uma migration BASELINE idempotente para instalações novas, após comparar o schema real.
-- NÃO aplicar este arquivo ao SMS2: contém CREATE TABLE sem IF NOT EXISTS e causará conflito.

CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_tenant_id_id ON public.suppliers(tenant_id, id);

CREATE TABLE public.procurement_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 60),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  description text,
  modality text NOT NULL DEFAULT 'pregao'
    CHECK (modality IN ('pregao','concorrencia','dispensa','inexigibilidade','adesao_ata','outro')),
  stage text NOT NULL DEFAULT 'planejamento'
    CHECK (stage IN ('planejamento','estudos','objeto','pesquisa','parecer','conclusao')),
  status text NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento','concluido','arquivado')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','urgente')),
  requesting_unit text,
  responsible_name text,
  estimated_value numeric(16,2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
  due_date date,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_process_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_process_number UNIQUE (tenant_id, number)
);
GRANT SELECT, INSERT, UPDATE ON public.procurement_processes TO authenticated;
GRANT ALL ON public.procurement_processes TO service_role;
ALTER TABLE public.procurement_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_processes FORCE ROW LEVEL SECURITY;
CREATE POLICY p_processes_select ON public.procurement_processes FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_processes_insert ON public.procurement_processes FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
    AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY p_processes_update ON public.procurement_processes FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    AND updated_by = (SELECT auth.uid()));
CREATE INDEX ix_processes_tenant_stage ON public.procurement_processes(tenant_id, stage);
CREATE INDEX ix_processes_created_by ON public.procurement_processes(created_by);
CREATE INDEX ix_processes_updated_by ON public.procurement_processes(updated_by);

CREATE TABLE public.process_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('planejamento','estudos','objeto','pesquisa','parecer','conclusao')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  is_done boolean NOT NULL DEFAULT false,
  document_url text CHECK (document_url IS NULL OR document_url ~* '^https://'),
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_item_process FOREIGN KEY (tenant_id, process_id)
    REFERENCES public.procurement_processes(tenant_id, id)
);
GRANT SELECT, INSERT, UPDATE ON public.process_items TO authenticated;
GRANT ALL ON public.process_items TO service_role;
ALTER TABLE public.process_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_items FORCE ROW LEVEL SECURITY;
CREATE POLICY p_items_select ON public.process_items FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_items_insert ON public.process_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
    AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY p_items_update ON public.process_items FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    AND updated_by = (SELECT auth.uid()));
CREATE INDEX ix_items_process ON public.process_items(tenant_id, process_id);
CREATE INDEX ix_items_created_by ON public.process_items(created_by);
CREATE INDEX ix_items_updated_by ON public.process_items(updated_by);

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 60),
  object text NOT NULL CHECK (length(btrim(object)) BETWEEN 3 AND 500),
  supplier_id uuid,
  process_id uuid,
  modality text NOT NULL DEFAULT 'pregao'
    CHECK (modality IN ('pregao','concorrencia','dispensa','inexigibilidade','adesao_ata','outro')),
  total_value numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  manager_name text,
  inspector_name text,
  ordinance text,
  status text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','encerrado','rescindido','arquivado')),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_contract_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_contract_number UNIQUE (tenant_id, number),
  CONSTRAINT ck_contract_dates CHECK (end_date >= start_date),
  CONSTRAINT fk_contract_supplier FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id),
  CONSTRAINT fk_contract_process FOREIGN KEY (tenant_id, process_id) REFERENCES public.procurement_processes(tenant_id, id)
);
GRANT SELECT, INSERT, UPDATE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY p_contracts_select ON public.contracts FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_contracts_insert ON public.contracts FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
    AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY p_contracts_update ON public.contracts FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    AND updated_by = (SELECT auth.uid()));
CREATE INDEX ix_contracts_tenant_end ON public.contracts(tenant_id, end_date);
CREATE INDEX ix_contracts_supplier ON public.contracts(tenant_id, supplier_id);
CREATE INDEX ix_contracts_process ON public.contracts(tenant_id, process_id);
CREATE INDEX ix_contracts_created_by ON public.contracts(created_by);
CREATE INDEX ix_contracts_updated_by ON public.contracts(updated_by);

CREATE TABLE public.contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('prorrogacao','acrescimo','supressao','outro')),
  new_end_date date,
  value_change numeric(16,2) NOT NULL DEFAULT 0,
  signed_at date NOT NULL DEFAULT current_date,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_amendment_number UNIQUE (contract_id, number),
  CONSTRAINT fk_amendment_contract FOREIGN KEY (tenant_id, contract_id) REFERENCES public.contracts(tenant_id, id)
);
GRANT SELECT, INSERT, UPDATE ON public.contract_amendments TO authenticated;
GRANT ALL ON public.contract_amendments TO service_role;
ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY p_amend_select ON public.contract_amendments FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_amend_insert ON public.contract_amendments FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    AND created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid()));
CREATE POLICY p_amend_update ON public.contract_amendments FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    AND updated_by = (SELECT auth.uid()));
CREATE INDEX ix_amend_contract ON public.contract_amendments(tenant_id, contract_id);
CREATE INDEX ix_amend_created_by ON public.contract_amendments(created_by);
CREATE INDEX ix_amend_updated_by ON public.contract_amendments(updated_by);

-- Aditivo de prorrogação/valor atualiza o contrato (SECURITY INVOKER: RLS do usuário se aplica).
CREATE FUNCTION public.fn_apply_contract_amendment()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  IF NEW.kind = 'prorrogacao' AND NEW.new_end_date IS NOT NULL THEN
    UPDATE public.contracts SET end_date = GREATEST(end_date, NEW.new_end_date), updated_by = NEW.updated_by
     WHERE id = NEW.contract_id AND tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.kind IN ('acrescimo','supressao') AND NEW.value_change <> 0 THEN
    UPDATE public.contracts SET total_value = GREATEST(0, total_value + NEW.value_change), updated_by = NEW.updated_by
     WHERE id = NEW.contract_id AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_apply_contract_amendment() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_amend_apply AFTER INSERT ON public.contract_amendments
  FOR EACH ROW EXECUTE FUNCTION public.fn_apply_contract_amendment();

CREATE FUNCTION public.fn_protect_tenant_row_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Não é permitido alterar organização, autoria ou data de criação.';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_protect_tenant_row_identity() FROM PUBLIC, anon, authenticated, service_role;

DO $d$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procurement_processes','process_items','contracts','contract_amendments'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_identity BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fn_protect_tenant_row_identity()', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module()', t);
  END LOOP;
END $d$;
