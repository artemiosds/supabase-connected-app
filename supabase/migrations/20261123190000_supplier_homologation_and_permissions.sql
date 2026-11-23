-- Migration: 20261123190000_supplier_homologation_and_permissions.sql
-- Fase 2.1: Central Inteligente de Fornecedores - Homologacao, Habilitacao e Matriz de Permissoes Equivalentes

BEGIN;

-- 1. Inserir novas permissoes do modulo de fornecedores se nao existirem
INSERT INTO public.permissions (code, name, description, module) VALUES
  ('suppliers:homologate', 'Homologar fornecedores', 'Iniciar, analisar, registrar pendencias e concluir homologacao/habilitacao de fornecedores', 'suppliers'),
  ('suppliers:verify', 'Verificar regularidade', 'Registrar e consultar verificacoes cadastrais e de regularidade', 'suppliers')
ON CONFLICT (code) DO NOTHING;

-- 2. Garantir equivalencia operacional para Administrador, Gestor e Operador em fornecedores e documentos
-- Associar todas as permissoes operacionais de fornecedores, documentos e auditoria de fornecedor aos papeis admin, manager e operator existentes
ALTER TABLE public.tenant_role_permissions DISABLE TRIGGER trg_role_permissions_protect_admin;

DO $$
DECLARE
  v_perm RECORD;
  v_role RECORD;
BEGIN
  FOR v_role IN
    SELECT tr.id as role_id, tr.slug
    FROM public.tenant_roles tr
    WHERE tr.slug IN ('admin', 'manager', 'operator')
  LOOP
    FOR v_perm IN
      SELECT p.id as permission_id
      FROM public.permissions p
      WHERE p.code IN (
        'suppliers:view',
        'suppliers:create',
        'suppliers:update',
        'suppliers:deactivate',
        'suppliers:homologate',
        'suppliers:verify',
        'documents:view',
        'documents:create',
        'documents:update',
        'documents:approve',
        'documents:sign',
        'audit:view'
      )
    LOOP
      INSERT INTO public.tenant_role_permissions (role_id, permission_id)
      VALUES (v_role.role_id, v_perm.permission_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.tenant_role_permissions ENABLE TRIGGER trg_role_permissions_protect_admin;

-- 3. Atualizar provisionamento de novas organizacoes (create_tenant_with_admin)
CREATE OR REPLACE FUNCTION public.create_tenant_with_admin(p_name text, p_slug text, p_admin_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_membership_id uuid;
  v_admin_role_id uuid;
  v_manager_role_id uuid;
  v_operator_role_id uuid;
  v_viewer_role_id uuid;
  v_slug text;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente superadministrador da plataforma pode provisionar organizacoes.';
  END IF;

  IF p_admin_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_admin_user_id
  ) THEN
    RAISE EXCEPTION 'O usuario administrador precisa existir em Auth e possuir perfil.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_admin_user_id) THEN
    RAISE EXCEPTION 'Superadministrador global nao pode ser administrador municipal.';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'Nome da organizacao invalido (3 a 160 caracteres).';
  END IF;

  v_slug := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug, '')));
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR pg_catalog.length(v_slug) NOT BETWEEN 3 AND 63 THEN
    RAISE EXCEPTION 'Slug invalido. Use letras minusculas, numeros e hifens entre termos.';
  END IF;

  INSERT INTO public.tenants (name, slug, created_by, status)
  VALUES (pg_catalog.btrim(p_name), v_slug, (SELECT auth.uid()), 'active')
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Administrador da Organizacao', 'admin', 'Administracao completa da organizacao', true)
  RETURNING id INTO v_admin_role_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Gestor', 'manager', 'Gestao com operacao completa de fornecedores e compras', true)
  RETURNING id INTO v_manager_role_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Operador', 'operator', 'Operacao completa de fornecedores e rotinas administrativas', true)
  RETURNING id INTO v_operator_role_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Consulta', 'viewer', 'Consulta com privilegios limitados', true)
  RETURNING id INTO v_viewer_role_id;

  -- Admin recebe todas as permissoes do sistema
  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_admin_role_id, p.id FROM public.permissions p;

  -- Gestor e Operador recebem operacao completa na Fase 2.1 (Fornecedores + Documentos + Auditoria)
  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_manager_role_id, p.id FROM public.permissions p
  WHERE p.code IN (
    'org:view', 'users:view', 'procurement:approve_price',
    'suppliers:view', 'suppliers:create', 'suppliers:update', 'suppliers:deactivate', 'suppliers:homologate', 'suppliers:verify',
    'documents:view', 'documents:create', 'documents:update', 'documents:approve', 'documents:sign',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_operator_role_id, p.id FROM public.permissions p
  WHERE p.code IN (
    'org:view',
    'suppliers:view', 'suppliers:create', 'suppliers:update', 'suppliers:deactivate', 'suppliers:homologate', 'suppliers:verify',
    'documents:view', 'documents:create', 'documents:update', 'documents:approve', 'documents:sign',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- Consulta permanece somente leitura
  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_viewer_role_id, p.id FROM public.permissions p
  WHERE p.code IN ('org:view', 'suppliers:view', 'documents:view')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, status)
  VALUES (v_tenant_id, p_admin_user_id, 'active')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_roles (membership_id, role_id, tenant_id)
  VALUES (v_membership_id, v_admin_role_id, v_tenant_id);

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant_id,
    'slug', v_slug,
    'admin_user_id', p_admin_user_id
  );
END;
$$;

-- 4. Tabela de analises de homologacao/habilitacao
CREATE TABLE IF NOT EXISTS public.supplier_homologations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  process_id uuid REFERENCES public.procurement_processes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'awaiting_completion', 'completed', 'cancelled')),
  category text NOT NULL DEFAULT 'geral',
  scope_description text,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  conclusion_status text CHECK (conclusion_status IN ('regular', 'pending', 'rejected')),
  conclusion_notes text,
  concluded_at timestamptz,
  concluded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_supplier_homologations_tenant_id_id UNIQUE (tenant_id, id)
);

-- Indices para performance e isolamento
CREATE INDEX IF NOT EXISTS idx_supplier_homologations_tenant_supplier
  ON public.supplier_homologations (tenant_id, supplier_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_homologations_tenant_assigned
  ON public.supplier_homologations (tenant_id, assigned_to);

-- 5. Itens do checklist de habilitacao/homologacao
CREATE TABLE IF NOT EXISTS public.supplier_homologation_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  homologation_id uuid NOT NULL REFERENCES public.supplier_homologations(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  title text NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT true,
  is_sanitary boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'awaiting_review' CHECK (verification_status IN ('not_submitted', 'received', 'awaiting_review', 'verified', 'pending_issue', 'expired', 'replaced')),
  document_id uuid REFERENCES public.supplier_documents(id) ON DELETE SET NULL,
  notes text,
  verified_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_supplier_homol_checklist_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_homol_checklist_homologation
  ON public.supplier_homologation_checklist_items (tenant_id, homologation_id);

CREATE INDEX IF NOT EXISTS idx_supplier_homol_checklist_document
  ON public.supplier_homologation_checklist_items (tenant_id, document_id);

-- 6. Historico auditavel e imutavel de eventos de homologacao
CREATE TABLE IF NOT EXISTS public.supplier_homologation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  homologation_id uuid NOT NULL REFERENCES public.supplier_homologations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('opened', 'assigned', 'status_changed', 'checklist_verified', 'issue_raised', 'completion_requested', 'completion_received', 'concluded', 'cancelled')),
  from_status text,
  to_status text,
  description text NOT NULL,
  evidence_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_supplier_homol_events_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_homol_events_homologation
  ON public.supplier_homologation_events (tenant_id, homologation_id, created_at);

-- 7. Triggers de atualizacao de updated_at
CREATE OR REPLACE TRIGGER trg_supplier_homologations_updated_at
  BEFORE UPDATE ON public.supplier_homologations
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_supplier_homol_checklist_updated_at
  BEFORE UPDATE ON public.supplier_homologation_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 8. Ativar e Forcar RLS
ALTER TABLE public.supplier_homologations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_homologations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.supplier_homologation_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_homologation_checklist_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.supplier_homologation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_homologation_events FORCE ROW LEVEL SECURITY;

-- 9. Politicas restritivas comerciais
-- supplier_homologations
CREATE POLICY p_commercial_select_supplier_homologations ON public.supplier_homologations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores'))));

CREATE POLICY p_commercial_insert_supplier_homologations ON public.supplier_homologations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

CREATE POLICY p_commercial_update_supplier_homologations ON public.supplier_homologations
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')))
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

-- supplier_homologation_checklist_items
CREATE POLICY p_commercial_select_supplier_homol_checklist ON public.supplier_homologation_checklist_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores'))));

CREATE POLICY p_commercial_insert_supplier_homol_checklist ON public.supplier_homologation_checklist_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

CREATE POLICY p_commercial_update_supplier_homol_checklist ON public.supplier_homologation_checklist_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')))
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

-- supplier_homologation_events
CREATE POLICY p_commercial_select_supplier_homol_events ON public.supplier_homologation_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores'))));

CREATE POLICY p_commercial_insert_supplier_homol_events ON public.supplier_homologation_events
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

-- 10. Politicas permissivas com base em app_auth.has_supplier_permission
-- supplier_homologations
CREATE POLICY p_supplier_homologations_select ON public.supplier_homologations
  FOR SELECT TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:view'));

CREATE POLICY p_supplier_homologations_insert ON public.supplier_homologations
  FOR INSERT TO authenticated
  WITH CHECK (
    app_auth.has_supplier_permission(tenant_id, 'suppliers:create')
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );

CREATE POLICY p_supplier_homologations_update ON public.supplier_homologations
  FOR UPDATE TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
  WITH CHECK (
    app_auth.has_supplier_permission(tenant_id, 'suppliers:update')
    AND updated_by = (SELECT auth.uid())
  );

-- supplier_homologation_checklist_items
CREATE POLICY p_supplier_homol_checklist_select ON public.supplier_homologation_checklist_items
  FOR SELECT TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:view'));

CREATE POLICY p_supplier_homol_checklist_insert ON public.supplier_homologation_checklist_items
  FOR INSERT TO authenticated
  WITH CHECK (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'));

CREATE POLICY p_supplier_homol_checklist_update ON public.supplier_homologation_checklist_items
  FOR UPDATE TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
  WITH CHECK (app_auth.has_supplier_permission(tenant_id, 'suppliers:update'));

-- supplier_homologation_events (somente insert e select para preservar imutabilidade)
CREATE POLICY p_supplier_homol_events_select ON public.supplier_homologation_events
  FOR SELECT TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:view'));

CREATE POLICY p_supplier_homol_events_insert ON public.supplier_homologation_events
  FOR INSERT TO authenticated
  WITH CHECK (
    app_auth.has_supplier_permission(tenant_id, 'suppliers:update')
    AND created_by = (SELECT auth.uid())
  );

-- 11. RPC para manter get_supplier_capabilities
CREATE OR REPLACE FUNCTION public.get_supplier_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean, can_create boolean, can_update boolean, can_deactivate boolean)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:view'),
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:create'),
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update'),
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:deactivate');
$function$;

-- 12. RPCs para operacoes atomicas de homologacao
CREATE OR REPLACE FUNCTION public.start_supplier_homologation(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_category text,
  p_scope_description text,
  p_assigned_to uuid DEFAULT NULL,
  p_process_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_homologation_id uuid;
  v_user_id uuid;
  v_is_sanitary boolean;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.';
  END IF;

  IF NOT (
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:homologate')
    OR app_auth.has_supplier_permission(p_tenant_id, 'suppliers:create')
    OR app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: permissao insuficiente para iniciar analise de homologacao.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Fornecedor nao encontrado nesta Secretaria.';
  END IF;

  v_is_sanitary := p_category IN ('medicamentos', 'materiais_hospitalares');

  -- Criar a homologacao
  INSERT INTO public.supplier_homologations (
    tenant_id, supplier_id, process_id, status, category,
    scope_description, assigned_to, opened_at, created_by, updated_by
  ) VALUES (
    p_tenant_id, p_supplier_id, p_process_id, 'in_review', p_category,
    p_scope_description, COALESCE(p_assigned_to, v_user_id), now(), v_user_id, v_user_id
  )
  RETURNING id INTO v_homologation_id;

  -- Gerar itens do checklist inteligente inicial baseado nos documentos e categoria
  INSERT INTO public.supplier_homologation_checklist_items (
    tenant_id, homologation_id, document_type, title, is_mandatory, is_sanitary, verification_status
  ) VALUES
    (p_tenant_id, v_homologation_id, 'certidao_federal', 'CND Federal / Previdenciaria', true, false, 'awaiting_review'),
    (p_tenant_id, v_homologation_id, 'certidao_estadual', 'CND Estadual', true, false, 'awaiting_review'),
    (p_tenant_id, v_homologation_id, 'certidao_municipal', 'CND Municipal', true, false, 'awaiting_review'),
    (p_tenant_id, v_homologation_id, 'fgts', 'FGTS (CRF)', true, false, 'awaiting_review'),
    (p_tenant_id, v_homologation_id, 'trabalhista', 'CNDT Trabalhista', true, false, 'awaiting_review');

  IF v_is_sanitary THEN
    INSERT INTO public.supplier_homologation_checklist_items (
      tenant_id, homologation_id, document_type, title, is_mandatory, is_sanitary, verification_status
    ) VALUES
      (p_tenant_id, v_homologation_id, 'sanitaria', 'AFE - Anvisa', true, true, 'awaiting_review'),
      (p_tenant_id, v_homologation_id, 'alvara', 'Alvara Sanitario', true, true, 'awaiting_review');
  END IF;

  -- Vincular documentos existentes compativeis
  UPDATE public.supplier_homologation_checklist_items ci
  SET
    document_id = doc.id,
    verification_status = CASE
      WHEN doc.expires_at < CURRENT_DATE THEN 'expired'
      ELSE 'received'
    END
  FROM (
    SELECT DISTINCT ON (sd.document_type) sd.id, sd.document_type, sd.expires_at
    FROM public.supplier_documents sd
    WHERE sd.supplier_id = p_supplier_id AND sd.tenant_id = p_tenant_id AND sd.status = 'active'
    ORDER BY sd.document_type, sd.expires_at DESC NULLS LAST
  ) doc
  WHERE ci.homologation_id = v_homologation_id
    AND ci.document_type = doc.document_type;

  -- Registrar evento inicial
  INSERT INTO public.supplier_homologation_events (
    tenant_id, homologation_id, event_type, from_status, to_status, description, created_by
  ) VALUES (
    p_tenant_id, v_homologation_id, 'opened', 'draft', 'in_review',
    'Analise de homologacao e habilitacao iniciada com carregamento do checklist documental.',
    v_user_id
  );

  RETURN v_homologation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.conclude_supplier_homologation(
  p_tenant_id uuid,
  p_homologation_id uuid,
  p_conclusion_status text,
  p_conclusion_notes text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_current_status text;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.';
  END IF;

  IF NOT (
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:homologate')
    OR app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: permissao insuficiente para concluir analise.';
  END IF;

  IF p_conclusion_status NOT IN ('regular', 'pending', 'rejected') THEN
    RAISE EXCEPTION 'Resultado de conclusao invalido (%s). Use regular, pending ou rejected.', p_conclusion_status;
  END IF;

  SELECT status INTO v_current_status
  FROM public.supplier_homologations
  WHERE id = p_homologation_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analise de homologacao nao encontrada.';
  END IF;

  IF v_current_status = 'completed' THEN
    RAISE EXCEPTION 'Esta analise ja foi concluida anteriormente e seu historico e preservado.';
  END IF;

  UPDATE public.supplier_homologations
  SET
    status = 'completed',
    conclusion_status = p_conclusion_status,
    conclusion_notes = p_conclusion_notes,
    concluded_at = now(),
    concluded_by = v_user_id,
    updated_by = v_user_id,
    updated_at = now()
  WHERE id = p_homologation_id AND tenant_id = p_tenant_id;

  INSERT INTO public.supplier_homologation_events (
    tenant_id, homologation_id, event_type, from_status, to_status, description, created_by
  ) VALUES (
    p_tenant_id, p_homologation_id, 'concluded', v_current_status, 'completed',
    pg_catalog.concat('Conclusao registrada com parecer: ', p_conclusion_status, '. Observacoes: ', COALESCE(p_conclusion_notes, 'Nenhuma observacao informada.')),
    v_user_id
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_capabilities(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_supplier_homologation(uuid, uuid, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conclude_supplier_homologation(uuid, uuid, text, text) TO authenticated;

COMMIT;
