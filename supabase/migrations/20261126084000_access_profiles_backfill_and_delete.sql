-- Correções e melhorias em Perfis de Acesso:
-- 1) Garante todas as permissões do sistema (incluindo procurement:approve_price) no papel admin nativo de Secretarias já existentes.
-- 2) Garante os 3 papéis especializados da Lei nº 14.133/2021 (Pregoeiro, Fiscal, Controle Interno) em Secretarias existentes.
-- 3) Cria RPC segura delete_custom_tenant_role para excluir perfil personalizado sem vínculos.

BEGIN;

ALTER TABLE public.tenant_role_permissions DISABLE TRIGGER trg_role_permissions_protect_admin;

INSERT INTO public.tenant_role_permissions (role_id, permission_id)
SELECT tr.id, p.id
FROM public.tenant_roles tr
CROSS JOIN public.permissions p
WHERE tr.is_system = true
  AND tr.slug = 'admin'
ON CONFLICT DO NOTHING;

ALTER TABLE public.tenant_role_permissions ENABLE TRIGGER trg_role_permissions_protect_admin;

DO $$
DECLARE
  v_tenant record;
  v_role_id uuid;
BEGIN
  FOR v_tenant IN SELECT id FROM public.tenants WHERE status = 'active' LOOP
    -- Pregoeiro / Agente de Contratação
    SELECT tr.id INTO v_role_id
    FROM public.tenant_roles tr
    WHERE tr.tenant_id = v_tenant.id AND tr.slug = 'pregoeiro'
    LIMIT 1;

    IF v_role_id IS NULL THEN
      INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
      VALUES (
        v_tenant.id,
        'Pregoeiro / Agente de Contratação',
        'pregoeiro',
        'Condução de processos licitatórios, pesquisa de preços, aprovação de estimativas e portal de cotações',
        false
      )
      RETURNING id INTO v_role_id;
    END IF;

    INSERT INTO public.tenant_role_permissions (role_id, permission_id)
    SELECT v_role_id, p.id
    FROM public.permissions p
    WHERE p.code IN (
      'org:view', 'users:view', 'procurement:approve_price',
      'suppliers:view', 'suppliers:create', 'suppliers:update',
      'documents:view', 'documents:create', 'documents:update', 'documents:approve', 'documents:sign',
      'audit:view'
    )
    ON CONFLICT DO NOTHING;

    -- Fiscal de Contrato
    SELECT tr.id INTO v_role_id
    FROM public.tenant_roles tr
    WHERE tr.tenant_id = v_tenant.id AND tr.slug = 'fiscal'
    LIMIT 1;

    IF v_role_id IS NULL THEN
      INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
      VALUES (
        v_tenant.id,
        'Fiscal de Contrato',
        'fiscal',
        'Acompanhamento de execução contratual, saldos, prorrogações, atestes e ocorrências',
        false
      )
      RETURNING id INTO v_role_id;
    END IF;

    INSERT INTO public.tenant_role_permissions (role_id, permission_id)
    SELECT v_role_id, p.id
    FROM public.permissions p
    WHERE p.code IN (
      'org:view',
      'suppliers:view',
      'documents:view', 'documents:create', 'documents:update', 'documents:sign',
      'audit:view'
    )
    ON CONFLICT DO NOTHING;

    -- Controle Interno
    SELECT tr.id INTO v_role_id
    FROM public.tenant_roles tr
    WHERE tr.tenant_id = v_tenant.id AND tr.slug = 'controle-interno'
    LIMIT 1;

    IF v_role_id IS NULL THEN
      INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
      VALUES (
        v_tenant.id,
        'Controle Interno',
        'controle-interno',
        'Auditoria preventiva, conformidade Lei nº 14.133/2021 e conferência de dossiês TCE',
        false
      )
      RETURNING id INTO v_role_id;
    END IF;

    INSERT INTO public.tenant_role_permissions (role_id, permission_id)
    SELECT v_role_id, p.id
    FROM public.permissions p
    WHERE p.code IN (
      'org:view', 'users:view',
      'suppliers:view',
      'documents:view',
      'audit:view'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_tenant_role(p_tenant_id uuid, p_role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_role record;
BEGIN
  IF v_actor IS NULL
     OR NOT app_auth.has_tenant_permission(p_tenant_id, 'roles:manage')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir perfis desta Secretaria.' USING ERRCODE = '42501';
  END IF;

  SELECT r.id, r.name, r.slug, r.is_system
  INTO v_role
  FROM public.tenant_roles r
  WHERE r.id = p_role_id
    AND r.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado nesta Secretaria.';
  END IF;

  IF v_role.is_system THEN
    RAISE EXCEPTION 'Perfis nativos protegidos não podem ser excluídos.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.membership_roles mr
    WHERE mr.role_id = p_role_id
      AND mr.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Existem profissionais vinculados a este perfil. Reatribua-os antes de excluir.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_invitations ti
    WHERE ti.role_id = p_role_id
      AND ti.tenant_id = p_tenant_id
      AND ti.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Existem convites pendentes usando este perfil. Cancele os convites antes de excluir.';
  END IF;

  DELETE FROM public.tenant_role_permissions rp
  WHERE rp.role_id = p_role_id;

  DELETE FROM public.tenant_roles r
  WHERE r.id = p_role_id
    AND r.tenant_id = p_tenant_id;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_id,
    action,
    entity,
    entity_id,
    details,
    created_at
  )
  VALUES (
    p_tenant_id,
    v_actor,
    'tenant_role.deleted',
    'tenant_roles',
    p_role_id::text,
    pg_catalog.jsonb_build_object('name', v_role.name, 'slug', v_role.slug),
    pg_catalog.now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_custom_tenant_role(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_custom_tenant_role(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_tenant_onboarding_defaults(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_modelos_enabled boolean := true;
  v_role_id uuid;
  v_roles_created integer := 0;
  v_templates_installed integer := 0;
  v_rec record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    app_auth.is_platform_admin()
    OR (
      app_auth.has_tenant_data_permission(p_tenant_id, 'roles:manage')
      AND app_auth.has_tenant_data_permission(p_tenant_id, 'documents:manage_templates')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aplicar o onboarding padrão nesta Secretaria.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE((t.enabled_modules->>'modelos')::boolean, true)
  INTO v_modelos_enabled
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secretaria não encontrada.';
  END IF;

  -- 1. Pregoeiro / Agente de Contratação
  SELECT tr.id INTO v_role_id
  FROM public.tenant_roles tr
  WHERE tr.tenant_id = p_tenant_id AND tr.slug = 'pregoeiro'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
    VALUES (
      p_tenant_id,
      'Pregoeiro / Agente de Contratação',
      'pregoeiro',
      'Condução de processos licitatórios, pesquisa de preços, aprovação de estimativas e portal de cotações',
      false
    )
    RETURNING id INTO v_role_id;
    v_roles_created := v_roles_created + 1;
  END IF;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.code IN (
    'org:view', 'users:view', 'procurement:approve_price',
    'suppliers:view', 'suppliers:create', 'suppliers:update',
    'documents:view', 'documents:create', 'documents:update', 'documents:approve', 'documents:sign',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- 2. Fiscal de Contrato
  SELECT tr.id INTO v_role_id
  FROM public.tenant_roles tr
  WHERE tr.tenant_id = p_tenant_id AND tr.slug = 'fiscal'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
    VALUES (
      p_tenant_id,
      'Fiscal de Contrato',
      'fiscal',
      'Acompanhamento de execução contratual, saldos, prorrogações, atestes e ocorrências',
      false
    )
    RETURNING id INTO v_role_id;
    v_roles_created := v_roles_created + 1;
  END IF;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.code IN (
    'org:view',
    'suppliers:view',
    'documents:view', 'documents:create', 'documents:update', 'documents:sign',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- 3. Controle Interno
  SELECT tr.id INTO v_role_id
  FROM public.tenant_roles tr
  WHERE tr.tenant_id = p_tenant_id AND tr.slug = 'controle-interno'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
    VALUES (
      p_tenant_id,
      'Controle Interno',
      'controle-interno',
      'Auditoria preventiva, conformidade Lei nº 14.133/2021 e conferência de dossiês TCE',
      false
    )
    RETURNING id INTO v_role_id;
    v_roles_created := v_roles_created + 1;
  END IF;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.code IN (
    'org:view', 'users:view',
    'suppliers:view',
    'documents:view',
    'audit:view'
  )
  ON CONFLICT DO NOTHING;

  -- 4. Instalação automática dos modelos oficiais ativos do catálogo (quando módulo modelos ativo)
  IF v_modelos_enabled THEN
    FOR v_rec IN
      SELECT c.*
      FROM public.document_template_catalog c
      WHERE c.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.document_templates dt
          WHERE dt.tenant_id = p_tenant_id
            AND dt.catalog_template_id = c.id
        )
      ORDER BY c.template_code
    LOOP
      INSERT INTO public.document_templates (
        tenant_id,
        title,
        description,
        content,
        is_active,
        template_type,
        template_code,
        version,
        catalog_template_id,
        legal_basis,
        source_reference,
        variables_schema,
        change_summary,
        is_base_template
      )
      VALUES (
        p_tenant_id,
        v_rec.title,
        v_rec.description,
        v_rec.content,
        true,
        v_rec.template_type,
        v_rec.template_code,
        1,
        v_rec.id,
        v_rec.legal_basis,
        v_rec.source_reference,
        v_rec.variables_schema,
        'Instalado automaticamente no onboarding da Secretaria.',
        true
      );
      v_templates_installed := v_templates_installed + 1;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'roles_created', v_roles_created,
    'templates_installed', v_templates_installed
  );
END;
$function$;

COMMIT;
