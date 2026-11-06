-- Permite que o backoffice Master liste e edite dados institucionais/comerciais de tenants.
-- Não concede INSERT/UPDATE/DELETE nas tabelas operacionais dos clientes.
DROP POLICY IF EXISTS p_tenants_master_support_select ON public.tenants;
CREATE POLICY p_tenants_master_support_select
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING ((SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_tenants_master_commercial_update ON public.tenants;
CREATE POLICY p_tenants_master_commercial_update
  ON public.tenants
  FOR UPDATE
  TO authenticated
  USING ((SELECT app_auth.is_platform_admin()))
  WITH CHECK ((SELECT app_auth.is_platform_admin()));

COMMENT ON POLICY p_tenants_master_support_select ON public.tenants IS
  'Permite leitura global de cadastro institucional e comercial somente a administradores globais ativos.';
COMMENT ON POLICY p_tenants_master_commercial_update ON public.tenants IS
  'Permite alterações de cadastro institucional e comercial somente a administradores globais ativos; fn_protect_tenant_fields preserva os campos protegidos.';