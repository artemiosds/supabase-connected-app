-- Enforce procurement stage progression and completion in the database,
-- so direct API calls cannot bypass the UI checklist checks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_process_item_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_process_stage text;
  v_process_status text;
  v_stages text[] := ARRAY[
    'planejamento','estudos','objeto','pesquisa','parecer',
    'conclusao','publicacao','julgamento','assinatura','fiscalizacao'
  ];
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.process_id IS DISTINCT FROM OLD.process_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
     ) THEN
    RAISE EXCEPTION 'A identidade e o vínculo da tarefa do checklist são imutáveis.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT p.stage, p.status
      INTO v_process_stage, v_process_status
    FROM public.procurement_processes p
    WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.process_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Processo vinculado ao item não encontrado nesta Secretaria.'
        USING ERRCODE = '23514';
    END IF;
    IF v_process_status = 'concluido' THEN
      RAISE EXCEPTION 'Não é permitido adicionar itens a um processo concluído.'
        USING ERRCODE = '23514';
    END IF;
    IF pg_catalog.array_position(v_stages, NEW.stage)
       < pg_catalog.array_position(v_stages, v_process_stage) THEN
      RAISE EXCEPTION 'Não é permitido adicionar pendências em etapas já superadas.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.stage, p.status
    INTO v_process_stage, v_process_status
  FROM public.procurement_processes p
  WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.process_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processo vinculado ao item não encontrado nesta Secretaria.'
      USING ERRCODE = '23514';
  END IF;
  IF v_process_status = 'concluido' THEN
    RAISE EXCEPTION 'Não é permitido alterar itens de um processo concluído.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_done IS DISTINCT FROM OLD.is_done AND NEW.is_done = false
     AND pg_catalog.array_position(v_stages, NEW.stage)
         < pg_catalog.array_position(v_stages, v_process_stage) THEN
    RAISE EXCEPTION 'Retorne o processo à etapa correspondente antes de reabrir um item anterior.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_procurement_process_item_completion()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_procurement_process_item_completion
  ON public.process_items;
CREATE TRIGGER trg_guard_procurement_process_item_completion
  BEFORE INSERT OR UPDATE
  ON public.process_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_procurement_process_item_completion();

COMMENT ON FUNCTION public.fn_guard_procurement_process_item_completion() IS
  'Serializa inclusões/edições do checklist com a etapa do processo e protege processos concluídos e etapas superadas.';

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_process_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_stages text[] := ARRAY[
    'planejamento',
    'estudos',
    'objeto',
    'pesquisa',
    'parecer',
    'conclusao',
    'publicacao',
    'julgamento',
    'assinatura',
    'fiscalizacao'
  ];
  v_old_position integer;
  v_new_position integer;
BEGIN
  IF OLD.status = 'concluido'
     AND (NEW.stage IS DISTINCT FROM OLD.stage OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Um processo concluído não pode ser reaberto nem ter sua etapa alterada.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A identidade e a Secretaria vinculada ao processo não podem ser alteradas.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    v_old_position := pg_catalog.array_position(v_stages, OLD.stage);
    v_new_position := pg_catalog.array_position(v_stages, NEW.stage);

    IF v_old_position IS NULL OR v_new_position IS NULL
       OR pg_catalog.abs(v_new_position - v_old_position) <> 1 THEN
      RAISE EXCEPTION 'O processo deve avançar ou retornar uma etapa por vez.'
        USING ERRCODE = '23514';
    END IF;

    IF v_new_position > v_old_position
       AND EXISTS (
         SELECT 1
         FROM public.process_items i
         WHERE i.tenant_id = OLD.tenant_id
           AND i.process_id = OLD.id
           AND i.stage = OLD.stage
           AND i.is_done = false
       ) THEN
      RAISE EXCEPTION 'Conclua todos os itens da etapa atual antes de avançar.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    IF NEW.stage <> 'fiscalizacao' THEN
      RAISE EXCEPTION 'O processo só pode ser concluído após a etapa de fiscalização e execução.'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.process_items i
      WHERE i.tenant_id = OLD.tenant_id
        AND i.process_id = OLD.id
        AND i.is_done = false
    ) THEN
      RAISE EXCEPTION 'Conclua todos os itens do checklist antes de finalizar o processo.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_procurement_process_transition()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_procurement_process_transition
  ON public.procurement_processes;
CREATE TRIGGER trg_guard_procurement_process_transition
  BEFORE UPDATE OF tenant_id, stage, status
  ON public.procurement_processes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_procurement_process_transition();

COMMENT ON FUNCTION public.fn_guard_procurement_process_transition() IS
  'Impede mudança de Secretaria, salto de etapas e conclusão de processo com checklist pendente.';

COMMIT;
