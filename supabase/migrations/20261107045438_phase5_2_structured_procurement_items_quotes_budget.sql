BEGIN;
CREATE TABLE IF NOT EXISTS public.procurement_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 process_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number BETWEEN 1 AND 99999),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 500),
 technical_specification text,
 unit text NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 30),
 quantity numeric(14,4) NOT NULL CHECK(quantity>0),
 estimated_unit_price numeric(16,4) CHECK(estimated_unit_price IS NULL OR estimated_unit_price>=0),
 estimated_total numeric(16,2) GENERATED ALWAYS AS (
  CASE WHEN estimated_unit_price IS NULL THEN NULL ELSE round(quantity*estimated_unit_price,2) END
 ) STORED,
 delivery_location text,
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT procurement_items_tenant_id_unique UNIQUE(tenant_id,id),
 CONSTRAINT procurement_items_line_number_unique UNIQUE(tenant_id,process_id,line_number),
 CONSTRAINT procurement_items_process_tenant_fk FOREIGN KEY(tenant_id,process_id)
  REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.procurement_price_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 procurement_item_id uuid NOT NULL,
 supplier_id uuid,
 source_name text NOT NULL CHECK(length(btrim(source_name)) BETWEEN 2 AND 250),
 reference_url text CHECK(reference_url IS NULL OR reference_url ~* '^https://'),
 quoted_at date NOT NULL DEFAULT current_date,
 quantity numeric(14,4) NOT NULL CHECK(quantity>0),
 unit_price numeric(16,4) NOT NULL CHECK(unit_price>=0),
 delivery_cost numeric(16,2) NOT NULL DEFAULT 0 CHECK(delivery_cost>=0),
 total_price numeric(16,2) GENERATED ALWAYS AS (round((quantity*unit_price)+delivery_cost,2)) STORED,
 notes text,
 selected_for_estimate boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT procurement_price_quotes_tenant_id_unique UNIQUE(tenant_id,id),
 CONSTRAINT procurement_price_quotes_item_tenant_fk FOREIGN KEY(tenant_id,procurement_item_id)
  REFERENCES public.procurement_items(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT procurement_price_quotes_supplier_tenant_fk FOREIGN KEY(tenant_id,supplier_id)
  REFERENCES public.suppliers(tenant_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_procurement_price_quotes_selected
 ON public.procurement_price_quotes(tenant_id,procurement_item_id)
 WHERE selected_for_estimate=true AND is_active=true;

CREATE TABLE IF NOT EXISTS public.procurement_budget_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 process_id uuid NOT NULL,
 fiscal_year smallint NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2200),
 budget_unit text NOT NULL CHECK(length(btrim(budget_unit)) BETWEEN 1 AND 180),
 functional_program text,
 budget_action text,
 expense_nature text,
 funding_source text,
 allocated_amount numeric(16,2) NOT NULL CHECK(allocated_amount>=0),
 notes text,
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT procurement_budget_allocations_tenant_id_unique UNIQUE(tenant_id,id),
 CONSTRAINT procurement_budget_allocations_process_tenant_fk FOREIGN KEY(tenant_id,process_id)
  REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_procurement_items_process_active
 ON public.procurement_items(tenant_id,process_id,is_active,line_number);
CREATE INDEX IF NOT EXISTS ix_procurement_price_quotes_item_active
 ON public.procurement_price_quotes(tenant_id,procurement_item_id,is_active,quoted_at DESC);
CREATE INDEX IF NOT EXISTS ix_procurement_price_quotes_supplier
 ON public.procurement_price_quotes(tenant_id,supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_procurement_budget_allocations_process
 ON public.procurement_budget_allocations(tenant_id,process_id,fiscal_year) WHERE is_active=true;

REVOKE ALL ON TABLE public.procurement_items FROM anon;
REVOKE ALL ON TABLE public.procurement_price_quotes FROM anon;
REVOKE ALL ON TABLE public.procurement_budget_allocations FROM anon;
GRANT SELECT,INSERT,UPDATE ON TABLE public.procurement_items TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.procurement_price_quotes TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.procurement_budget_allocations TO authenticated;
GRANT ALL ON TABLE public.procurement_items TO service_role;
GRANT ALL ON TABLE public.procurement_price_quotes TO service_role;
GRANT ALL ON TABLE public.procurement_budget_allocations TO service_role;

ALTER TABLE public.procurement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_price_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_price_quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_budget_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_budget_allocations FORCE ROW LEVEL SECURITY;

-- PROCURE ITEMS
DROP POLICY IF EXISTS p_procurement_items_select ON public.procurement_items;
CREATE POLICY p_procurement_items_select ON public.procurement_items FOR SELECT TO authenticated
 USING((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
DROP POLICY IF EXISTS p_procurement_items_master_read ON public.procurement_items;
CREATE POLICY p_procurement_items_master_read ON public.procurement_items FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_procurement_items_insert ON public.procurement_items;
CREATE POLICY p_procurement_items_insert ON public.procurement_items FOR INSERT TO authenticated
 WITH CHECK((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
  AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_procurement_items_update ON public.procurement_items;
CREATE POLICY p_procurement_items_update ON public.procurement_items FOR UPDATE TO authenticated
 USING((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
 WITH CHECK((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_procurement_items_commercial_select ON public.procurement_items;
CREATE POLICY p_procurement_items_commercial_select ON public.procurement_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos'))));
DROP POLICY IF EXISTS p_procurement_items_commercial_insert ON public.procurement_items;
CREATE POLICY p_procurement_items_commercial_insert ON public.procurement_items AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')));
DROP POLICY IF EXISTS p_procurement_items_commercial_update ON public.procurement_items;
CREATE POLICY p_procurement_items_commercial_update ON public.procurement_items AS RESTRICTIVE FOR UPDATE TO authenticated
 USING((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')))
 WITH CHECK((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')));

-- PRICE QUOTES
DROP POLICY IF EXISTS p_procurement_price_quotes_select ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_select ON public.procurement_price_quotes FOR SELECT TO authenticated
 USING((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
DROP POLICY IF EXISTS p_procurement_price_quotes_master_read ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_master_read ON public.procurement_price_quotes FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_procurement_price_quotes_insert ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_insert ON public.procurement_price_quotes FOR INSERT TO authenticated
 WITH CHECK((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
  AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_procurement_price_quotes_update ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_update ON public.procurement_price_quotes FOR UPDATE TO authenticated
 USING((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
 WITH CHECK((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_procurement_price_quotes_commercial_select ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_commercial_select ON public.procurement_price_quotes AS RESTRICTIVE FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos'))));
DROP POLICY IF EXISTS p_procurement_price_quotes_commercial_insert ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_commercial_insert ON public.procurement_price_quotes AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')));
DROP POLICY IF EXISTS p_procurement_price_quotes_commercial_update ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_commercial_update ON public.procurement_price_quotes AS RESTRICTIVE FOR UPDATE TO authenticated
 USING((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')))
 WITH CHECK((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')));

-- BUDGET ALLOCATIONS
DROP POLICY IF EXISTS p_procurement_budget_allocations_select ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_select ON public.procurement_budget_allocations FOR SELECT TO authenticated
 USING((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
DROP POLICY IF EXISTS p_procurement_budget_allocations_master_read ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_master_read ON public.procurement_budget_allocations FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_procurement_budget_allocations_insert ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_insert ON public.procurement_budget_allocations FOR INSERT TO authenticated
 WITH CHECK((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
  AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_procurement_budget_allocations_update ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_update ON public.procurement_budget_allocations FOR UPDATE TO authenticated
 USING((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
 WITH CHECK((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')) AND updated_by=(SELECT auth.uid()));
DROP POLICY IF EXISTS p_procurement_budget_allocations_commercial_select ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_commercial_select ON public.procurement_budget_allocations AS RESTRICTIVE FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos'))));
DROP POLICY IF EXISTS p_procurement_budget_allocations_commercial_insert ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_commercial_insert ON public.procurement_budget_allocations AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')));
DROP POLICY IF EXISTS p_procurement_budget_allocations_commercial_update ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_commercial_update ON public.procurement_budget_allocations AS RESTRICTIVE FOR UPDATE TO authenticated
 USING((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')))
 WITH CHECK((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,'processos')));

-- Audit and row-identity triggers.
DO $triggers$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['procurement_items','procurement_price_quotes','procurement_budget_allocations'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_identity ON public.%1$I',v_table);
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I',v_table);
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I',v_table);
  EXECUTE format('CREATE TRIGGER trg_%1$s_identity BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fn_protect_tenant_row_identity()',v_table);
  EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()',v_table);
  EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module()',v_table);
 END LOOP;
END
$triggers$;

COMMENT ON TABLE public.procurement_items IS 'Itens estruturados da contratacao; nao confundir com o checklist de etapas em process_items.';
COMMENT ON TABLE public.procurement_price_quotes IS 'Cotacoes de pesquisa de precos por item e tenant, com fornecedor cadastrado ou fonte externa.';
COMMENT ON TABLE public.procurement_budget_allocations IS 'Alocacoes orcamentarias por processo, exercicio e classificacao de despesa.';
COMMENT ON COLUMN public.procurement_price_quotes.selected_for_estimate IS 'Cotacao escolhida como referencia pelo responsavel; nao calcula aprovacao nem define preco automaticamente.';
COMMIT;