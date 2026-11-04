-- Resolve a user's confirmed profile through a permission-gated private helper.
-- A local admin cannot SELECT profiles for someone who is not yet a tenant member.
CREATE OR REPLACE FUNCTION app_auth.is_confirmed_tenant_user(p_tenant_id uuid,p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
 IF NOT app_auth.has_tenant_permission(p_tenant_id,'users:create')
   OR NOT app_auth.has_tenant_permission(p_tenant_id,'users:assign_role') THEN
  RAISE EXCEPTION 'Sem permissao para validar usuarios para esta Secretaria.';
 END IF;
 RETURN EXISTS (
  SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
  WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL AND NOT u.is_anonymous
 ) AND NOT EXISTS (
  SELECT 1 FROM public.platform_admins pa
  WHERE pa.user_id=p_user_id AND pa.is_active
 );
END;
$function$;
REVOKE ALL ON FUNCTION app_auth.is_confirmed_tenant_user(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA app_auth TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.is_confirmed_tenant_user(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_tenant_member(p_tenant_id uuid,p_user_id uuid,p_role_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_membership_id uuid;
BEGIN
 IF NOT app_auth.has_tenant_permission(p_tenant_id,'users:create')
   OR NOT app_auth.has_tenant_permission(p_tenant_id,'users:assign_role') THEN
  RAISE EXCEPTION 'Sem permissao para incluir usuarios e atribuir papeis nesta Secretaria.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.status='active') THEN
  RAISE EXCEPTION 'Secretaria inexistente ou inativa.';
 END IF;
 IF NOT app_auth.is_confirmed_tenant_user(p_tenant_id,p_user_id) THEN
  RAISE EXCEPTION 'A conta precisa estar cadastrada, confirmada e nao ser administradora global antes do vinculo.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_roles r WHERE r.id=p_role_id AND r.tenant_id=p_tenant_id) THEN
  RAISE EXCEPTION 'Papel nao pertence a Secretaria selecionada.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tenant_memberships m
  WHERE m.tenant_id=p_tenant_id AND m.user_id=p_user_id AND m.status='active') THEN
  RAISE EXCEPTION 'Este usuario ja possui vinculo ativo nesta Secretaria.';
 END IF;
 INSERT INTO public.tenant_memberships(tenant_id,user_id,status)
 VALUES(p_tenant_id,p_user_id,'active') RETURNING id INTO v_membership_id;
 INSERT INTO public.membership_roles(membership_id,role_id,tenant_id)
 VALUES(v_membership_id,p_role_id,p_tenant_id);
 RETURN v_membership_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.add_tenant_member(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_tenant_member(uuid,uuid,uuid) TO authenticated;
