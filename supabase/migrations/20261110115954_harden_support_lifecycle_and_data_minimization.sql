-- Final hardening for technical support identities and data minimization.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.platform_support_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_sessions FORCE ROW LEVEL SECURITY;

-- The legacy RPC returns commercial billing fields and is not used by the client.
-- Support agents must only use list_my_platform_support_tenants_safe().
REVOKE ALL ON FUNCTION public.list_my_platform_support_tenants() FROM PUBLIC,anon,authenticated,service_role;

-- A technician can only enter an active state after the invitation email is confirmed.
CREATE OR REPLACE FUNCTION public.set_platform_support_agent_status(
  p_user_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o Administrador Master pode alterar a equipe.'
      USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('active','suspended') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;
  IF p_status='active' AND NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O técnico precisa confirmar o e-mail antes da ativação.'
      USING ERRCODE='42501';
  END IF;

  UPDATE public.platform_support_agents
  SET status=p_status,updated_at=pg_catalog.now()
  WHERE user_id=p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Técnico não encontrado.';
  END IF;

  IF p_status='suspended' THEN
    UPDATE public.platform_support_sessions
    SET ended_at=pg_catalog.now(),ended_by=(SELECT auth.uid())
    WHERE actor_id=p_user_id AND ended_at IS NULL;
  END IF;

  INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
  VALUES(
    (SELECT auth.uid()),'platform_support.agent_status_changed',
    'platform_support_agents',p_user_id::text,
    pg_catalog.jsonb_build_object('status',p_status)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_support_agent_status(uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_support_agent_status(uuid,text)
  TO authenticated;

-- Confirm email ownership for the entire duration of a technician session.
CREATE OR REPLACE FUNCTION app_auth.has_active_supplier_support_session(
  p_tenant_id uuid,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.platform_support_sessions s
      JOIN public.platform_support_agents a
        ON a.user_id=s.actor_id AND a.status='active'
      JOIN auth.users u
        ON u.id=s.actor_id AND u.email_confirmed_at IS NOT NULL
      JOIN public.platform_support_assignments x
        ON x.agent_user_id=s.actor_id
       AND x.tenant_id=s.tenant_id
       AND x.is_active
      JOIN public.tenants t ON t.id=s.tenant_id
      WHERE s.actor_id=(SELECT auth.uid())
        AND s.tenant_id=p_tenant_id
        AND s.ended_at IS NULL
        AND s.expires_at>pg_catalog.now()
        AND t.status='active'
        AND app_auth.is_tenant_in_good_standing(s.tenant_id)
        AND app_auth.is_tenant_module_enabled(s.tenant_id,'fornecedores')
        AND p_permission_code=ANY(s.allowed_actions)
        AND CASE p_permission_code
          WHEN 'suppliers:view' THEN x.can_view_suppliers
          WHEN 'suppliers:create' THEN x.can_create_suppliers
          WHEN 'suppliers:update' THEN x.can_update_suppliers
          ELSE false
        END
    )
    OR EXISTS (
      SELECT 1
      FROM public.platform_support_sessions s
      JOIN public.platform_admins pa
        ON pa.user_id=s.actor_id AND pa.is_active
      JOIN public.tenants t ON t.id=s.tenant_id
      WHERE s.actor_id=(SELECT auth.uid())
        AND s.tenant_id=p_tenant_id
        AND s.ended_at IS NULL
        AND s.expires_at>pg_catalog.now()
        AND t.status='active'
        AND app_auth.is_tenant_in_good_standing(s.tenant_id)
        AND app_auth.is_tenant_module_enabled(s.tenant_id,'fornecedores')
        AND p_permission_code=ANY(s.allowed_actions)
    );
$function$;
REVOKE ALL ON FUNCTION app_auth.has_active_supplier_support_session(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.has_active_supplier_support_session(uuid,text)
  TO authenticated;

COMMIT;
