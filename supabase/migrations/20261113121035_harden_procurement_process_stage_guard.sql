-- Close direct-API gaps in process identity and checklist stage immutability.
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
       OR NEW.stage IS DISTINCT FROM OLD.stage
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
     ) THEN
    RAISE EXCEPTION 'A identidade, a etapa e o vínculo da tarefa do checklist são imutáveis.'
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

COMMENT ON FUNCTION public.fn_guard_procurement_process_item_completion() IS
  'Serializa inclusões/edições do checklist com a etapa do processo e protege identidade, etapa, processos concluídos e etapas superadas.';

DROP TRIGGER IF EXISTS trg_guard_procurement_process_transition
  ON public.procurement_processes;
CREATE TRIGGER trg_guard_procurement_process_transition
  BEFORE UPDATE OF id, tenant_id, stage, status
  ON public.procurement_processes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_procurement_process_transition();

COMMENT ON TRIGGER trg_guard_procurement_process_transition
  ON public.procurement_processes IS
  'Executa a validação de identidade e transição antes de mudanças de ID, Secretaria, etapa ou status.';

COMMIT;
