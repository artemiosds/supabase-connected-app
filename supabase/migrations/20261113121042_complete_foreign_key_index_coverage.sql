-- Complete foreign-key index coverage identified by Supabase Performance Advisor.
-- Forward-only, additive indexes; no row data or existing authorization policy changes.
CREATE INDEX IF NOT EXISTS idx_contract_item_movements_created_by
  ON public.contract_item_movements(created_by);

CREATE INDEX IF NOT EXISTS idx_contract_items_created_by
  ON public.contract_items(created_by);

CREATE INDEX IF NOT EXISTS idx_contract_items_updated_by
  ON public.contract_items(updated_by);

CREATE INDEX IF NOT EXISTS idx_generated_documents_template_tenant
  ON public.generated_documents(template_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_supplier_sanctions_created_by
  ON public.supplier_sanctions(created_by);

CREATE INDEX IF NOT EXISTS idx_supplier_sanctions_updated_by
  ON public.supplier_sanctions(updated_by);
