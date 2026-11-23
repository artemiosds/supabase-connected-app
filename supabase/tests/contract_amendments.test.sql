BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.contract_amendments') IS NOT NULL,
  'contract amendments table is installed'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.contract_amendments'::regclass
      AND NOT t.tgisinternal
      AND t.tgfoid = 'public.fn_apply_contract_amendment()'::regprocedure
  ),
  1,
  'exactly one canonical trigger applies amendment effects'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'contract_amendments'
      AND trigger_name = 'trg_apply_contract_amendment'
      AND action_timing = 'AFTER'
      AND event_manipulation = 'INSERT'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'contract_amendments'
      AND trigger_name = 'trg_amend_apply'
  ),
  'the legacy duplicate amendment trigger is absent'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%NEW.kind = ''prorrogacao''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%NEW.kind = ''acrescimo''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%NEW.kind = ''supressao''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%NEW.kind = ''outro''%',
  'all four amendment types have explicit database validation'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contract_amendments'
      AND column_name = 'signed_at'
      AND data_type = 'date'
      AND is_nullable = 'NO'
  ),
  'the signed date is required and stored as a calendar date'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%NEW.signed_at > CURRENT_DATE%',
  'future amendment signature dates are rejected by the database'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%v_items_total > v_contract_total + NEW.value_change%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_apply_contract_amendment()'::regprocedure
  ) LIKE '%Ajuste os itens antes do aditivo%',
  'a suppression cannot reduce contract value below the sum of its registered items'
);

SELECT * FROM extensions.finish();
ROLLBACK;
