-- Move sensitive account lookup out of the exposed public schema.
-- Public RPCs are SECURITY INVOKER wrappers; private helpers enforce the caller.
CREATE OR REPLACE FUNCTION app_auth.find_tenant_user_by_email(p_tenant_id uuid,p_email text)
RETURNS TABLE(user_id uuid,full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
 IF NOT app_auth.has_tenant_permission(p_tenant_id,'users:create')
   OR NOT app_auth.has_tenant_permission(p_tenant_id,'users:assign_role') THEN
  RAISE EXCEPTION 'Sem permissao para localizar usuarios para esta Secretaria.';
 END IF;
 IF p_email IS NULL OR pg_catalog.length(pg_catalog.btrim(p_email)) NOT BETWEEN 5 AND 254
   OR pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
  RAISE EXCEPTION 'Informe um e-mail valido.';
 END IF;
 RETURN QUERY
 SELECT u.id,p.full_name FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE pg_catalog.lower(u.email)=pg_catalog.lower(pg_catalog.btrim(p_email))
   AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT u.is_anonymous
   AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=u.id AND pa.is_active)
   AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm
     WHERE tm.tenant_id=p_tenant_id AND tm.user_id=u.id AND tm.status='active')
 LIMIT 1;
END;
$function$;
REVOKE ALL ON FUNCTION app_auth.find_tenant_user_by_email(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.find_tenant_user_by_email(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.find_tenant_user_by_email(p_tenant_id uuid,p_email text)
RETURNS TABLE(user_id uuid,full_name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
 SELECT * FROM app_auth.find_tenant_user_by_email(p_tenant_id,p_email);
$function$;
REVOKE ALL ON FUNCTION public.find_tenant_user_by_email(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_tenant_user_by_email(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION app_auth.list_tenant_admin_candidates()
RETURNS TABLE(user_id uuid,full_name text,email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN
  RAISE EXCEPTION 'Somente o administrador global pode consultar candidatos a administrador municipal.';
 END IF;
 RETURN QUERY
 SELECT p.id,p.full_name,u.email::text
 FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT u.is_anonymous
   AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p.id AND pa.is_active)
 ORDER BY p.full_name,u.email;
END;
$function$;
REVOKE ALL ON FUNCTION app_auth.list_tenant_admin_candidates() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.list_tenant_admin_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tenant_admin_candidates()
RETURNS TABLE(user_id uuid,full_name text,email text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
 SELECT * FROM app_auth.list_tenant_admin_candidates();
$function$;
REVOKE ALL ON FUNCTION public.list_tenant_admin_candidates() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_candidates() TO authenticated;
