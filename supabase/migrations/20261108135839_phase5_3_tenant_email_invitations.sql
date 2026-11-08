BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invited_email text NOT NULL,
  invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role_id uuid NOT NULL,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_invitations_role_tenant_fk
    FOREIGN KEY (role_id, tenant_id) REFERENCES public.tenant_roles(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_invitations_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT tenant_invitations_email_normalized_check
    CHECK (invited_email = lower(btrim(invited_email))
      AND length(invited_email) BETWEEN 5 AND 254
      AND invited_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT tenant_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'already_member')),
  CONSTRAINT tenant_invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT tenant_invitations_accepted_fields_check
    CHECK ((status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL) OR status <> 'accepted'),
  CONSTRAINT tenant_invitations_revoked_fields_check
    CHECK ((status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL) OR status <> 'revoked')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_invitations_pending_email
  ON public.tenant_invitations (tenant_id, invited_email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant_created
  ON public.tenant_invitations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email_status
  ON public.tenant_invitations (invited_email, status, expires_at);

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_invitations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.tenant_invitations FROM authenticated;
GRANT SELECT ON TABLE public.tenant_invitations TO authenticated;
GRANT ALL ON TABLE public.tenant_invitations TO service_role;

DROP POLICY IF EXISTS p_tenant_invitations_select ON public.tenant_invitations;
CREATE POLICY p_tenant_invitations_select
  ON public.tenant_invitations FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (SELECT app_auth.has_tenant_permission(tenant_id, 'users:view'))
  );

CREATE OR REPLACE FUNCTION public.fn_audit_tenant_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row jsonb;
  v_tenant_id uuid;
  v_id uuid;
  v_actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := pg_catalog.to_jsonb(OLD);
  ELSE
    v_row := pg_catalog.to_jsonb(NEW);
  END IF;

  v_tenant_id := (v_row ->> 'tenant_id')::uuid;
  v_id := (v_row ->> 'id')::uuid;
  v_actor := COALESCE(
    (SELECT auth.uid()),
    NULLIF(v_row ->> 'accepted_by', '')::uuid,
    NULLIF(v_row ->> 'revoked_by', '')::uuid,
    NULLIF(v_row ->> 'invited_by', '')::uuid
  );

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    v_tenant_id, v_actor, TG_OP, 'tenant_invitations', v_id::text,
    pg_catalog.jsonb_build_object(
      'status', v_row ->> 'status',
      'role_id', v_row ->> 'role_id'
    ),
    pg_catalog.now()
  );

  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_audit_tenant_invitation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_audit_tenant_invitations ON public.tenant_invitations;
CREATE TRIGGER trg_audit_tenant_invitations
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_invitations
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_tenant_invitation();

CREATE OR REPLACE FUNCTION public.create_tenant_invitation(
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

REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid,text,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid,text,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_tenant_invitation_auth_user(
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

REVOKE ALL ON FUNCTION public.set_tenant_invitation_auth_user(uuid,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_tenant_invitation_auth_user(uuid,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_my_tenant_invitations()
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

REVOKE ALL ON FUNCTION public.accept_my_tenant_invitations()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_tenant_invitations()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_tenant_invitation(p_invitation_id uuid)
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

REVOKE ALL ON FUNCTION public.revoke_tenant_invitation(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_invitation(uuid)
  TO authenticated;

COMMENT ON TABLE public.tenant_invitations IS
  'Convites rastreáveis por e-mail; o vínculo só fica ativo após confirmação e aceite pelo convidado.';
COMMENT ON FUNCTION public.accept_my_tenant_invitations() IS
  'Aceita convites pendentes correspondentes ao e-mail confirmado do usuário autenticado.';
COMMIT;