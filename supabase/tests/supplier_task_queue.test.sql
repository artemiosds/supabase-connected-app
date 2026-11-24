BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);

-- 1. supplier_pending_tasks RLS
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_pending_tasks'::regclass
      AND c.relrowsecurity
  ),
  'supplier_pending_tasks enables row-level security'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_pending_tasks'::regclass
      AND c.relforcerowsecurity
  ),
  'supplier_pending_tasks forces row-level security'
);

-- 2. No physical delete on pending tasks for authenticated
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_pending_tasks', 'DELETE'),
  'authenticated users cannot physically delete supplier_pending_tasks'
);

-- 3. Unique composite constraint for tenant isolation
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_pending_tasks'::regclass
      AND conname = 'ux_supplier_pending_tasks_tid_id'
      AND contype = 'u'
  ),
  'supplier_pending_tasks has unique tenant isolation constraint'
);

-- 4. Foreign key to suppliers
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_pending_tasks'::regclass
      AND contype = 'f'
      AND confrelid = 'public.suppliers'::regclass
  ),
  'supplier_pending_tasks references suppliers'
);

-- 5. Foreign key to tenants
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_pending_tasks'::regclass
      AND contype = 'f'
      AND confrelid = 'public.tenants'::regclass
  ),
  'supplier_pending_tasks references tenants'
);

-- 6. RPC functions exist
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.proname = 'create_supplier_task'
  ),
  'function create_supplier_task exists'
);

SELECT * FROM extensions.finish();
ROLLBACK;
