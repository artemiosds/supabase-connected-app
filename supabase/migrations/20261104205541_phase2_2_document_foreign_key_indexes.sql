-- Cover foreign-key columns to avoid full scans during referenced-row changes.
CREATE INDEX IF NOT EXISTS idx_document_templates_created_by ON public.document_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_document_templates_updated_by ON public.document_templates(updated_by);
CREATE INDEX IF NOT EXISTS idx_generated_documents_created_by ON public.generated_documents(created_by);
CREATE INDEX IF NOT EXISTS idx_generated_documents_signed_by ON public.generated_documents(signed_by);
CREATE INDEX IF NOT EXISTS idx_generated_documents_supplier_id ON public.generated_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_template_id ON public.generated_documents(template_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_updated_by ON public.generated_documents(updated_by);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_created_by ON public.supplier_documents(created_by);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_supplier_id ON public.supplier_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_updated_by ON public.supplier_documents(updated_by);
