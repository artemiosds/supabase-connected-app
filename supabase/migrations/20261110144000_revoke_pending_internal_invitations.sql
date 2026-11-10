-- Safe cancellation of pending internal staff and technical-support invitations.
-- Auth identities are intentionally preserved; a revoked invite can never self-activate.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.platform_staff
  DROP CONSTRAINT platform_staff_status_check,
  DROP CONSTRAINT platform_staff_activation_consistency;

ALTER TABLE public.platform_staff
  ADD CONSTRAINT platform_staff_status_check
    CHECK (status IN ('invited','active','suspended','revoked')),
  ADD CONSTRAINT platform_staff_activation_consistency CHECK (
    (status IN ('invited','revoked') AND activated_at IS NULL)
    OR (status IN ('active','suspended') AND activated_at IS NOT NULL)
  );

ALTER TABLE public.platform_support_agents
  DROP CONSTRAINT platform_support_agents_status_check;

ALTER TABLE public.platform_support_agents
  ADD CONSTRAINT platform_support_agents_status_check
    CHECK (status IN ('invited','active','suspended','revoked'));

CREATE OR REPLACE FUNCTION public.activate_my_platform_staff()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_email text;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(u.email))
    INTO v_email
  FROM auth.users u
  WHERE u.id=v_user AND u.email_confirmed_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT s.status
    INTO v_status
  FROM public.platform_staff s
  WHERE s.user_id=v_user AND s.email=v_email;

  IF NOT FOUND OR v_status IN ('suspended','revoked') THEN
    RETURN false;
  END IF;

  IF v_status='invited' THEN
    UPDATE public.platform_staff
    SET status='active', activated_at=pg_catalog.now(), updated_at=pg_catalog.now()
    WHERE user_id=v_user AND status='invited';

    INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
    VALUES(
      v_user,'platform_staff.activated','platform_staff',v_user::text,
      pg_catalog.jsonb_build_object('activation','confirmed_email_and_first_password')
    );
  END IF;

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.activate_my_platform_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_my_platform_staff() TO authenticated;

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

  SELECT u.email_confirmed_at IS NOT NULL
    INTO v_confirmed
  FROM auth.users u
  WHERE u.id=v_user;

  IF NOT COALESCE(v_confirmed,false) THEN
    RETURN false;
  END IF;

  SELECT a.status
    INTO v_status
  FROM public.platform_support_agents a
  WHERE a.user_id=v_user;

  IF NOT FOUND OR v_status IN ('suspended','revoked') THEN
    RETURN false;
  END IF;

  IF v_status='invited' THEN
    UPDATE public.platform_support_agents
    SET status='active',updated_at=pg_catalog.now()
    WHERE user_id=v_user AND status='invited';

    INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
    VALUES(
      v_user,'platform_support.agent_activated','platform_support_agents',v_user::text,
      pg_catalog.jsonb_build_object('activation','first_confirmed_sign_in')
    );
  END IF;

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.activate_my_platform_support_agent() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_my_platform_support_agent() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_staff_status(p_user_id uuid,p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_activated timestamptz;
  v_current_status text;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o Administrador Master pode suspender colaboradores.'
      USING ERRCODE='42501';
  END IF;

  IF p_status NOT IN ('active','suspended') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  SELECT activated_at,status
    INTO v_activated,v_current_status
  FROM public.platform_staff
  WHERE user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado.';
  END IF;

  IF v_current_status='revoked' THEN
    RAISE EXCEPTION 'Um convite cancelado não pode ser reativado. Use um novo e-mail exclusivo.';
  END IF;

  IF p_status='active' AND v_activated IS NULL THEN
    RAISE EXCEPTION 'O convite precisa ser aceito antes da ativação.';
  END IF;

  IF p_status='active' AND NOT EXISTS(
    SELECT 1
    FROM auth.users u
    JOIN public.platform_staff s ON s.user_id=u.id
    WHERE u.id=p_user_id
      AND u.email_confirmed_at IS NOT NULL
      AND pg_catalog.lower(pg_catalog.btrim(u.email))=s.email
  ) THEN
    RAISE EXCEPTION 'A conta precisa confirmar o e-mail cadastrado antes da reativação.';
  END IF;

  UPDATE public.platform_staff
  SET status=p_status,
      suspended_at=CASE WHEN p_status='suspended' THEN pg_catalog.now() ELSE NULL END,
      updated_at=pg_catalog.now()
  WHERE user_id=p_user_id;

  INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
  VALUES(
    (SELECT auth.uid()),'platform_staff.status_changed','platform_staff',p_user_id::text,
    pg_catalog.jsonb_build_object('status',p_status)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_staff_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_staff_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_support_agent_status(p_user_id uuid,p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_current_status text;
BEGIN
  IF NOT app_auth.can_manage_platform_support_team() THEN
    RAISE EXCEPTION 'Você não possui permissão para administrar a equipe técnica.'
      USING ERRCODE='42501';
  END IF;

  IF p_status NOT IN ('active','suspended') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  SELECT status
    INTO v_current_status
  FROM public.platform_support_agents
  WHERE user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Técnico não encontrado.';
  END IF;

  IF v_current_status='revoked' THEN
    RAISE EXCEPTION 'Um convite cancelado não pode ser reativado. Use um novo e-mail exclusivo.';
  END IF;

  IF p_status='active' AND NOT EXISTS(
    SELECT 1 FROM auth.users u
    WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O técnico precisa confirmar o e-mail antes da ativação.'
      USING ERRCODE='42501';
  END IF;

  UPDATE public.platform_support_agents
  SET status=p_status,updated_at=pg_catalog.now()
  WHERE user_id=p_user_id;

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
REVOKE ALL ON FUNCTION public.set_platform_support_agent_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_support_agent_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_platform_staff_invitation(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_status text;
  v_email text;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o Administrador Master pode cancelar convites internos.'
      USING ERRCODE='42501';
  END IF;

  SELECT status,email
    INTO v_status,v_email
  FROM public.platform_staff
  WHERE user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite interno não encontrado.';
  END IF;

  IF v_status <> 'invited' THEN
    RAISE EXCEPTION 'Somente convites pendentes podem ser cancelados.';
  END IF;

  UPDATE public.platform_staff
  SET status='revoked',updated_at=pg_catalog.now()
  WHERE user_id=p_user_id AND status='invited';

  INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
  VALUES(
    (SELECT auth.uid()),'platform_staff.invitation_revoked',
    'platform_staff',p_user_id::text,
    pg_catalog.jsonb_build_object('email',v_email,'status','revoked','auth_identity_preserved',true)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.revoke_platform_staff_invitation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_staff_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_platform_support_invitation(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_status text;
  v_display_name text;
BEGIN
  IF NOT app_auth.can_manage_platform_support_team() THEN
    RAISE EXCEPTION 'Você não possui permissão para cancelar convites da equipe técnica.'
      USING ERRCODE='42501';
  END IF;

  SELECT status,display_name
    INTO v_status,v_display_name
  FROM public.platform_support_agents
  WHERE user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite de suporte não encontrado.';
  END IF;

  IF v_status <> 'invited' THEN
    RAISE EXCEPTION 'Somente convites pendentes podem ser cancelados.';
  END IF;

  UPDATE public.platform_support_agents
  SET status='revoked',updated_at=pg_catalog.now()
  WHERE user_id=p_user_id AND status='invited';

  UPDATE public.platform_support_assignments
  SET is_active=false,updated_at=pg_catalog.now()
  WHERE agent_user_id=p_user_id AND is_active=true;

  UPDATE public.platform_support_sessions
  SET ended_at=pg_catalog.now(),ended_by=(SELECT auth.uid())
  WHERE actor_id=p_user_id AND ended_at IS NULL;

  INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
  VALUES(
    (SELECT auth.uid()),'platform_support.invitation_revoked',
    'platform_support_agents',p_user_id::text,
    pg_catalog.jsonb_build_object(
      'display_name',v_display_name,
      'status','revoked',
      'assignments_disabled',true,
      'auth_identity_preserved',true
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.revoke_platform_support_invitation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_support_invitation(uuid) TO authenticated;

COMMIT;
