-- Complete tenant-preserving links after procurement child tables exist.
-- Also restore the amendment trigger that applies validated changes atomically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $constraints$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.procurement_items'::regclass AND conname='procurement_items_process_tenant_fk') THEN
  ALTER TABLE public.procurement_items ADD CONSTRAINT procurement_items_process_tenant_fk
   FOREIGN KEY (tenant_id,process_id) REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.procurement_budget_allocations'::regclass AND conname='procurement_budget_allocations_process_tenant_fk') THEN
  ALTER TABLE public.procurement_budget_allocations ADD CONSTRAINT procurement_budget_allocations_process_tenant_fk
   FOREIGN KEY (tenant_id,process_id) REFERENCES public.procurement_processes(tenant_id,id) ON DELETE RESTRICT;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.generated_documents'::regclass AND conname='generated_documents_process_tenant_fk') THEN
  ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_process_tenant_fk
   FOREIGN KEY (process_id,tenant_id) REFERENCES public.procurement_processes(id,tenant_id) ON DELETE RESTRICT;
 END IF;
END
$constraints$;

DROP TRIGGER IF EXISTS trg_apply_contract_amendment ON public.contract_amendments;
CREATE TRIGGER trg_apply_contract_amendment
 AFTER INSERT ON public.contract_amendments
 FOR EACH ROW EXECUTE FUNCTION public.fn_apply_contract_amendment();

COMMIT;
