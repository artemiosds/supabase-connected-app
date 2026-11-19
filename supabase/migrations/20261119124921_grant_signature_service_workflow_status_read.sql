BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- The trusted signature Edge Function checks the document's current approval
-- status before processing the PDF. Grant only the columns used by its scoped
-- query; the existing authenticated policies and workflow write guards stay intact.
GRANT SELECT (tenant_id, document_id, status)
  ON public.generated_document_workflows TO service_role;

COMMIT;
