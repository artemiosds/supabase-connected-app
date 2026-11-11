BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.contract_items') IS NOT NULL,
  'contract item table is installed'
);
SELECT extensions.ok(
  pg_catalog.to_regclass('public.contract_item_movements') IS NOT NULL,
  'contract item movement ledger is installed'
);
SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.contract_items'::regclass),
  'contract items force row level security'
);
SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.contract_item_movements'::regclass),
  'contract movements force row level security'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'contract_items'
      AND policyname = 'p_contract_items_select' AND cmd = 'SELECT'
  ),
  'contract items have an explicit tenant read policy'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'contract_item_movements'
      AND policyname = 'p_contract_item_movements_select' AND cmd = 'SELECT'
  ),
  'movement ledger has an explicit tenant read policy'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'contract_items'
      AND policyname = 'p_commercial_insert_contract_items' AND permissive = 'RESTRICTIVE'
  ),
  'contract item writes require an enabled commercial module'
);
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.contract_item_movements', 'INSERT'),
  'authenticated cannot insert ledger rows directly'
);
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.contract_item_movements', 'UPDATE'),
  'authenticated cannot rewrite ledger rows'
);
SELECT extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.contract_item_movements', 'SELECT'),
  'authenticated can read authorized ledger rows'
);
SELECT extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ),
  'authenticated can record consumption through the validated RPC'
);
SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'anon',
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ),
  'anonymous users cannot record consumption'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)'::regprocedure),
  'consumption RPC is security definer with an empty search path'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.reverse_contract_item_consumption(uuid,uuid,text)'::regprocedure),
  'reversal RPC is security definer with an empty search path'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND indexname = 'contract_item_movements_single_reversal_idx'
  ),
  'a consumption can be reversed at most once'
);

SELECT * FROM extensions.finish();
ROLLBACK;
