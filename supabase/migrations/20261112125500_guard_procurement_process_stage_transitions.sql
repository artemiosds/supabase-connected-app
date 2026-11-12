-- Enforce procurement stage progression and completion in the database,
-- so direct API calls cannot bypass the UI checklist checks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

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
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A Secretaria vinculada ao processo não pode ser alterada.'
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
