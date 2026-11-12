BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(28);

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


SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_items'::regclass
      AND conname='contract_items_contract_fk' AND contype='f'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_item_movements'::regclass
      AND conname='contract_item_movements_item_fk' AND contype='f'
  ),
  'contract item and movement foreign keys preserve tenant ownership'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_item_movements'::regclass
      AND conname='contract_item_movements_reversal_fk' AND contype='f'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_item_movements'::regclass
      AND conname='contract_item_movements_reversal_shape_check'
  ),
  'reversals are constrained to a movement in the same tenant and correct shape'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='contract_items'
      AND policyname='p_commercial_select_contract_items'
      AND permissive='RESTRICTIVE'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='contract_item_movements'
      AND policyname='p_commercial_select_contract_item_movements'
      AND permissive='RESTRICTIVE'
  ),
  'reads are additionally restricted to active tenants with the contracts module'
);
SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid='public.fn_validate_contract_item_movement()'::regprocedure)
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid='public.fn_guard_contract_item_write()'::regprocedure),
  'ledger and item integrity triggers use fixed-search-path definer functions'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)'::regprocedure
  ) LIKE '%FOR UPDATE OF i, c%'
  AND pg_catalog.pg_get_functiondef(
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)'::regprocedure
  ) LIKE '%p_quantity > v_total - v_consumed%'
  AND pg_catalog.pg_get_functiondef(
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)'::regprocedure
  ) LIKE '%v_status <> ''vigente''%',
  'consumption locks item and contract and checks instrument status and available balance'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)'::regprocedure
  ) LIKE '%p_quantity::text = ''NaN''%'
  AND pg_catalog.pg_get_functiondef(
    'public.record_contract_item_consumption(uuid,uuid,numeric,text,text)'::regprocedure
  ) LIKE '%round(p_quantity, 4)%',
  'consumption rejects NaN, non-positive quantities and excess decimal precision'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.reverse_contract_item_consumption(uuid,uuid,text)'::regprocedure
  ) LIKE '%m.movement_type = ''consumption''%'
  AND pg_catalog.pg_get_functiondef(
    'public.reverse_contract_item_consumption(uuid,uuid,text)'::regprocedure
  ) LIKE '%Este consumo já foi estornado%'
  AND pg_catalog.pg_get_functiondef(
    'public.reverse_contract_item_consumption(uuid,uuid,text)'::regprocedure
  ) LIKE '%FOR UPDATE OF i%',
  'reversal is limited to an original consumption and serializes against other item movements'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.contract_item_movements'::regclass
      AND tgname='trg_deny_contract_item_movement_mutation' AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.contract_item_movements'::regclass
      AND tgname='trg_audit_contract_item_movement' AND NOT tgisinternal
  ),
  'movement ledger rejects updates/deletes and audits every insertion'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_item_write()'::regprocedure
  ) LIKE '%NEW.quantity_total < v_used_quantity%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_item_write()'::regprocedure
  ) LIKE '%valor unitário não pode ser alterado após a primeira movimentação%',
  'item edits cannot reduce consumed quantity or rewrite historical unit price'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_total_against_items()'::regprocedure
  ) LIKE '%NEW.total_value < v_items_total%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_contract_instrument_type()'::regprocedure
  ) LIKE '%não pode ser alterado depois do cadastro de itens%',
  'instrument value and contract-versus-ARP type remain consistent with registered items'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_items'::regclass
      AND conname='contract_items_quantity_check'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_items'::regclass
      AND conname='contract_items_unit_value_check'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contract_item_movements'::regclass
      AND conname='contract_item_movements_reason_check'
  ),
  'database constraints validate positive quantities, non-negative values and justified movements'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);
SELECT extensions.throws_ok(
  $test$SELECT public.record_contract_item_consumption(
    '00000000-0000-4000-8000-000000000021'::uuid,
    '00000000-0000-4000-8000-000000000022'::uuid,
    1, 'Consumo de teste', NULL
  )$test$,
  '42501',
  'Sessão autenticada obrigatória.',
  'consumption RPC rejects a request without an authenticated identity'
);
SELECT extensions.throws_ok(
  $test$SELECT public.reverse_contract_item_consumption(
    '00000000-0000-4000-8000-000000000023'::uuid,
    '00000000-0000-4000-8000-000000000024'::uuid,
    'Estorno de teste'
  )$test$,
  '42501',
  'Sessão autenticada obrigatória.',
  'reversal RPC rejects a request without an authenticated identity'
);
SELECT * FROM extensions.finish();
ROLLBACK;
