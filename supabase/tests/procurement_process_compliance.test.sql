BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.procurement_process_compliance') IS NOT NULL,
  'each procurement process has a dedicated legal and funding compliance record'
);

SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid='public.procurement_process_compliance'::regclass),
  'process compliance enforces row-level security and FORCE ROW LEVEL SECURITY'
);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='procurement_process_compliance' AND policyname='p_procurement_process_compliance_read' AND cmd='SELECT')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='procurement_process_compliance' AND policyname='p_procurement_process_compliance_insert' AND cmd='INSERT')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='procurement_process_compliance' AND policyname='p_procurement_process_compliance_update' AND cmd='UPDATE'),
  'read and legal-validation policies are separated by operation and tenant permission'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.procurement_process_compliance'::regclass
      AND tgname='trg_guard_procurement_process_compliance'
      AND NOT tgisinternal
      AND (tgtype & 2)=2
      AND (tgtype & 4)=4
      AND (tgtype & 16)=16
  ),
  'the process compliance guard runs before inserts and updates'
);

SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid='public.fn_guard_procurement_process_compliance()'::regprocedure),
  'the process compliance guard is a fixed-search-path SECURITY DEFINER'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege('authenticated','public.fn_guard_procurement_process_compliance()','EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon','public.fn_guard_procurement_process_compliance()','EXECUTE'),
  'clients cannot call the process compliance trigger function directly'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_process_compliance'::regclass
      AND conname='procurement_process_compliance_process_fk'
      AND contype='f'
      AND cardinality(conkey)=2
  ),
  'process compliance is bound to the same tenant and procurement process'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_process_compliance'::regclass
      AND conname='procurement_process_compliance_funding_source_check'
      AND contype='c'
  ),
  'funding source is restricted to the supported controlled values'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_process_compliance'::regclass
      AND conname='procurement_process_compliance_adoption_check'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_process_compliance'::regclass
      AND conname='procurement_process_compliance_nonapplicability_reason_check'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_process_compliance'::regclass
      AND conname='procurement_process_compliance_local_rule_check'
  ),
  'local adoption, local rules and non-applicability require explicit legal grounds'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_process_compliance'::regclass
      AND conname='procurement_process_compliance_validation_consistency'
  ),
  'validated status requires an authenticated validator and timestamp'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef('public.fn_capture_procurement_price_map_snapshot()'::regprocedure) LIKE '%public.procurement_process_compliance%'
  AND pg_catalog.pg_get_functiondef('public.fn_capture_procurement_price_map_snapshot()'::regprocedure) LIKE '%procurement_compliance%'
  AND pg_catalog.pg_get_functiondef('public.fn_capture_procurement_price_map_snapshot()'::regprocedure) LIKE '%tenant_procurement_compliance%',
  'the immutable price-map snapshot captures process-specific legal validation and the tenant baseline separately'
);

SELECT * FROM extensions.finish();
ROLLBACK;
