BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

-- 1. supplier_portal_tokens RLS
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_portal_tokens'::regclass
      AND c.relrowsecurity
  ),
  'supplier_portal_tokens enables row-level security'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_portal_tokens'::regclass
      AND c.relforcerowsecurity
  ),
  'supplier_portal_tokens forces row-level security'
);

-- 2. No physical delete on portal tokens for authenticated
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_portal_tokens', 'DELETE'),
  'authenticated users cannot physically delete supplier_portal_tokens'
);

-- 3. Unique token index
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE tablename = 'supplier_portal_tokens'
      AND indexname = 'idx_supplier_portal_tokens_token'
  ),
  'supplier_portal_tokens has unique active token index'
);

-- 4. RPC generate_supplier_portal_token exists
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.proname = 'generate_supplier_portal_token'
  ),
  'function generate_supplier_portal_token exists'
);

-- 5. RPC get_supplier_portal_data exists
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.proname = 'get_supplier_portal_data'
  ),
  'function get_supplier_portal_data exists'
);

SELECT * FROM extensions.finish();
ROLLBACK;
