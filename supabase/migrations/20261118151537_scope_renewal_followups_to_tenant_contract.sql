-- Explicitly correlate the referenced contract to the tenant of the follow-up.
ALTER POLICY contract_renewal_followups_insert
ON public.contract_renewal_followups
WITH CHECK (
  started_by = (SELECT auth.uid())
  AND app_auth.has_tenant_data_permission(tenant_id, 'documents:update')
  AND app_auth.is_tenant_in_good_standing(tenant_id)
  AND app_auth.is_tenant_module_enabled(tenant_id, 'contratos')
  AND EXISTS (
    SELECT 1
    FROM public.contracts c
    WHERE c.tenant_id = contract_renewal_followups.tenant_id
      AND c.id = contract_renewal_followups.contract_id
      AND c.status = 'vigente'
  )
);
