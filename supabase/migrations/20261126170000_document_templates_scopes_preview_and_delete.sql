-- Disponibilidade por fluxo/etapa do processo, novas categorias da Lei nº 14.133/2021,
-- arquivamento/reativação e exclusão segura de modelos documentais sem documentos gerados.

-- 1) Ampliar categorias de documentos/modelos conforme fluxos públicos (SEI / Compras.gov / AGU)
ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_type_check;

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_type_check
  CHECK (
    template_type = ANY (
      ARRAY[
        'dfd'::text,
        'etp'::text,
        'risk_analysis'::text,
        'risk_matrix'::text,
        'tr'::text,
        'edital'::text,
        'parecer_juridico'::text,
        'contrato'::text,
        'term_addendum_renewal'::text,
        'notificacao'::text,
        'despacho'::text,
        'custom'::text
      ]
    )
  );

ALTER TABLE public.document_template_versions
  DROP CONSTRAINT IF EXISTS document_template_versions_template_type_check;

ALTER TABLE public.document_template_versions
  ADD CONSTRAINT document_template_versions_template_type_check
  CHECK (
    template_type = ANY (
      ARRAY[
        'dfd'::text,
        'etp'::text,
        'risk_analysis'::text,
        'risk_matrix'::text,
        'tr'::text,
        'edital'::text,
        'parecer_juridico'::text,
        'contrato'::text,
        'term_addendum_renewal'::text,
        'notificacao'::text,
        'despacho'::text,
        'custom'::text
      ]
    )
  );

ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_type_check;

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_type_check
  CHECK (
    document_type = ANY (
      ARRAY[
        'dfd'::text,
        'etp'::text,
        'risk_analysis'::text,
        'risk_matrix'::text,
        'tr'::text,
        'edital'::text,
        'parecer_juridico'::text,
        'contrato'::text,
        'term_addendum_renewal'::text,
        'notificacao'::text,
        'despacho'::text,
        'custom'::text
      ]
    )
  );

-- 2) Campos de configuração de onde o modelo fica disponível e em quais etapas do processo
ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS availability_scopes text[]
    NOT NULL
    DEFAULT ARRAY['processos', 'contratos', 'fornecedores', 'avulso']::text[],
  ADD COLUMN IF NOT EXISTS process_stages text[]
    NOT NULL
    DEFAULT ARRAY[]::text[];

ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_availability_scopes_check;

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_availability_scopes_check
  CHECK (
    pg_catalog.cardinality(availability_scopes) >= 1
    AND availability_scopes <@ ARRAY['processos', 'contratos', 'fornecedores', 'avulso']::text[]
  );

ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_process_stages_check;

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_process_stages_check
  CHECK (
    process_stages <@ ARRAY[
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
    ]::text[]
  );

-- Backfill inteligente nos modelos existentes com base no tipo documental
UPDATE public.document_templates
SET
  availability_scopes = CASE template_type
    WHEN 'term_addendum_renewal' THEN ARRAY['contratos']::text[]
    WHEN 'dfd' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'etp' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'risk_analysis' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'tr' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'risk_matrix' THEN ARRAY['processos', 'avulso']::text[]
    ELSE ARRAY['processos', 'contratos', 'fornecedores', 'avulso']::text[]
  END,
  process_stages = CASE template_type
    WHEN 'dfd' THEN ARRAY['planejamento']::text[]
    WHEN 'etp' THEN ARRAY['estudos']::text[]
    WHEN 'risk_analysis' THEN ARRAY['estudos']::text[]
    WHEN 'tr' THEN ARRAY['objeto']::text[]
    WHEN 'risk_matrix' THEN ARRAY['objeto']::text[]
    ELSE ARRAY[]::text[]
  END
WHERE availability_scopes = ARRAY['processos', 'contratos', 'fornecedores', 'avulso']::text[]
  AND process_stages = ARRAY[]::text[]
  AND template_type IN ('dfd', 'etp', 'risk_analysis', 'tr', 'risk_matrix', 'term_addendum_renewal');

-- Atualizar install_document_template para preencher disponibilidade/etapa automaticamente
CREATE OR REPLACE FUNCTION public.install_document_template(p_tenant_id uuid, p_catalog_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  c public.document_template_catalog%ROWTYPE;
  new_id uuid;
  v_scopes text[];
  v_stages text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:manage_templates')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'modelos') THEN
    RAISE EXCEPTION 'Sem permissao ou modulo de modelos indisponivel.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c
  FROM public.document_template_catalog
  WHERE id = p_catalog_template_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo-base inexistente ou inativo.';
  END IF;

  v_scopes := CASE c.template_type
    WHEN 'term_addendum_renewal' THEN ARRAY['contratos']::text[]
    WHEN 'dfd' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'etp' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'risk_analysis' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'tr' THEN ARRAY['processos', 'avulso']::text[]
    WHEN 'risk_matrix' THEN ARRAY['processos', 'avulso']::text[]
    ELSE ARRAY['processos', 'contratos', 'fornecedores', 'avulso']::text[]
  END;

  v_stages := CASE c.template_type
    WHEN 'dfd' THEN ARRAY['planejamento']::text[]
    WHEN 'etp' THEN ARRAY['estudos']::text[]
    WHEN 'risk_analysis' THEN ARRAY['estudos']::text[]
    WHEN 'tr' THEN ARRAY['objeto']::text[]
    WHEN 'risk_matrix' THEN ARRAY['objeto']::text[]
    ELSE ARRAY[]::text[]
  END;

  INSERT INTO public.document_templates(
    tenant_id, title, description, content, is_active, template_type, template_code,
    version, catalog_template_id, legal_basis, source_reference, variables_schema,
    change_summary, is_base_template, availability_scopes, process_stages
  )
  VALUES(
    p_tenant_id, c.title, c.description, c.content, true, c.template_type, c.template_code,
    1, c.id, c.legal_basis, c.source_reference, c.variables_schema,
    'Instalado do catalogo-base; adaptar ao regulamento municipal.', true, v_scopes, v_stages
  )
  RETURNING id INTO new_id;

  RETURN new_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Este modelo ja foi instalado nesta Secretaria.';
END;
$function$;

-- 3) Inativar / reativar modelo sem perder versões nem quebrar documentos já gerados
CREATE OR REPLACE FUNCTION public.set_document_template_active(
  p_tenant_id uuid,
  p_template_id uuid,
  p_is_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_updated boolean;
BEGIN
  IF v_actor IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:manage_templates')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'modelos') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar modelos nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.document_templates
  SET is_active = COALESCE(p_is_active, false),
      updated_by = v_actor
  WHERE tenant_id = p_tenant_id
    AND id = p_template_id
  RETURNING is_active INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado nesta Secretaria.';
  END IF;

  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_document_template_active(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_template_active(uuid, uuid, boolean) TO authenticated;

-- 4) Exclusão segura de modelo (bloqueia se já houver documentos gerados; retorna storage_paths órfãos para limpeza)
CREATE OR REPLACE FUNCTION public.delete_document_template(
  p_tenant_id uuid,
  p_template_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_title text;
  v_generated_count integer := 0;
  v_storage_paths text[] := ARRAY[]::text[];
BEGIN
  IF v_actor IS NULL
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:manage_templates')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id, 'modelos') THEN
    RAISE EXCEPTION 'Sem permissão para excluir modelos nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.title INTO v_title
  FROM public.document_templates t
  WHERE t.tenant_id = p_tenant_id
    AND t.id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado nesta Secretaria.';
  END IF;

  SELECT COUNT(*) INTO v_generated_count
  FROM public.generated_documents g
  WHERE g.tenant_id = p_tenant_id
    AND g.template_id = p_template_id;

  IF v_generated_count > 0 THEN
    RAISE EXCEPTION 'Este modelo já possui % documento(s) gerado(s) vinculado(s) e não pode ser excluído definitivamente. Utilize a opção Inativar para ocultá-lo mantendo a rastreabilidade.', v_generated_count;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(s.storage_path), ARRAY[]::text[])
    INTO v_storage_paths
  FROM public.document_template_sources s
  WHERE s.tenant_id = p_tenant_id
    AND s.template_id = p_template_id;

  DELETE FROM public.document_template_sources
  WHERE tenant_id = p_tenant_id
    AND template_id = p_template_id;

  DELETE FROM public.document_template_versions
  WHERE tenant_id = p_tenant_id
    AND template_id = p_template_id;

  DELETE FROM public.document_templates
  WHERE tenant_id = p_tenant_id
    AND id = p_template_id;

  INSERT INTO public.audit_events(tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    p_tenant_id,
    v_actor,
    'DELETE',
    'document_templates',
    p_template_id::text,
    pg_catalog.jsonb_build_object('title', v_title),
    pg_catalog.now()
  );

  RETURN v_storage_paths;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_document_template(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_document_template(uuid, uuid) TO authenticated;
