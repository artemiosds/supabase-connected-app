BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_sanctions'::regclass
      AND c.relrowsecurity
  ),
  'sanction history enables row-level security'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_sanctions'::regclass
      AND c.relforcerowsecurity
  ),
  'sanction history forces row-level security'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'supplier_sanctions'),
  3,
  'sanction history has explicit select, insert, and update policies'
);
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_sanctions', 'DELETE'),
  'authenticated users cannot physically delete sanctions'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_sanctions'::regclass
      AND conname = 'supplier_sanctions_tenant_supplier_fk'
      AND contype = 'f'
  ),
  'sanctions are constrained to a supplier in the same tenant'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.supplier_sanctions_supplier_period_idx') IS NOT NULL,
  'supplier history lookup has a supporting index'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.supplier_sanctions'::regclass
      AND tgname = 'trg_supplier_sanctions_audit'
      AND NOT tgisinternal
  ),
  'sanction changes are audited'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.fn_audit_supplier_sanction()'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  ),
  'audit trigger uses a fixed empty search path and definer privileges'
);
SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.fn_audit_supplier_sanction()',
    'EXECUTE'
  ),
  'authenticated users cannot call the audit trigger function directly'
);
SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.fn_protect_supplier_sanction_write()',
    'EXECUTE'
  ),
  'authenticated users cannot call the write-protection trigger function directly'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.supplier_sanctions'::regclass
      AND conname = 'supplier_sanctions_dates_check'
  ),
  'sanction period is validated in the database'
);

SELECT * FROM extensions.finish();
ROLLBACK;
