BEGIN;

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
  v_user_limit integer;
  v_active_members integer;
  v_pending_invites integer;
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

  -- Release a stale reservation for this same address before creating a new invitation.
  UPDATE public.tenant_invitations i
  SET status = 'expired'
  WHERE i.tenant_id = p_tenant_id
    AND i.invited_email = v_email
    AND i.status = 'pending'
    AND i.expires_at <= pg_catalog.now();

  SELECT t.max_users INTO v_user_limit
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  SELECT count(*)::integer INTO v_active_members
  FROM public.tenant_memberships m
  WHERE m.tenant_id = p_tenant_id
    AND m.status = 'active';

  SELECT count(*)::integer INTO v_pending_invites
  FROM public.tenant_invitations i
  WHERE i.tenant_id = p_tenant_id
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();

  IF COALESCE(v_active_members, 0) + COALESCE(v_pending_invites, 0) >= COALESCE(v_user_limit, 0) THEN
    RAISE EXCEPTION 'Limite de usuários atingido: usuários ativos e convites pendentes já reservam todas as vagas do plano.';
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

COMMENT ON FUNCTION app_auth.create_tenant_invitation(uuid,text,uuid) IS
  'Cria convite após validar permissões, papel, duplicidade e reserva de vaga no limite de usuários do plano.';

COMMIT;