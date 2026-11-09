-- Seleção de administradores municipais: apenas contas confirmadas,
-- não anônimas, não removidas e não administradores globais.
CREATE OR REPLACE FUNCTION public.list_tenant_admin_candidates()
RETURNS TABLE(user_id uuid, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o administrador global pode consultar candidatos a administrador municipal.';
  END IF;
  RETURN QUERY
  SELECT p.id,p.full_name,u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id=p.id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND NOT u.is_anonymous
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_admins pa
      WHERE pa.user_id=p.id AND pa.is_active
    )
  ORDER BY p.full_name,u.email;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_tenant_admin_candidates() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_candidates() TO authenticated;

-- Harden the provisioning RPC so a municipal administrator must be a confirmed account.
-- A subsequent migration moves the auth.users check behind a restricted app_auth helper
-- because authenticated has no direct SELECT on auth.users.
CREATE OR REPLACE FUNCTION public.create_tenant_with_admin(
 p_name text,p_slug text,p_admin_user_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
 v_tenant_id uuid; v_membership_id uuid; v_admin_role_id uuid; v_manager_role_id uuid;
 v_operator_role_id uuid; v_viewer_role_id uuid; v_slug text;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN
  RAISE EXCEPTION 'Acesso negado: somente superadministrador da plataforma pode provisionar organizacoes.';
 END IF;
 IF p_admin_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_admin_user_id) THEN
  RAISE EXCEPTION 'O usuario administrador precisa existir no cadastro e possuir perfil.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_admin_user_id
   AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT u.is_anonymous) THEN
  RAISE EXCEPTION 'Confirme o e-mail da conta municipal antes de criar a Secretaria.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_admin_user_id AND pa.is_active) THEN
  RAISE EXCEPTION 'Superadministrador global nao pode ser administrador municipal.';
 END IF;
 IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 3 AND 160 THEN
  RAISE EXCEPTION 'Nome da organizacao invalido (3 a 160 caracteres).';
 END IF;
 v_slug:=pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug,'')));
 IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR pg_catalog.length(v_slug) NOT BETWEEN 3 AND 63 THEN
  RAISE EXCEPTION 'Slug invalido.';
 END IF;
 INSERT INTO public.tenants(name,slug,created_by,status)
 VALUES(pg_catalog.btrim(p_name),v_slug,(SELECT auth.uid()),'active') RETURNING id INTO v_tenant_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Administrador da Organizacao','admin','Administracao da organizacao',true) RETURNING id INTO v_admin_role_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Gestor','manager','Gestao com privilegios limitados',true) RETURNING id INTO v_manager_role_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Operador','operator','Operacao com privilegios limitados',true) RETURNING id INTO v_operator_role_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Consulta','viewer','Consulta com privilegios limitados',true) RETURNING id INTO v_viewer_role_id;
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_admin_role_id,p.id FROM public.permissions p;
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_manager_role_id,p.id FROM public.permissions p
 WHERE p.code IN('org:view','users:view','suppliers:view','suppliers:create','suppliers:update','documents:view','documents:create','documents:update','documents:sign');
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_operator_role_id,p.id FROM public.permissions p
 WHERE p.code IN('org:view','suppliers:view','suppliers:create','documents:view','documents:create');
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_viewer_role_id,p.id FROM public.permissions p
 WHERE p.code IN('org:view','suppliers:view','documents:view');
 INSERT INTO public.tenant_memberships(tenant_id,user_id,status) VALUES(v_tenant_id,p_admin_user_id,'active')
 RETURNING id INTO v_membership_id;
 INSERT INTO public.membership_roles(membership_id,role_id,tenant_id) VALUES(v_membership_id,v_admin_role_id,v_tenant_id);
 RETURN pg_catalog.jsonb_build_object('success',true,'tenant_id',v_tenant_id,'slug',v_slug,'admin_user_id',p_admin_user_id);
END;
$function$;
