-- Complete invitation activation and self-scoped support-session context.
-- This migration is safe to apply after 20261109162100_preserve_supplier_permission_path.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.platform_support_agents
  DROP CONSTRAINT IF EXISTS platform_support_agents_status_check;
ALTER TABLE public.platform_support_agents
  ADD CONSTRAINT platform_support_agents_status_check
  CHECK (status IN ('invited','active','suspended'));

CREATE OR REPLACE FUNCTION public.register_platform_support_agent(
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_tenant_id uuid,
  p_can_view_suppliers boolean DEFAULT true,
  p_can_create_suppliers boolean DEFAULT false,
  p_can_update_suppliers boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_email text;
  v_confirmed timestamptz;
  v_name text := pg_catalog.btrim(COALESCE(p_display_name,''));
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o Administrador Master pode convidar técnicos.'
      USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário e organização são obrigatórios.';
  END IF;
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Informe o nome completo do técnico.';
  END IF;
  IF p_email IS NULL OR pg_catalog.length(pg_catalog.btrim(p_email)) > 254
     OR pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF NOT p_can_view_suppliers AND (p_can_create_suppliers OR p_can_update_suppliers) THEN
    RAISE EXCEPTION 'Criar ou editar exige permissão de consulta.';
  END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)),u.email_confirmed_at
    INTO v_email,v_confirmed
  FROM auth.users u WHERE u.id=p_user_id;
  IF NOT FOUND OR v_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email)) THEN
    RAISE EXCEPTION 'A conta de autenticação não corresponde ao e-mail convidado.';
  END IF;
  IF v_confirmed IS NOT NULL THEN
    RAISE EXCEPTION 'Esta conta já está confirmada. Use uma conta nova e exclusiva para suporte.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id=p_user_id AND pa.is_active
  ) OR EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.user_id=p_user_id AND tm.status='active'
  ) OR EXISTS (
    SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=p_user_id
  ) THEN
    RAISE EXCEPTION 'Esta conta já possui vínculo administrativo, municipal ou de suporte.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id=p_tenant_id AND t.status='active'
      AND app_auth.is_tenant_in_good_standing(t.id)
      AND app_auth.is_tenant_module_enabled(t.id,'fornecedores')
  ) THEN
    RAISE EXCEPTION 'A organização está inativa ou não possui o módulo Fornecedores habilitado.';
  END IF;

  INSERT INTO public.platform_support_agents(user_id,display_name,status,created_by)
  VALUES(p_user_id,v_name,'invited',(SELECT auth.uid()));

  INSERT INTO public.platform_support_assignments(
    agent_user_id,tenant_id,can_view_suppliers,can_create_suppliers,
    can_update_suppliers,is_active,created_by
  )
  VALUES(
    p_user_id,p_tenant_id,p_can_view_suppliers,p_can_create_suppliers,
    p_can_update_suppliers,true,(SELECT auth.uid())
  );

  INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
  VALUES(
    (SELECT auth.uid()),p_tenant_id,'platform_support.agent_invited',
    'platform_support_agents',p_user_id::text,
    pg_catalog.jsonb_build_object(
      'support_agent_id',p_user_id,'email',v_email,'display_name',v_name,
      'can_view_suppliers',p_can_view_suppliers,
      'can_create_suppliers',p_can_create_suppliers,
      'can_update_suppliers',p_can_update_suppliers,
      'status','invited'
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_my_platform_support_agent()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_confirmed boolean := false;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501';
  END IF;
  SELECT u.email_confirmed_at IS NOT NULL INTO v_confirmed
  FROM auth.users u WHERE u.id=v_user;
  IF NOT COALESCE(v_confirmed,false) THEN
    RETURN false;
  END IF;
  SELECT a.status INTO v_status
  FROM public.platform_support_agents a WHERE a.user_id=v_user;
  IF NOT FOUND OR v_status='suspended' THEN
    RETURN false;
  END IF;
  IF v_status='invited' THEN
    UPDATE public.platform_support_agents
      SET status='active',updated_at=pg_catalog.now()
      WHERE user_id=v_user AND status='invited';
    INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
    VALUES(v_user,'platform_support.agent_activated','platform_support_agents',v_user::text,
      pg_catalog.jsonb_build_object('activation','first_confirmed_sign_in'));
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.activate_my_platform_support_agent() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_my_platform_support_agent() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_platform_support_status()
RETURNS TABLE(
  is_agent boolean,
  agent_status text,
  is_platform_admin boolean,
  session_id uuid,
  tenant_id uuid,
  tenant_name text,
  reason text,
  expires_at timestamptz,
  allowed_actions text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT
    EXISTS(
      SELECT 1 FROM public.platform_support_agents a
      WHERE a.user_id=(SELECT auth.uid())
    ),
    (SELECT a.status FROM public.platform_support_agents a
      WHERE a.user_id=(SELECT auth.uid())),
    app_auth.is_platform_admin(),
    s.id,
    s.tenant_id,
    t.name,
    s.reason,
    s.expires_at,
    s.allowed_actions
  FROM (SELECT (SELECT auth.uid()) AS actor_id) actor
  LEFT JOIN LATERAL (
    SELECT ps.id,ps.tenant_id,ps.reason,ps.expires_at,ps.allowed_actions
    FROM public.platform_support_sessions ps
    WHERE ps.actor_id=actor.actor_id
      AND ps.ended_at IS NULL
      AND ps.expires_at>pg_catalog.now()
    ORDER BY ps.started_at DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN public.tenants t ON t.id=s.tenant_id
  WHERE actor.actor_id IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.get_my_platform_support_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_platform_support_status() TO authenticated;

COMMIT;
