BEGIN;

-- Revalidate the legal prerequisites whenever the generated draft's
-- tenant/process/contract/template relationship or its actual content changes.
-- Status-only and unrelated metadata updates remain unaffected.
DROP TRIGGER IF EXISTS trg_guard_generated_documents_renewal_addendum
  ON public.generated_documents;

CREATE TRIGGER trg_guard_generated_documents_renewal_addendum
  BEFORE INSERT OR UPDATE OF
    tenant_id,
    process_id,
    document_type,
    contract_id,
    template_id,
    variables_snapshot,
    content_snapshot
  ON public.generated_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_contract_renewal_addendum();

COMMIT;
