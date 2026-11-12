-- Regression: every newly identified FK path has an explicit supporting index.
-- Run only with the complete disposable local Supabase migration set.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND tablename='contract_item_movements'
      AND indexname='idx_contract_item_movements_created_by'
      AND indexdef ILIKE '%(created_by)%'
  ),
  'contract item movement creator FK is indexed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND tablename='contract_items'
      AND indexname='idx_contract_items_created_by'
      AND indexdef ILIKE '%(created_by)%'
  ),
  'contract item creator FK is indexed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND tablename='contract_items'
      AND indexname='idx_contract_items_updated_by'
      AND indexdef ILIKE '%(updated_by)%'
  ),
  'contract item updater FK is indexed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND tablename='generated_documents'
      AND indexname='idx_generated_documents_template_tenant'
      AND indexdef ILIKE '%(template_id, tenant_id)%'
  ),
  'generated document composite template/tenant FK is indexed in key order'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND tablename='supplier_sanctions'
      AND indexname='idx_supplier_sanctions_created_by'
      AND indexdef ILIKE '%(created_by)%'
  ),
  'supplier sanction creator FK is indexed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND tablename='supplier_sanctions'
      AND indexname='idx_supplier_sanctions_updated_by'
      AND indexdef ILIKE '%(updated_by)%'
  ),
  'supplier sanction updater FK is indexed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
