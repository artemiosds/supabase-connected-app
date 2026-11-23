BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);

-- 1. supplier_regularity_checks RLS
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_regularity_checks'::regclass
      AND c.relrowsecurity
  ),
  'supplier_regularity_checks enables row-level security'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_regularity_checks'::regclass
      AND c.relforcerowsecurity
  ),
  'supplier_regularity_checks forces row-level security'
);

-- 2. No physical delete on regularity checks for authenticated
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_regularity_checks', 'DELETE'),
  'authenticated users cannot physically delete supplier_regularity_checks'
);

-- 3. Unique composite constraint for tenant isolation
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_regularity_checks'::regclass
      AND conname = 'ux_supplier_regularity_tenant_id_id'
      AND contype = 'u'
  ),
  'supplier_regularity_checks has unique tenant isolation constraint'
);

-- 4. Foreign key to suppliers
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_regularity_checks'::regclass
      AND contype = 'f'
      AND confrelid = 'public.suppliers'::regclass
  ),
  'supplier_regularity_checks references suppliers'
);

-- 5. RPC function exists with security definer and empty search_path
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE proname = 'record_supplier_regularity_check'
      AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  ),
  'record_supplier_regularity_check is security definer with empty search path'
);

-- 6. Trigger for updated_at exists
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.supplier_regularity_checks'::regclass
      AND tgname = 'trg_supplier_regularity_updated_at'
  ),
  'trigger trg_supplier_regularity_updated_at exists on supplier_regularity_checks'
);

SELECT * FROM extensions.finish();
ROLLBACK;
