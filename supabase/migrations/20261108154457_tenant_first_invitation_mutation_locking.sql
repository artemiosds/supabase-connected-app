BEGIN;

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
  v_tenant_id uuid;
  v_invitation public.tenant_invitations%ROWTYPE;
  v_invited_email text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  -- Discover the tenant without taking an invitation lock; global lock order is tenant -> invitation.
  SELECT i.tenant_id
    INTO v_tenant_id
  FROM public.tenant_invitations i
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  PERFORM 1
  FROM public.tenants t
  WHERE t.id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secretaria do convite não encontrada.';
  END IF;

  SELECT i.*
    INTO v_invitation
  FROM public.tenant_invitations i
  WHERE i.id = p_invitation_id
    AND i.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.status <> 'pending'
     OR v_invitation.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Convite pendente não encontrado ou expirado.';
  END IF;

  IF NOT app_auth.has_tenant_permission(v_tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(v_tenant_id, 'users:assign_role')
     OR NOT app_auth.is_tenant_in_good_standing(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para atualizar o convite.' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email)
    INTO v_invited_email
  FROM auth.users u
  WHERE u.id = p_invited_user_id
    AND u.deleted_at IS NULL;

  IF v_invited_email IS NULL OR v_invited_email <> v_invitation.invited_email THEN
    RAISE EXCEPTION 'A conta retornada pelo serviço de convites não corresponde ao e-mail convidado.';
  END IF;

  UPDATE public.tenant_invitations
  SET invited_user_id = p_invited_user_id
  WHERE id = p_invitation_id
    AND tenant_id = v_tenant_id
    AND status = 'pending';
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
  v_invitation public.tenant_invitations%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE = '42501';
  END IF;

  -- Discover the tenant without locking the invitation first.
  SELECT i.tenant_id
    INTO v_tenant_id
  FROM public.tenant_invitations i
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  PERFORM 1
  FROM public.tenants t
  WHERE t.id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secretaria do convite não encontrada.';
  END IF;

  SELECT i.*
    INTO v_invitation
  FROM public.tenant_invitations i
  WHERE i.id = p_invitation_id
    AND i.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Somente convites pendentes podem ser cancelados.';
  END IF;

  IF NOT app_auth.has_tenant_permission(v_tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(v_tenant_id, 'users:assign_role')
     OR NOT app_auth.is_tenant_in_good_standing(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar convites nesta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenant_invitations
  SET status = 'revoked',
      revoked_at = pg_catalog.now(),
      revoked_by = v_actor
  WHERE id = p_invitation_id
    AND tenant_id = v_tenant_id
    AND status = 'pending';
END;
$function$;

COMMENT ON FUNCTION app_auth.set_tenant_invitation_auth_user(uuid,uuid) IS
  'Associates an Auth user to a pending invitation using deterministic tenant-before-invitation locking.';
COMMENT ON FUNCTION app_auth.revoke_tenant_invitation(uuid) IS
  'Revokes a pending invitation using deterministic tenant-before-invitation locking.';

COMMIT;