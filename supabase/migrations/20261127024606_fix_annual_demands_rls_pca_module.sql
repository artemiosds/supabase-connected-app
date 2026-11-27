-- Corrige policy annual_demands_read: modulo 'processos' -> 'pca' (Decreto 10.947/2022)
-- Usa ALTER POLICY para nao precisar de DROP
ALTER POLICY annual_demands_read
  ON public.annual_procurement_demands
  USING (
    app_auth.has_tenant_data_permission(tenant_id, 'documents:view')
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id, 'pca')
  );
