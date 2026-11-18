-- Registro mínimo e privado de providência iniciada para renovação contratual.
-- Somente usuários municipais com documents:update podem registrar; dados sempre vinculados ao tenant.
CREATE TABLE public.contract_renewal_followups (
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status = 'in_progress'),
  started_by uuid NOT NULL REFERENCES auth.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, contract_id),
  CONSTRAINT contract_renewal_followups_contract_fk FOREIGN KEY (tenant_id, contract_id)
    REFERENCES public.contracts(tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE public.contract_renewal_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_renewal_followups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_renewal_followups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.contract_renewal_followups TO authenticated;

CREATE POLICY contract_renewal_followups_select
  ON public.contract_renewal_followups FOR SELECT TO authenticated
  USING (
    app_auth.has_tenant_data_permission(tenant_id, 'documents:view')
    OR app_auth.is_platform_admin()
  );

CREATE POLICY contract_renewal_followups_insert
  ON public.contract_renewal_followups FOR INSERT TO authenticated
  WITH CHECK (
    started_by = (select auth.uid())
    AND app_auth.has_tenant_data_permission(tenant_id, 'documents:update')
    AND app_auth.is_tenant_in_good_standing(tenant_id)
    AND app_auth.is_tenant_module_enabled(tenant_id, 'contratos')
    AND EXISTS (
      SELECT 1 FROM public.contracts c
       WHERE c.tenant_id = tenant_id AND c.id = contract_id AND c.status = 'vigente'
    )
  );
