-- Keep the tenant provisioning RPC as SECURITY INVOKER.
-- A profile row is FK-backed by auth.users, so the function does not need
-- direct SELECT access to the private auth.users table.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.create_tenant_with_admin(
  p_name text,
  p_slug text,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
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

  -- profiles.id has an FK to auth.users.id; checking profiles is sufficient
  -- and avoids exposing the private auth.users table to the API role.
  IF p_admin_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_admin_user_id
  ) THEN
    RAISE EXCEPTION 'O usuario administrador precisa existir no cadastro e possuir perfil.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_admin_user_id
  ) THEN
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

COMMIT;
