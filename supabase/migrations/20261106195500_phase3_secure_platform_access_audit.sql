-- Registra tentativa negada sem SECURITY DEFINER.
-- O usuário autenticado só pode inserir o evento exato da própria tentativa no /admin-master.
GRANT INSERT ON TABLE public.audit_events TO authenticated;

DROP POLICY IF EXISTS p_platform_admin_denied_attempt_insert ON public.audit_events;
CREATE POLICY p_platform_admin_denied_attempt_insert
  ON public.audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IS NULL
    AND actor_id = (SELECT auth.uid())
    AND action = 'ACCESS_DENIED'
    AND entity = 'platform_admin_route'
    AND entity_id = '/admin-master'
    AND details->>'route' = '/admin-master'
  );

ALTER FUNCTION public.log_platform_admin_access_attempt(text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.log_platform_admin_access_attempt(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.log_platform_admin_access_attempt(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_platform_admin_access_attempt(p_route text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501';
  END IF;
  IF p_route IS DISTINCT FROM '/admin-master' THEN
    RAISE EXCEPTION 'Rota de auditoria inválida.' USING ERRCODE='42501';
  END IF;
  IF app_auth.is_platform_admin() THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
  VALUES(NULL,(SELECT auth.uid()),'ACCESS_DENIED','platform_admin_route','/admin-master',
    pg_catalog.jsonb_build_object('route','/admin-master'));
END;
$function$;

COMMENT ON POLICY p_platform_admin_denied_attempt_insert ON public.audit_events IS
  'Permite somente o próprio usuário autenticado registrar tentativa negada da rota /admin-master.';
COMMENT ON FUNCTION public.log_platform_admin_access_attempt(text) IS
  'Auditoria de acesso negado ao Master executada como invoker e limitada por política RLS.';