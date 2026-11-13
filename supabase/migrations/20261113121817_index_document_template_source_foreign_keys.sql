-- Add supporting indexes for the four foreign keys introduced with
-- private DOCX source metadata and tenant document branding.
-- Additive only: no data or authorization policy changes.
CREATE INDEX IF NOT EXISTS idx_document_template_sources_created_by
  ON public.document_template_sources(created_by);

CREATE INDEX IF NOT EXISTS idx_document_template_sources_template_tenant
  ON public.document_template_sources(template_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_document_branding_created_by
  ON public.tenant_document_branding(created_by);

CREATE INDEX IF NOT EXISTS idx_tenant_document_branding_updated_by
  ON public.tenant_document_branding(updated_by);
