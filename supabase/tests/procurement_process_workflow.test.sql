BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(33);

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

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%NEW.id IS DISTINCT FROM OLD.id%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_transition()'::regprocedure
  ) LIKE '%NEW.tenant_id IS DISTINCT FROM OLD.tenant_id%',
  'a process cannot change its identity or owning tenant'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%NEW.id IS DISTINCT FROM OLD.id%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%NEW.process_id IS DISTINCT FROM OLD.process_id%'
  AND pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%NEW.tenant_id IS DISTINCT FROM OLD.tenant_id%',
  'a checklist row cannot be moved across processes or tenants'
);
SELECT extensions.ok(
  pg_catalog.pg_get_triggerdef(
    (SELECT oid FROM pg_catalog.pg_trigger
     WHERE tgrelid='public.procurement_processes'::regclass
       AND tgname='trg_guard_procurement_process_transition')
  ) LIKE '%UPDATE OF id, tenant_id, stage, status%',
  'process identity changes also invoke the transition guard'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.fn_guard_procurement_process_item_completion()'::regprocedure
  ) LIKE '%NEW.stage IS DISTINCT FROM OLD.stage%',
  'a checklist item cannot be moved to another stage after creation'
);
-- Behavioral fixtures: isolated synthetic identities and tenant are rolled back
-- with this test transaction. They never reach SMS2 or any shared environment.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data
)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'procurement-workflow-fixture@example.invalid',
  '',
  '{}'::jsonb,
  '{"full_name":"Fixture de Teste"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, name, slug, created_by, status)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  'Secretaria Fixture',
  'secretaria-fixture-workflow',
  '10000000-0000-4000-8000-000000000001',
  'active'
);

INSERT INTO public.procurement_processes (
  id, tenant_id, number, title, stage, status, created_by, updated_by
)
VALUES (
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  'TESTE-WORKFLOW-001',
  'Processo sintético para regressão de etapas',
  'planejamento',
  'em_andamento',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

INSERT INTO public.process_items (
  id, tenant_id, process_id, stage, title, created_by, updated_by
)
VALUES (
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  'planejamento',
  'Checklist sintético pendente',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.procurement_processes
    SET stage = 'estudos'
    WHERE id = '10000000-0000-4000-8000-000000000003'$test$,
  '23514',
  'Conclua todos os itens da etapa atual antes de avançar.',
  'a process cannot advance while its current-stage checklist is pending'
);

UPDATE public.process_items
SET is_done = true
WHERE id = '10000000-0000-4000-8000-000000000004';

UPDATE public.procurement_processes
SET stage = 'estudos'
WHERE id = '10000000-0000-4000-8000-000000000003';

SELECT extensions.ok(
  (SELECT stage = 'estudos'
   FROM public.procurement_processes
   WHERE id = '10000000-0000-4000-8000-000000000003'),
  'a process advances one stage after its current checklist is complete'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.procurement_processes
    SET stage = 'objeto'
    WHERE id = '10000000-0000-4000-8000-000000000003'$test$,
  '23514',
  'O processo deve avançar ou retornar uma etapa por vez.',
  'a process cannot skip an intermediate stage'
);

SELECT extensions.throws_ok(
  $test$INSERT INTO public.process_items (
    tenant_id, process_id, stage, title, created_by, updated_by
  ) VALUES (
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    'planejamento',
    'Pendência retroativa',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  )$test$,
  '23514',
  'Não é permitido adicionar pendências em etapas já superadas.',
  'a process cannot receive a new checklist item in a completed earlier stage'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.process_items
    SET stage = 'estudos'
    WHERE id = '10000000-0000-4000-8000-000000000004'$test$,
  '23514',
  'A identidade, a etapa e o vínculo da tarefa do checklist são imutáveis.',
  'an existing checklist item cannot be moved to another stage'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.procurement_processes
    SET tenant_id = '10000000-0000-4000-8000-000000000099'
    WHERE id = '10000000-0000-4000-8000-000000000003'$test$,
  '23514',
  'A identidade e a Secretaria vinculada ao processo não podem ser alteradas.',
  'a process cannot be transferred to another tenant'
);

UPDATE public.procurement_processes
SET stage = 'objeto'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'pesquisa'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'parecer'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'conclusao'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'publicacao'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'julgamento'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'assinatura'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET stage = 'fiscalizacao'
WHERE id = '10000000-0000-4000-8000-000000000003';
UPDATE public.procurement_processes
SET status = 'concluido'
WHERE id = '10000000-0000-4000-8000-000000000003';

SELECT extensions.ok(
  (SELECT stage = 'fiscalizacao' AND status = 'concluido'
   FROM public.procurement_processes
   WHERE id = '10000000-0000-4000-8000-000000000003'),
  'a process can be completed only after reaching the final stage with all checklist items done'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.procurement_processes
    SET status = 'em_andamento'
    WHERE id = '10000000-0000-4000-8000-000000000003'$test$,
  '23514',
  'Um processo concluído não pode ser reaberto nem ter sua etapa alterada.',
  'a completed process cannot be reopened'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.process_items
    SET is_done = false
    WHERE id = '10000000-0000-4000-8000-000000000004'$test$,
  '23514',
  'Não é permitido alterar itens de um processo concluído.',
  'checklist items of a completed process are immutable'
);

SELECT * FROM extensions.finish();
ROLLBACK;
