-- Fase D: Limpeza de índice duplicado e cobertura de índices em todas as 47 FKs apontadas pelos Advisors

DROP INDEX IF EXISTS public.ux_procurement_price_quotes_selected;

CREATE INDEX IF NOT EXISTS idx_apd_approved_by ON public.annual_procurement_demands (approved_by);
CREATE INDEX IF NOT EXISTS idx_apd_submitted_by ON public.annual_procurement_demands (submitted_by);
CREATE INDEX IF NOT EXISTS idx_apd_tenant_process ON public.annual_procurement_demands (tenant_id, process_id);

CREATE INDEX IF NOT EXISTS idx_cra_created_by ON public.contract_renewal_assessments (created_by);
CREATE INDEX IF NOT EXISTS idx_cra_updated_by ON public.contract_renewal_assessments (updated_by);

CREATE INDEX IF NOT EXISTS idx_crci_tenant_contract ON public.contract_renewal_checklist_items (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_crci_created_by ON public.contract_renewal_checklist_items (created_by);
CREATE INDEX IF NOT EXISTS idx_crci_updated_by ON public.contract_renewal_checklist_items (updated_by);

CREATE INDEX IF NOT EXISTS idx_crf_started_by ON public.contract_renewal_followups (started_by);

CREATE INDEX IF NOT EXISTS idx_pac_updated_by ON public.platform_ai_configuration (updated_by);
CREATE INDEX IF NOT EXISTS idx_pap_created_by ON public.platform_ai_providers (created_by);
CREATE INDEX IF NOT EXISTS idx_pap_updated_by ON public.platform_ai_providers (updated_by);
CREATE INDEX IF NOT EXISTS idx_patpa_provider_id ON public.platform_ai_tenant_provider_access (provider_id);
CREATE INDEX IF NOT EXISTS idx_patpa_updated_by ON public.platform_ai_tenant_provider_access (updated_by);
CREATE INDEX IF NOT EXISTS idx_pau_actor_id ON public.platform_ai_usage (actor_id);

CREATE INDEX IF NOT EXISTS idx_pi_created_by ON public.platform_invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_pi_updated_by ON public.platform_invoices (updated_by);
CREATE INDEX IF NOT EXISTS idx_pp_updated_by ON public.platform_plans (updated_by);
CREATE INDEX IF NOT EXISTS idx_pqr_updated_by ON public.procurement_quote_requests (updated_by);

CREATE INDEX IF NOT EXISTS idx_shci_document_id ON public.supplier_homologation_checklist_items (document_id);
CREATE INDEX IF NOT EXISTS idx_shci_homologation_id ON public.supplier_homologation_checklist_items (homologation_id);
CREATE INDEX IF NOT EXISTS idx_shci_verified_by ON public.supplier_homologation_checklist_items (verified_by);

CREATE INDEX IF NOT EXISTS idx_she_created_by ON public.supplier_homologation_events (created_by);
CREATE INDEX IF NOT EXISTS idx_she_homologation_id ON public.supplier_homologation_events (homologation_id);

CREATE INDEX IF NOT EXISTS idx_sh_assigned_to ON public.supplier_homologations (assigned_to);
CREATE INDEX IF NOT EXISTS idx_sh_concluded_by ON public.supplier_homologations (concluded_by);
CREATE INDEX IF NOT EXISTS idx_sh_created_by ON public.supplier_homologations (created_by);
CREATE INDEX IF NOT EXISTS idx_sh_process_id ON public.supplier_homologations (process_id);
CREATE INDEX IF NOT EXISTS idx_sh_supplier_id ON public.supplier_homologations (supplier_id);
CREATE INDEX IF NOT EXISTS idx_sh_updated_by ON public.supplier_homologations (updated_by);

CREATE INDEX IF NOT EXISTS idx_spt_assigned_to ON public.supplier_pending_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_spt_created_by ON public.supplier_pending_tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_spt_resolved_by ON public.supplier_pending_tasks (resolved_by);
CREATE INDEX IF NOT EXISTS idx_spt_supplier_id ON public.supplier_pending_tasks (supplier_id);

CREATE INDEX IF NOT EXISTS idx_sptok_created_by ON public.supplier_portal_tokens (created_by);
CREATE INDEX IF NOT EXISTS idx_sptok_homologation_id ON public.supplier_portal_tokens (homologation_id);
CREATE INDEX IF NOT EXISTS idx_sptok_supplier_id ON public.supplier_portal_tokens (supplier_id);

CREATE INDEX IF NOT EXISTS idx_src_created_by ON public.supplier_regularity_checks (created_by);
CREATE INDEX IF NOT EXISTS idx_src_supplier_id ON public.supplier_regularity_checks (supplier_id);

CREATE INDEX IF NOT EXISTS idx_tas_updated_by ON public.tenant_ai_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_tdos_actor_id ON public.tenant_drive_oauth_states (actor_id);
CREATE INDEX IF NOT EXISTS idx_tdos_tenant_id ON public.tenant_drive_oauth_states (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tdsj_created_by ON public.tenant_drive_sync_jobs (created_by);

CREATE INDEX IF NOT EXISTS idx_tis_retention_approved_by ON public.tenant_integration_settings (retention_approved_by);
CREATE INDEX IF NOT EXISTS idx_tis_updated_by ON public.tenant_integration_settings (updated_by);

CREATE INDEX IF NOT EXISTS idx_tpr_requester_user_id ON public.tenant_privacy_requests (requester_user_id);
CREATE INDEX IF NOT EXISTS idx_tpr_reviewed_by ON public.tenant_privacy_requests (reviewed_by);
