-- Autoriza a interface a exibir edição dos dados institucionais somente a membros locais.
CREATE OR REPLACE FUNCTION public.get_tenant_settings_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean,can_edit boolean)
LANGUAGE sql STABLE SET search_path = '' AS $function$
 SELECT NOT app_auth.is_platform_admin() AND app_auth.has_tenant_permission(p_tenant_id,'org:view'),
        NOT app_auth.is_platform_admin() AND app_auth.has_tenant_permission(p_tenant_id,'org:edit');
$function$;
REVOKE ALL ON FUNCTION public.get_tenant_settings_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_settings_capabilities(uuid) TO authenticated;
