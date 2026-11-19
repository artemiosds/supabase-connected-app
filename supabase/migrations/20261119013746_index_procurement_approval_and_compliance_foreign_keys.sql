BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

CREATE INDEX IF NOT EXISTS ix_procurement_price_approvals_item_process_fk
  ON public.procurement_price_approvals(tenant_id,process_id,procurement_item_id);
CREATE INDEX IF NOT EXISTS ix_procurement_price_approvals_approved_by_fk
  ON public.procurement_price_approvals(approved_by);

CREATE INDEX IF NOT EXISTS ix_procurement_process_compliance_validated_by_fk
  ON public.procurement_process_compliance(validated_by);
CREATE INDEX IF NOT EXISTS ix_procurement_process_compliance_updated_by_fk
  ON public.procurement_process_compliance(updated_by);

CREATE INDEX IF NOT EXISTS ix_tenant_procurement_compliance_validated_by_fk
  ON public.tenant_procurement_compliance(validated_by);
CREATE INDEX IF NOT EXISTS ix_tenant_procurement_compliance_updated_by_fk
  ON public.tenant_procurement_compliance(updated_by);

COMMIT;
