-- Add owner and deadline fields to workflow tasks and seed the complete ten stages.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.process_items
  ADD COLUMN IF NOT EXISTS responsible_name text,
  ADD COLUMN IF NOT EXISTS due_date date;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.process_items'::regclass
      AND conname = 'process_items_responsible_name_length_check'
  ) THEN
    ALTER TABLE public.process_items
      ADD CONSTRAINT process_items_responsible_name_length_check
      CHECK (responsible_name IS NULL OR char_length(btrim(responsible_name)) BETWEEN 1 AND 180);
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS process_items_open_due_date_idx
  ON public.process_items (tenant_id, due_date, process_id)
  WHERE due_date IS NOT NULL AND is_done = false;

COMMENT ON COLUMN public.process_items.responsible_name IS
  'Responsável nominal pela atividade do checklist; validar o nome na Secretaria.';
COMMENT ON COLUMN public.process_items.due_date IS
  'Prazo planejado para a atividade do checklist.';

-- Create a procurement process and its standard checklist atomically.
-- If any checklist row fails, the process insert is rolled back as well.
CREATE OR REPLACE FUNCTION public.create_procurement_process_with_checklist(
  p_tenant_id uuid,
  p_number text,
  p_title text,
  p_description text DEFAULT NULL,
  p_modality text DEFAULT 'pregao',
  p_priority text DEFAULT 'normal',
  p_requesting_unit text DEFAULT NULL,
  p_responsible_name text DEFAULT NULL,
  p_estimated_value numeric DEFAULT NULL,
  p_due_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_process_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'processos')
     OR NOT EXISTS (
       SELECT 1 FROM public.tenants t
       WHERE t.id = p_tenant_id AND t.status = 'active'
     )
  THEN
    RAISE EXCEPTION 'Sem permissão ou módulo de processos indisponível nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  IF p_number IS NULL OR length(btrim(p_number)) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Informe o número do processo (1 a 60 caracteres).';
  END IF;

  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Informe o título do processo (3 a 300 caracteres).';
  END IF;

  IF p_modality NOT IN ('pregao', 'concorrencia', 'dispensa', 'inexigibilidade', 'adesao_ata', 'outro') THEN
    RAISE EXCEPTION 'Modalidade de contratação inválida.';
  END IF;

  IF p_priority NOT IN ('baixa', 'normal', 'alta', 'urgente') THEN
    RAISE EXCEPTION 'Prioridade do processo inválida.';
  END IF;

  IF p_estimated_value IS NOT NULL AND p_estimated_value < 0 THEN
    RAISE EXCEPTION 'O valor estimado não pode ser negativo.';
  END IF;

  INSERT INTO public.procurement_processes (
    tenant_id,
    number,
    title,
    description,
    modality,
    priority,
    requesting_unit,
    responsible_name,
    estimated_value,
    due_date,
    created_by,
    updated_by
  )
  VALUES (
    p_tenant_id,
    pg_catalog.btrim(p_number),
    pg_catalog.btrim(p_title),
    NULLIF(pg_catalog.btrim(p_description), ''),
    p_modality,
    p_priority,
    NULLIF(pg_catalog.btrim(p_requesting_unit), ''),
    NULLIF(pg_catalog.btrim(p_responsible_name), ''),
    p_estimated_value,
    p_due_date,
    v_actor,
    v_actor
  )
  RETURNING id INTO v_process_id;

  INSERT INTO public.process_items (
    tenant_id,
    process_id,
    stage,
    title,
    sort_order,
    created_by,
    updated_by
  )
  SELECT
    p_tenant_id,
    v_process_id,
    checklist.stage,
    checklist.title,
    checklist.sort_order,
    v_actor,
    v_actor
  FROM (
    VALUES
      ('planejamento', 'DFD — Documento de Formalização da Demanda', 0),
      ('planejamento', 'Previsão no PCA', 1),
      ('estudos', 'ETP — Estudo Técnico Preliminar', 0),
      ('estudos', 'Matriz de gerenciamento de riscos', 1),
      ('objeto', 'Termo de Referência / Projeto Básico', 0),
      ('pesquisa', 'Cotações de preços (mín. 3)', 0),
      ('pesquisa', 'Mapa comparativo de preços', 1),
      ('parecer', 'Parecer jurídico', 0),
      ('parecer', 'Manifestação do controle interno', 1),
      ('conclusao', 'Autorização da autoridade competente', 0),
      ('conclusao', 'Encaminhamento à licitação', 1),
      ('publicacao', 'Publicação do edital ou aviso de contratação', 0),
      ('julgamento', 'Julgamento das propostas', 0),
      ('julgamento', 'Recursos e homologação', 1),
      ('assinatura', 'Formalização e assinatura do contrato ou ata', 0),
      ('fiscalizacao', 'Designação da fiscalização', 0),
      ('fiscalizacao', 'Acompanhamento da execução e entregas', 1)
  ) AS checklist(stage, title, sort_order);

  RETURN v_process_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_procurement_process_with_checklist(
  uuid,text,text,text,text,text,text,text,numeric,date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_procurement_process_with_checklist(
  uuid,text,text,text,text,text,text,text,numeric,date
) TO authenticated;


INSERT INTO public.process_items (
  tenant_id,
  process_id,
  stage,
  title,
  sort_order,
  created_by,
  updated_by
)
SELECT
  p.tenant_id,
  p.id,
  stages.stage,
  stages.title,
  stages.sort_order,
  p.created_by,
  p.updated_by
FROM public.procurement_processes p
CROSS JOIN (
  VALUES
    ('publicacao'::text, 'Publicação do edital ou aviso de contratação', 0),
    ('julgamento'::text, 'Julgamento das propostas', 0),
    ('julgamento'::text, 'Recursos e homologação', 1),
    ('assinatura'::text, 'Formalização e assinatura do contrato ou ata', 0),
    ('fiscalizacao'::text, 'Designação da fiscalização', 0),
    ('fiscalizacao'::text, 'Acompanhamento da execução e entregas', 1)
) AS stages(stage, title, sort_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.process_items existing
  WHERE existing.tenant_id = p.tenant_id
    AND existing.process_id = p.id
    AND existing.stage = stages.stage
    AND existing.title = stages.title
);

COMMIT;
