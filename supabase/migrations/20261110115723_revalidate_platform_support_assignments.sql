-- Revalidate support assignment and action grants on every supplier authorization check.
-- This closes sessions immediately when an agent or assignment is suspended/revoked.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

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

-- Suspending an assignment ends any currently open session for that agent/tenant.
CREATE OR REPLACE FUNCTION public.set_platform_support_assignment(
  p_agent_user_id uuid,
  p_tenant_id uuid,
  p_is_active boolean,
  p_can_view_suppliers boolean DEFAULT true,
  p_can_create_suppliers boolean DEFAULT false,
  p_can_update_suppliers boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o Administrador Master pode atribuir Secretarias.'
      USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_support_agents a
    WHERE a.user_id=p_agent_user_id AND a.status='active'
  ) THEN
    RAISE EXCEPTION 'Técnico não cadastrado ou suspenso.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id) THEN
    RAISE EXCEPTION 'Organização não encontrada.';
  END IF;
  IF NOT p_can_view_suppliers AND (p_can_create_suppliers OR p_can_update_suppliers) THEN
    RAISE EXCEPTION 'Criar ou editar exige permissão de consulta.';
  END IF;

  INSERT INTO public.platform_support_assignments(
    agent_user_id,tenant_id,is_active,can_view_suppliers,
    can_create_suppliers,can_update_suppliers,created_by
  )
  VALUES(
    p_agent_user_id,p_tenant_id,p_is_active,p_can_view_suppliers,
    p_can_create_suppliers,p_can_update_suppliers,(SELECT auth.uid())
  )
  ON CONFLICT(agent_user_id,tenant_id) DO UPDATE
  SET is_active=EXCLUDED.is_active,
      can_view_suppliers=EXCLUDED.can_view_suppliers,
      can_create_suppliers=EXCLUDED.can_create_suppliers,
      can_update_suppliers=EXCLUDED.can_update_suppliers,
      updated_at=pg_catalog.now();

  IF NOT p_is_active THEN
    UPDATE public.platform_support_sessions
    SET ended_at=pg_catalog.now(),ended_by=(SELECT auth.uid())
    WHERE actor_id=p_agent_user_id AND tenant_id=p_tenant_id AND ended_at IS NULL;
  END IF;

  INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
  VALUES(
    (SELECT auth.uid()),p_tenant_id,'platform_support.assignment_changed',
    'platform_support_assignments',p_agent_user_id::text,
    pg_catalog.jsonb_build_object(
      'agent_user_id',p_agent_user_id,'is_active',p_is_active,
      'can_view_suppliers',p_can_view_suppliers,
      'can_create_suppliers',p_can_create_suppliers,
      'can_update_suppliers',p_can_update_suppliers
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean)
  TO authenticated;

COMMIT;
