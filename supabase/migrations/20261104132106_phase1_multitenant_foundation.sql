-- MIGRACAO FASE 1 — GESTAO DE FORNECEDORES DA SAUDE
-- Projeto Supabase destino: SMS2 (rwbbznqtocunzrpcvjvk)
-- Fundação multitenant: perfis, tenants, vínculos, papéis, permissões, RLS e auditoria.
-- Executar como migration no Supabase SMS2. Toda a operação está em uma única transação.
-- Preflight fail-closed: interrompe se algum objeto de destino já existir.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
DECLARE
  v_object text;
BEGIN
  FOREACH v_object IN ARRAY ARRAY[
    'public.profiles', 'public.tenants', 'public.tenant_memberships',
    'public.permissions', 'public.tenant_roles',
    'public.tenant_role_permissions', 'public.membership_roles',
    'public.platform_admins', 'public.audit_events'
  ] LOOP
    IF pg_catalog.to_regclass(v_object) IS NOT NULL THEN
      RAISE EXCEPTION 'Preflight interrompido: o objeto % já existe. Audite-o; não execute esta migração sobreposta.', v_object;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'app_auth') THEN
    RAISE EXCEPTION 'Preflight interrompido: o schema app_auth já existe. Audite-o antes de continuar.';
  END IF;
  IF pg_catalog.to_regtype('public.tenant_status') IS NOT NULL
     OR pg_catalog.to_regtype('public.membership_status') IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight interrompido: um ou mais tipos desta migração já existem.';
  END IF;
END
$preflight$;

-- Schema privado para funções internas de autorização.
CREATE SCHEMA app_auth;
REVOKE ALL ON SCHEMA app_auth FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_auth TO authenticated;

CREATE TYPE public.tenant_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE public.membership_status AS ENUM ('active', 'inactive', 'suspended', 'invited');

-- Perfis guardam apenas nome nesta fase; CPF e telefone ficam fora do escopo.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT chk_profiles_full_name CHECK (pg_catalog.length(pg_catalog.btrim(full_name)) BETWEEN 1 AND 160)
);

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status public.tenant_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT chk_tenant_name CHECK (pg_catalog.length(pg_catalog.btrim(name)) BETWEEN 3 AND 160),
  CONSTRAINT chk_tenant_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND pg_catalog.length(slug) <= 63)
);

CREATE TABLE public.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status public.membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_membership_tenant_user UNIQUE (tenant_id, user_id),
  CONSTRAINT uq_membership_id_tenant UNIQUE (id, tenant_id)
);

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  module text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT chk_permission_code CHECK (code ~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$')
);

CREATE TABLE public.tenant_roles (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_tenant_role_slug UNIQUE (tenant_id, slug),
  CONSTRAINT uq_tenant_roles_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT chk_tenant_role_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE public.tenant_role_permissions (
  role_id uuid NOT NULL REFERENCES public.tenant_roles(id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE public.membership_roles (
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (membership_id, role_id),
  CONSTRAINT fk_membership_roles_membership_tenant
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES public.tenant_memberships(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_membership_roles_role_tenant
    FOREIGN KEY (role_id, tenant_id)
    REFERENCES public.tenant_roles(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX idx_tenants_status ON public.tenants(status);
CREATE INDEX idx_tenant_memberships_user ON public.tenant_memberships(user_id, status);
CREATE INDEX idx_tenant_memberships_tenant ON public.tenant_memberships(tenant_id, status);
CREATE INDEX idx_tenant_roles_tenant ON public.tenant_roles(tenant_id);
CREATE INDEX idx_membership_roles_lookup ON public.membership_roles(membership_id, tenant_id);
CREATE INDEX idx_membership_roles_role ON public.membership_roles(role_id, tenant_id);
CREATE INDEX idx_audit_events_tenant_created ON public.audit_events(tenant_id, created_at DESC);
CREATE INDEX idx_audit_events_actor_created ON public.audit_events(actor_id, created_at DESC);

-- Funções internas de autorização. SECURITY DEFINER fica limitado ao próprio usuário.
CREATE FUNCTION app_auth.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = (SELECT auth.uid()) AND pa.is_active = true
  );
$$;

CREATE FUNCTION app_auth.is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = (SELECT auth.uid())
      AND tm.status = 'active'
      AND t.status = 'active'
  );
$$;

CREATE FUNCTION app_auth.is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    JOIN public.membership_roles mr
      ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
    JOIN public.tenant_roles tr
      ON tr.id = mr.role_id AND tr.tenant_id = mr.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = (SELECT auth.uid())
      AND tm.status = 'active'
      AND t.status = 'active'
      AND tr.slug = 'admin'
      AND tr.is_system = true
  );
$$;

CREATE FUNCTION app_auth.has_tenant_permission(p_tenant_id uuid, p_permission_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT app_auth.is_platform_admin() OR EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    JOIN public.membership_roles mr
      ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
    JOIN public.tenant_roles tr
      ON tr.id = mr.role_id AND tr.tenant_id = mr.tenant_id
    JOIN public.tenant_role_permissions trp ON trp.role_id = tr.id
    JOIN public.permissions p ON p.id = trp.permission_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = (SELECT auth.uid())
      AND tm.status = 'active'
      AND t.status = 'active'
      AND p.code = p_permission_code
  );
$$;

CREATE FUNCTION app_auth.get_user_active_tenants()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT tm.tenant_id
  FROM public.tenant_memberships tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = (SELECT auth.uid())
    AND tm.status = 'active'
    AND t.status = 'active';
$$;

-- Triggers de integridade e perfil.
CREATE FUNCTION public.fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_full_name text;
BEGIN
  v_full_name := COALESCE(
    NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'display_name'), ''),
    NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'name'), ''),
    NULLIF(pg_catalog.split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Usuario ' || pg_catalog.left(NEW.id::text, 8)
  );
  v_full_name := pg_catalog.left(v_full_name, 160);

  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_protect_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'O ID e a data de criacao do perfil sao imutaveis.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_protect_membership_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'O ID, a organizacao, o usuario e a data de criacao do vinculo sao imutaveis; altere o status ou crie um novo vinculo.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_protect_tenant_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A identidade e a data de criacao da organizacao sao imutaveis.';
  END IF;
  IF NOT app_auth.is_platform_admin()
     AND (NEW.slug IS DISTINCT FROM OLD.slug
          OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'Somente a administracao global pode alterar slug, status ou autor de criacao da organizacao.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_protect_system_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system = true AND NOT app_auth.is_platform_admin() THEN
      RAISE EXCEPTION 'Somente um superadministrador da plataforma pode criar papel nativo.';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A identidade, a organizacao e a data de criacao do papel sao imutaveis.';
    END IF;
    IF OLD.is_system = true THEN
      RAISE EXCEPTION 'Papeis nativos sao imutaveis; altere-os somente por migracao controlada.';
    END IF;
    IF NEW.is_system = true THEN
      RAISE EXCEPTION 'Papel personalizado nao pode ser convertido em nativo.';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_system = true THEN
      RAISE EXCEPTION 'Papeis nativos nao podem ser removidos por DML.';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Operacao nao suportada em tenant_roles.';
END;
$$;

CREATE FUNCTION public.fn_protect_admin_role_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role_id uuid;
  v_is_system_admin boolean;
BEGIN
  IF app_auth.is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_role_id := OLD.role_id;
    SELECT (tr.slug = 'admin' AND tr.is_system)
      INTO v_is_system_admin
      FROM public.tenant_roles tr WHERE tr.id = v_role_id;
    IF COALESCE(v_is_system_admin, false) THEN
      RAISE EXCEPTION 'As permissoes do papel administrativo nativo sao protegidas.';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_role_id := NEW.role_id;
    SELECT (tr.slug = 'admin' AND tr.is_system)
      INTO v_is_system_admin
      FROM public.tenant_roles tr WHERE tr.id = v_role_id;
    IF COALESCE(v_is_system_admin, false) THEN
      RAISE EXCEPTION 'As permissoes do papel administrativo nativo sao protegidas.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_prevent_tenant_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Exclusao fisica de organizacoes proibida. Altere o status em vez de excluir.';
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.fn_prevent_audit_tampering()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria sao append-only e nao podem ser alterados ou excluidos.';
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.fn_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_tenant_id uuid;
  v_entity_id text;
  v_role_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := pg_catalog.to_jsonb(OLD);
  ELSE
    v_row := pg_catalog.to_jsonb(NEW);
    IF TG_OP = 'UPDATE' THEN
      v_old := pg_catalog.to_jsonb(OLD);
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'tenants' THEN
    v_tenant_id := (v_row ->> 'id')::uuid;
    v_entity_id := v_row ->> 'id';
  ELSIF TG_TABLE_NAME IN ('tenant_memberships', 'tenant_roles') THEN
    v_tenant_id := (v_row ->> 'tenant_id')::uuid;
    v_entity_id := v_row ->> 'id';
  ELSIF TG_TABLE_NAME = 'membership_roles' THEN
    v_tenant_id := (v_row ->> 'tenant_id')::uuid;
    v_entity_id := (v_row ->> 'membership_id') || ':' || (v_row ->> 'role_id');
  ELSIF TG_TABLE_NAME = 'tenant_role_permissions' THEN
    v_role_id := (v_row ->> 'role_id')::uuid;
    SELECT tr.tenant_id INTO v_tenant_id FROM public.tenant_roles tr WHERE tr.id = v_role_id;
    v_entity_id := (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_id');
  ELSIF TG_TABLE_NAME = 'platform_admins' THEN
    v_entity_id := v_row ->> 'user_id';
  ELSE
    RAISE EXCEPTION 'Tabela sem estrategia de auditoria configurada: %', TG_TABLE_NAME;
  END IF;

  INSERT INTO public.audit_events
    (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES
    (v_tenant_id, (SELECT auth.uid()), TG_OP, TG_TABLE_NAME, v_entity_id,
     CASE WHEN TG_OP = 'DELETE'
       THEN pg_catalog.jsonb_build_object('old', v_row)
       WHEN TG_OP = 'UPDATE'
       THEN pg_catalog.jsonb_build_object('old', v_old, 'new', v_row)
       ELSE pg_catalog.jsonb_build_object('new', v_row)
     END,
     pg_catalog.now());

  RETURN NULL;
END;
$$;

-- Provisionamento transacional: somente superadministrador global autenticado.
CREATE FUNCTION public.create_tenant_with_admin(p_name text, p_slug text, p_admin_user_id uuid)
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
  VALUES (v_tenant_id, 'Administrador da Organizacao', 'admin', 'Administracao da organizacao', true)
  RETURNING id INTO v_admin_role_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Gestor', 'manager', 'Gestao com privilegios limitados', true)
  RETURNING id INTO v_manager_role_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Operador', 'operator', 'Operacao com privilegios limitados', true)
  RETURNING id INTO v_operator_role_id;

  INSERT INTO public.tenant_roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Consulta', 'viewer', 'Consulta com privilegios limitados', true)
  RETURNING id INTO v_viewer_role_id;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_admin_role_id, p.id FROM public.permissions p;

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_manager_role_id, p.id FROM public.permissions p
  WHERE p.code IN ('org:view', 'users:view');

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_operator_role_id, p.id FROM public.permissions p
  WHERE p.code = 'org:view';

  INSERT INTO public.tenant_role_permissions (role_id, permission_id)
  SELECT v_viewer_role_id, p.id FROM public.permissions p
  WHERE p.code = 'org:view';

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

-- Catalogo global de permissoes, usando os mesmos codigos nas policies.
INSERT INTO public.permissions (code, name, description, module) VALUES
  ('org:view', 'Visualizar organizacao', 'Consultar dados basicos da organizacao', 'organizations'),
  ('org:edit', 'Editar organizacao', 'Editar os dados permitidos da organizacao', 'organizations'),
  ('users:view', 'Visualizar usuarios', 'Consultar membros da organizacao', 'users'),
  ('users:create', 'Adicionar usuarios', 'Adicionar membros a organizacao', 'users'),
  ('users:edit', 'Editar usuarios', 'Alterar o status de membros', 'users'),
  ('users:delete', 'Desativar vinculo de usuario', 'Desativar vinculo sem excluir historico', 'users'),
  ('users:assign_role', 'Atribuir papeis', 'Atribuir ou remover papeis de membros', 'users'),
  ('roles:manage', 'Gerenciar papeis', 'Criar e gerenciar papeis personalizados', 'roles'),
  ('audit:view', 'Visualizar auditoria', 'Consultar eventos de auditoria', 'audit');

-- Trigger do Supabase Auth cria um perfil reduzido no mesmo cadastro.
CREATE TRIGGER trg_auth_user_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_auth_user();

-- Backfill dos usuários Auth já existentes, se houver.
INSERT INTO public.profiles (id, full_name)
SELECT u.id,
       pg_catalog.left(
         COALESCE(
           NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'display_name'), ''),
           NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'name'), ''),
           NULLIF(pg_catalog.split_part(COALESCE(u.email, ''), '@', 1), ''),
           'Usuario ' || pg_catalog.left(u.id::text, 8)
         ),
         160
       )
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_profiles_protect_id BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_profile_identity();
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_tenants_protect_fields BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_tenant_fields();
CREATE TRIGGER trg_tenants_prevent_delete BEFORE DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_tenant_delete();
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_memberships_protect_identity BEFORE UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_membership_identity();
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.tenant_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_roles_protect_system BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_system_role();
CREATE TRIGGER trg_role_permissions_protect_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_admin_role_permissions();
CREATE TRIGGER trg_audit_tampering BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_audit_tampering();

CREATE TRIGGER trg_audit_tenants AFTER INSERT OR UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
CREATE TRIGGER trg_audit_memberships AFTER INSERT OR UPDATE OR DELETE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
CREATE TRIGGER trg_audit_membership_roles AFTER INSERT OR DELETE ON public.membership_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
CREATE TRIGGER trg_audit_roles AFTER INSERT OR UPDATE OR DELETE ON public.tenant_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
CREATE TRIGGER trg_audit_role_permissions AFTER INSERT OR UPDATE OR DELETE ON public.tenant_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
CREATE TRIGGER trg_audit_platform_admins AFTER INSERT OR UPDATE OR DELETE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- Enable RLS and explicitly grant only authenticated privileges required by API.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles, public.tenants, public.tenant_memberships,
  public.permissions, public.tenant_roles, public.tenant_role_permissions,
  public.membership_roles, public.platform_admins, public.audit_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE ON public.tenants TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_memberships TO authenticated;
GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_roles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.tenant_role_permissions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.membership_roles TO authenticated;
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

-- Profiles: self, global platform administrator or active colleagues with users:view.
CREATE POLICY p_profiles_select ON public.profiles FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (SELECT app_auth.is_platform_admin())
  OR EXISTS (
    SELECT 1
    FROM public.tenant_memberships target_tm
    JOIN public.tenant_memberships viewer_tm ON viewer_tm.tenant_id = target_tm.tenant_id
    WHERE target_tm.user_id = profiles.id
      AND target_tm.status = 'active'
      AND viewer_tm.user_id = (SELECT auth.uid())
      AND viewer_tm.status = 'active'
      AND app_auth.has_tenant_permission(viewer_tm.tenant_id, 'users:view')
  )
);
CREATE POLICY p_profiles_update ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY p_tenants_select ON public.tenants FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_permission(id, 'org:view')));
CREATE POLICY p_tenants_update ON public.tenants FOR UPDATE TO authenticated
USING ((SELECT app_auth.has_tenant_permission(id, 'org:edit')))
WITH CHECK ((SELECT app_auth.has_tenant_permission(id, 'org:edit')));

CREATE POLICY p_memberships_select ON public.tenant_memberships FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:view'))
);
CREATE POLICY p_memberships_insert ON public.tenant_memberships FOR INSERT TO authenticated
WITH CHECK (
  (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:create'))
);
CREATE POLICY p_memberships_update ON public.tenant_memberships FOR UPDATE TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:edit'))
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:delete'))
)
WITH CHECK (
  (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:edit'))
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:delete'))
);

CREATE POLICY p_permissions_select ON public.permissions FOR SELECT TO authenticated
USING (true);

CREATE POLICY p_roles_select ON public.tenant_roles FOR SELECT TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.is_tenant_member(tenant_id))
);
CREATE POLICY p_roles_insert ON public.tenant_roles FOR INSERT TO authenticated
WITH CHECK (
  NOT is_system
  AND ((SELECT app_auth.is_platform_admin()) OR (SELECT app_auth.has_tenant_permission(tenant_id, 'roles:manage')))
);
CREATE POLICY p_roles_update ON public.tenant_roles FOR UPDATE TO authenticated
USING (
  (SELECT app_auth.is_platform_admin()) OR (SELECT app_auth.has_tenant_permission(tenant_id, 'roles:manage'))
)
WITH CHECK (
  NOT is_system
  AND ((SELECT app_auth.is_platform_admin()) OR (SELECT app_auth.has_tenant_permission(tenant_id, 'roles:manage')))
);
CREATE POLICY p_roles_delete ON public.tenant_roles FOR DELETE TO authenticated
USING (
  NOT is_system
  AND ((SELECT app_auth.is_platform_admin()) OR (SELECT app_auth.has_tenant_permission(tenant_id, 'roles:manage')))
);

CREATE POLICY p_role_permissions_select ON public.tenant_role_permissions FOR SELECT TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    WHERE tr.id = tenant_role_permissions.role_id
      AND app_auth.has_tenant_permission(tr.tenant_id, 'roles:manage')
  )
);
CREATE POLICY p_role_permissions_manage ON public.tenant_role_permissions FOR ALL TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    WHERE tr.id = tenant_role_permissions.role_id
      AND app_auth.has_tenant_permission(tr.tenant_id, 'roles:manage')
  )
)
WITH CHECK (
  (SELECT app_auth.is_platform_admin())
  OR EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    WHERE tr.id = tenant_role_permissions.role_id
      AND app_auth.has_tenant_permission(tr.tenant_id, 'roles:manage')
  )
);

CREATE POLICY p_membership_roles_select ON public.membership_roles FOR SELECT TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:view'))
  OR EXISTS (
    SELECT 1
    FROM public.tenant_memberships own_tm
    JOIN public.tenants own_t ON own_t.id = own_tm.tenant_id
    WHERE own_tm.id = membership_roles.membership_id
      AND own_tm.tenant_id = membership_roles.tenant_id
      AND own_tm.user_id = (SELECT auth.uid())
      AND own_tm.status = 'active'
      AND own_t.status = 'active'
  )
);
CREATE POLICY p_membership_roles_insert ON public.membership_roles FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tenant_memberships target_tm
    JOIN public.tenants target_t ON target_t.id = target_tm.tenant_id
    WHERE target_tm.id = membership_roles.membership_id
      AND target_tm.tenant_id = membership_roles.tenant_id
      AND target_tm.status = 'active'
      AND target_t.status = 'active'
  )
  AND (
    (SELECT app_auth.is_platform_admin())
    OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:assign_role'))
  )
);
CREATE POLICY p_membership_roles_delete ON public.membership_roles FOR DELETE TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:assign_role'))
);

CREATE POLICY p_platform_admins_select ON public.platform_admins FOR SELECT TO authenticated
USING ((SELECT app_auth.is_platform_admin()));

CREATE POLICY p_audit_events_select ON public.audit_events FOR SELECT TO authenticated
USING (
  (SELECT app_auth.is_platform_admin())
  OR (tenant_id IS NOT NULL AND (SELECT app_auth.has_tenant_permission(tenant_id, 'audit:view')))
);

-- Function ACLs: only intended RPC is callable by authenticated users.
REVOKE ALL ON FUNCTION app_auth.is_platform_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_auth.is_tenant_member(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_auth.is_tenant_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_auth.has_tenant_permission(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_auth.get_user_active_tenants() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_auth.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.is_tenant_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.is_tenant_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.has_tenant_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.get_user_active_tenants() TO authenticated;

REVOKE ALL ON FUNCTION public.create_tenant_with_admin(text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_admin(text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_handle_new_auth_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_protect_profile_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_protect_membership_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_protect_tenant_fields() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_protect_system_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_protect_admin_role_permissions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prevent_tenant_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prevent_audit_tampering() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_audit_trigger() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
