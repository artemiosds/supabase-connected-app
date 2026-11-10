-- The commercial foundation migration runs before some operational tables exist
-- in a clean install. Re-apply its row/write guards after every operational table
-- has been created, without changing existing tenant data.

DO $commercial_guards$
DECLARE
  r record;
  v_module text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('suppliers','fornecedores','trg_commercial_guard_suppliers'),
      ('supplier_documents','fornecedores','trg_commercial_guard_supplier_documents'),
      ('procurement_processes','processos','trg_commercial_guard_procurement_processes'),
      ('process_items','processos','trg_commercial_guard_process_items'),
      ('contracts','contratos','trg_commercial_guard_contracts'),
      ('contract_amendments','contratos','trg_commercial_guard_contract_amendments'),
      ('document_templates','modelos','trg_commercial_guard_document_templates'),
      ('generated_documents','documentos','trg_commercial_guard_generated_documents')
    ) AS x(table_name,module_name,trigger_name)
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I',r.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required operational table public.% is missing; refusing to complete commercial guard installation.', r.table_name;
    END IF;

    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS %I ON public.%I',r.trigger_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_guard_tenant_commercial_write()',
      r.trigger_name,r.table_name
    );

    v_module := r.module_name;

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS p_master_support_read_%I ON public.%I',r.table_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY p_master_support_read_%I ON public.%I FOR SELECT TO authenticated USING ((SELECT app_auth.is_platform_admin()))',
      r.table_name,r.table_name
    );

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS p_commercial_select_%I ON public.%I',r.table_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY p_commercial_select_%I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L))))',
      r.table_name,r.table_name,v_module
    );

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS p_commercial_insert_%I ON public.%I',r.table_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY p_commercial_insert_%I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L)))',
      r.table_name,r.table_name,v_module
    );

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS p_commercial_update_%I ON public.%I',r.table_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY p_commercial_update_%I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L))) WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L)))',
      r.table_name,r.table_name,v_module,v_module
    );

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS p_commercial_delete_%I ON public.%I',r.table_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY p_commercial_delete_%I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L)))',
      r.table_name,r.table_name,v_module
    );
  END LOOP;
END
$commercial_guards$;
