BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.fn_guard_procurement_process_transition()') IS NOT NULL,
  'procurement process transition guard is installed'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.procurement_processes'::regclass
      AND tgname='trg_guard_procurement_process_transition'
      AND NOT tgisinternal
      AND (tgtype & 2) = 2
      AND (tgtype & 16) = 16
  ),
  'transition guard runs before updates to procurement processes'
);
SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid='public.fn_guard_procurement_process_transition()'::regprocedure),
  'transition guard is a fixed-search-path security definer'
);
SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.fn_guard_procurement_process_transition()',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.fn_guard_procurement_process_transition()',
    'EXECUTE'
  ),
  'clients cannot call the trigger function directly'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%planejamento%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%estudos%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%objeto%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%pesquisa%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%parecer%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%conclusao%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%publicacao%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%julgamento%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%assinatura%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%fiscalizacao%',
  'guard recognizes all ten procurement stages'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%abs(v_new_position - v_old_position) <> 1%',
  'stage changes are limited to one adjacent step forward or backward'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%v_new_position > v_old_position%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%i.stage = OLD.stage%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%i.is_done = false%',
  'advancing a stage requires every current-stage checklist item to be complete'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%NEW.status = ''concluido''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%NEW.stage <> ''fiscalizacao''%',
  'process completion is restricted to the final inspection and execution stage'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%i.process_id = OLD.id%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%i.tenant_id = OLD.tenant_id%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%Conclua todos os itens do checklist%',
  'process completion checks every outstanding checklist item within the same tenant'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%NEW.tenant_id IS DISTINCT FROM OLD.tenant_id%',
  'a procurement process cannot be moved to another tenant'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.procurement_processes'::regclass
      AND conname='procurement_processes_stage_check'
      AND contype='c'
  ),
  'the ten-stage constraint remains enforced by the table'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public'
      AND indexname='process_items_open_due_date_idx'
  ),
  'open checklist deadlines have a supporting tenant-scoped index'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.create_procurement_process_with_checklist(uuid,text,text,text,text,text,text,text,numeric,date)'::regprocedure
  ) LIKE '%INSERT INTO public.process_items%'
  AND pg_catalog.pg_get_functiondef(
    'public.create_procurement_process_with_checklist(uuid,text,text,text,text,text,text,text,numeric,date)'::regprocedure
  ) LIKE '%v_actor%',
  'process creation continues to create its standard checklist atomically'
);


SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.process_items'::regclass
      AND tgname='trg_guard_procurement_process_item_completion'
      AND NOT tgisinternal
      AND (tgtype & 2) = 2
      AND (tgtype & 16) = 16
  ),
  'checklist completion guard runs before item completion updates'
);
SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid='public.fn_guard_procurement_process_item_completion()'::regprocedure)
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.fn_guard_procurement_process_item_completion()',
    'EXECUTE'
  ),
  'checklist guard uses fixed-search-path definer privileges and is not client callable'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%FOR UPDATE%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%NEW.is_done = false%',
  'checklist edits serialize on the parent process before reopening completed items'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%v_process_status = ''concluido''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%array_position(v_stages, NEW.stage)%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%array_position(v_stages, v_process_stage)%',
  'completed processes and checklist items from earlier stages cannot be reopened'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%OLD.status = ''concluido''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%NEW.status IS DISTINCT FROM OLD.status%',
  'a completed process cannot be reopened or moved to another stage'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.process_items'::regclass
      AND tgname='trg_guard_procurement_process_item_completion'
      AND NOT tgisinternal
      AND (tgtype & 2) = 2
      AND (tgtype & 4) = 4
      AND (tgtype & 16) = 16
  ),
  'checklist guard covers both inserts and updates'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%TG_OP = ''INSERT''%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%Não é permitido adicionar pendências em etapas já superadas%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%Não é permitido alterar itens de um processo concluído%',
  'checklist insert and update guards preserve completed and previously passed stages'
);
SELECT * FROM extensions.finish();
ROLLBACK;
