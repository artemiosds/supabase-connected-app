-- Correct the indexes added with the document workflow.
-- The quote-contract foreign key already references uq_contract_tenant_id,
-- so the second unique index is redundant.
BEGIN;
SET LOCAL lock_timeout='5s';
DROP INDEX IF EXISTS public.uq_contracts_tenant_id_id;

CREATE INDEX IF NOT EXISTS ix_document_workflows_submitted_by
  ON public.generated_document_workflows(submitted_by)
  WHERE submitted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_document_workflows_decided_by
  ON public.generated_document_workflows(decided_by)
  WHERE decided_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_document_workflow_events_actor_id
  ON public.generated_document_workflow_events(actor_id)
  WHERE actor_id IS NOT NULL;
COMMIT;