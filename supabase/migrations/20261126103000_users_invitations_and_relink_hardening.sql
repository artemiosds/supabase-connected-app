-- Endurecimento de Usuários e Convites:
-- 1) Permite revincular/reativar usuário previamente suspenso em add_tenant_member sem colidir com uq_membership_tenant_user.
-- 2) Garante que find_tenant_user_by_email não retorne contas internas (platform_staff) ou de suporte (platform_support_agents).
-- 3) Corrige create_tenant_invitation para bloquear somente contas Auth já confirmadas (email_confirmed_at IS NOT NULL), evitando deadlock.

BEGIN;

CREATE OR REPLACE FUNCTION public.add_tenant_member(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_membership_id uuid;
  v_existing_status public.membership_status;
BEGIN
  IF NOT app_auth.has_tenant_permission(p_tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(p_tenant_id, 'users:assign_role') THEN
    RAISE EXCEPTION 'Sem permissao para incluir usuarios e atribuir papeis nesta Secretaria.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.status = 'active'
  ) OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) THEN
    RAISE EXCEPTION 'Secretaria inexistente, inativa ou sem regularidade operacional.';
  END IF;

  IF NOT app_auth.is_confirmed_tenant_user(p_tenant_id, p_user_id) THEN
    RAISE EXCEPTION 'A conta precisa estar cadastrada, confirmada e nao ser administradora global antes do vinculo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_roles r
    WHERE r.id = p_role_id AND r.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Papel nao pertence a Secretaria selecionada.';
  END IF;

  SELECT m.id, m.status
  INTO v_membership_id, v_existing_status
  FROM public.tenant_memberships m
  WHERE m.tenant_id = p_tenant_id
    AND m.user_id = p_user_id
  FOR UPDATE;

  IF v_existing_status = 'active' THEN
    RAISE EXCEPTION 'Este usuario ja possui vinculo ativo nesta Secretaria.';
  END IF;

  IF v_membership_id IS NOT NULL THEN
    -- Reativa vínculo previamente suspenso/inativo e atualiza o papel sem violar uq_membership_tenant_user.
    UPDATE public.tenant_memberships
    SET status = 'active'
    WHERE id = v_membership_id
      AND tenant_id = p_tenant_id;

    DELETE FROM public.membership_roles mr
    WHERE mr.membership_id = v_membership_id
      AND mr.tenant_id = p_tenant_id;

    INSERT INTO public.membership_roles (membership_id, role_id, tenant_id)
    VALUES (v_membership_id, p_role_id, p_tenant_id);

    RETURN v_membership_id;
  END IF;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, status)
  VALUES (p_tenant_id, p_user_id, 'active')
  RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_roles (membership_id, role_id, tenant_id)
  VALUES (v_membership_id, p_role_id, p_tenant_id);

  RETURN v_membership_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_auth.find_tenant_user_by_email(
  p_tenant_id uuid,
  p_email text
)
RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT app_auth.has_tenant_permission(p_tenant_id, 'users:create')
     OR NOT app_auth.has_tenant_permission(p_tenant_id, 'users:assign_role') THEN
    RAISE EXCEPTION 'Sem permissao para localizar usuarios para esta Secretaria.';
  END IF;

  IF p_email IS NULL
     OR pg_catalog.length(pg_catalog.btrim(p_email)) NOT BETWEEN 5 AND 254
     OR pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  RETURN QUERY
  SELECT u.id, p.full_name
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
    AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND NOT u.is_anonymous
    AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id AND pa.is_active)
    AND NOT EXISTS (SELECT 1 FROM public.platform_staff ps WHERE ps.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = p_tenant_id AND tm.user_id = u.id AND tm.status = 'active'
    )
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION app_auth.create_tenant_invitation(
  p_tenant_id uuid,
  p_email text,
  p_role_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_email text := lower(pg_catalog.btrim(p_email));
  v_id uuid;
  v_limit integer;
  v_active_count integer := 0;
  v_pending_count integer := 0;
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
    WHERE lower(u.email) = v_email
      AND u.deleted_at IS NULL
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Já existe uma conta confirmada com este e-mail. Use a opção de vincular usuário existente.';
  END IF;

  SELECT t.max_users
    INTO v_limit
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Secretaria não encontrada para aplicar o limite de usuários.';
  END IF;

  UPDATE public.tenant_invitations i
  SET status = 'expired'
  WHERE i.tenant_id = p_tenant_id
    AND i.status = 'pending'
    AND i.expires_at <= pg_catalog.now();

  SELECT count(*)::integer INTO v_active_count
  FROM public.tenant_memberships m
  WHERE m.tenant_id = p_tenant_id
    AND m.status = 'active';

  SELECT count(*)::integer INTO v_pending_count
  FROM public.tenant_invitations i
  WHERE i.tenant_id = p_tenant_id
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();

  IF v_active_count + v_pending_count >= v_limit THEN
    RAISE EXCEPTION
      'Limite de usuários atingido: usuários ativos e convites pendentes já reservam todas as vagas do plano.';
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

COMMIT;
