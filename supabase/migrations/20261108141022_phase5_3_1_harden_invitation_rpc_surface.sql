BEGIN;

-- Move privileged invitation logic out of the exposed public API schema.
CREATE OR REPLACE FUNCTION app_auth.create_tenant_invitation(
  p_tenant_id uuid,
  p_email text,
  p_role_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_email text := lower(pg_catalog.btrim(p_email));
  v_id uuid;
BEGIN
  IF v_actor IS NULL
     OR NOT app_auth.has_tenant_permission(p_tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(p_tenant_id, 'users:assign_role')
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para convidar usuários nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  IF v_email IS NULL OR length(v_email) NOT BETWEEN 5 AND 254
     OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Informe um endereço de e-mail válido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Secretaria inexistente ou inativa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_roles r
    WHERE r.id = p_role_id AND r.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'O papel selecionado não pertence à Secretaria.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(u.email) = v_email AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Já existe uma conta com este e-mail. Use a opção de vincular usuário existente.';
  END IF;

  INSERT INTO public.tenant_invitations (
    tenant_id, invited_email, role_id, invited_by
  ) VALUES (
    p_tenant_id, v_email, p_role_id, v_actor
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um convite pendente para este e-mail nesta Secretaria.';
END;
$function$;

CREATE OR REPLACE FUNCTION app_auth.set_tenant_invitation_auth_user(
  p_invitation_id uuid,
  p_invited_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invitation public.tenant_invitations%ROWTYPE;
  v_invited_email text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invitation
  FROM public.tenant_invitations i
  WHERE i.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Convite pendente não encontrado.';
  END IF;

  IF NOT app_auth.has_tenant_permission(v_invitation.tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(v_invitation.tenant_id, 'users:assign_role') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar o convite.' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email) INTO v_invited_email
  FROM auth.users u
  WHERE u.id = p_invited_user_id
    AND u.deleted_at IS NULL;

  IF v_invited_email IS NULL OR v_invited_email <> v_invitation.invited_email THEN
    RAISE EXCEPTION 'A conta retornada pelo serviço de convites não corresponde ao e-mail convidado.';
  END IF;

  UPDATE public.tenant_invitations
  SET invited_user_id = p_invited_user_id
  WHERE id = p_invitation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_auth.accept_my_tenant_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_email text;
  v_confirmed_at timestamptz;
  v_is_anonymous boolean;
  v_invitation record;
  v_membership_id uuid;
  v_accepted integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Entre na plataforma para aceitar seus convites.' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at, u.is_anonymous
    INTO v_email, v_confirmed_at, v_is_anonymous
  FROM auth.users u
  WHERE u.id = v_user_id;

  IF v_email IS NULL OR v_confirmed_at IS NULL OR COALESCE(v_is_anonymous, true) THEN
    RAISE EXCEPTION 'Confirme o e-mail antes de aceitar o convite.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenant_invitations i
  SET status = 'expired'
  WHERE i.status = 'pending'
    AND i.invited_email = v_email
    AND i.expires_at <= pg_catalog.now()
    AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id);

  IF EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = v_user_id AND pa.is_active
  ) THEN
    UPDATE public.tenant_invitations i
    SET status = 'revoked',
        revoked_at = pg_catalog.now(),
        revoked_by = i.invited_by
    WHERE i.status = 'pending'
      AND i.invited_email = v_email
      AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id);
    RETURN 0;
  END IF;

  FOR v_invitation IN
    SELECT i.id, i.tenant_id, i.role_id
    FROM public.tenant_invitations i
    WHERE i.invited_email = v_email
      AND i.status = 'pending'
      AND i.expires_at > pg_catalog.now()
      AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id)
    ORDER BY i.created_at, i.id
    FOR UPDATE
  LOOP
    IF NOT app_auth.is_tenant_in_good_standing(v_invitation.tenant_id) THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_roles r
      WHERE r.id = v_invitation.role_id AND r.tenant_id = v_invitation.tenant_id
    ) THEN
      UPDATE public.tenant_invitations
      SET status = 'revoked', revoked_at = pg_catalog.now(), revoked_by = invited_by
      WHERE id = v_invitation.id;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.tenant_id = v_invitation.tenant_id AND m.user_id = v_user_id
    ) THEN
      UPDATE public.tenant_invitations SET status = 'already_member'
      WHERE id = v_invitation.id;
      CONTINUE;
    END IF;

    INSERT INTO public.tenant_memberships (tenant_id, user_id, status)
    VALUES (v_invitation.tenant_id, v_user_id, 'active')
    RETURNING id INTO v_membership_id;

    INSERT INTO public.membership_roles (membership_id, role_id, tenant_id)
    VALUES (v_membership_id, v_invitation.role_id, v_invitation.tenant_id);

    UPDATE public.tenant_invitations
    SET status = 'accepted', accepted_at = pg_catalog.now(), accepted_by = v_user_id
    WHERE id = v_invitation.id;

    v_accepted := v_accepted + 1;
  END LOOP;

  RETURN v_accepted;
END;
$function$;

CREATE OR REPLACE FUNCTION app_auth.revoke_tenant_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  SELECT i.tenant_id, i.status INTO v_tenant_id, v_status
  FROM public.tenant_invitations i
  WHERE i.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'Convite pendente não encontrado.';
  END IF;

  IF NOT app_auth.has_tenant_permission(v_tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(v_tenant_id, 'users:assign_role')
     OR NOT app_auth.is_tenant_in_good_standing(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar convites nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenant_invitations
  SET status = 'revoked', revoked_at = pg_catalog.now(), revoked_by = (SELECT auth.uid())
  WHERE id = p_invitation_id;
END;
$function$;

REVOKE ALL ON FUNCTION app_auth.create_tenant_invitation(uuid,text,uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION app_auth.set_tenant_invitation_auth_user(uuid,uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION app_auth.accept_my_tenant_invitations()
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION app_auth.revoke_tenant_invitation(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION app_auth.create_tenant_invitation(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.set_tenant_invitation_auth_user(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.accept_my_tenant_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.revoke_tenant_invitation(uuid) TO authenticated;

-- Public API stays stable, but all exposed entry points are invoker wrappers.
CREATE OR REPLACE FUNCTION public.create_tenant_invitation(
  p_tenant_id uuid,
  p_email text,
  p_role_id uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT app_auth.create_tenant_invitation(p_tenant_id, p_email, p_role_id);
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_invitation_auth_user(
  p_invitation_id uuid,
  p_invited_user_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT app_auth.set_tenant_invitation_auth_user(p_invitation_id, p_invited_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.accept_my_tenant_invitations()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT app_auth.accept_my_tenant_invitations();
$function$;

CREATE OR REPLACE FUNCTION public.revoke_tenant_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT app_auth.revoke_tenant_invitation(p_invitation_id);
$function$;

REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid,text,uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_tenant_invitation_auth_user(uuid,uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.accept_my_tenant_invitations()
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revoke_tenant_invitation(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_invitation_auth_user(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_my_tenant_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_invitation(uuid) TO authenticated;

COMMENT ON FUNCTION public.create_tenant_invitation(uuid,text,uuid) IS
  'Invoker wrapper; privileged invitation checks execute internally in app_auth.';
COMMENT ON FUNCTION public.accept_my_tenant_invitations() IS
  'Invoker wrapper; invitation acceptance executes internally in app_auth after JWT-bound user verification.';
COMMIT;