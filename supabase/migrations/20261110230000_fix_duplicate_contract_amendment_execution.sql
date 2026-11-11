-- Remove the legacy duplicate trigger that applied every contract amendment twice.
-- Keep trg_apply_contract_amendment as the single canonical trigger.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER IF EXISTS trg_amend_apply ON public.contract_amendments;

DO $assert_single_trigger$
DECLARE
  v_trigger_count integer;
BEGIN
  SELECT count(*)
    INTO v_trigger_count
  FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid = 'public.contract_amendments'::regclass
    AND NOT t.tgisinternal
    AND t.tgfoid = 'public.fn_apply_contract_amendment()'::regprocedure;

  IF v_trigger_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.contract_amendments'::regclass
      AND t.tgname = 'trg_apply_contract_amendment'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'A aplicação de aditivos deve possuir exatamente um gatilho canônico.';
  END IF;
END
$assert_single_trigger$;

COMMIT;
