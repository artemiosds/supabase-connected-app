-- The primary SELECT policies already include the Master exception.
-- These extra permissive policies repeated only app_auth.is_platform_admin(),
-- so PostgreSQL OR-ed an identical predicate a second time. Removing them
-- keeps the effective authorization unchanged and clears duplicate-policy
-- advisor warnings. The restrictive commercial gates remain untouched.

DROP POLICY IF EXISTS p_master_support_read_contract_amendments
  ON public.contract_amendments;
DROP POLICY IF EXISTS p_master_support_read_contracts
  ON public.contracts;
DROP POLICY IF EXISTS p_master_support_read_document_templates
  ON public.document_templates;
DROP POLICY IF EXISTS p_master_support_read_generated_documents
  ON public.generated_documents;
DROP POLICY IF EXISTS p_master_support_read_process_items
  ON public.process_items;
DROP POLICY IF EXISTS p_master_support_read_procurement_processes
  ON public.procurement_processes;
DROP POLICY IF EXISTS p_master_support_read_supplier_documents
  ON public.supplier_documents;
