-- Keep platform support identities exclusive from municipal and global admin roles.
-- A technician always uses a dedicated Auth account and never gains tenant membership.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.fn_prevent_platform_support_role_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME='tenant_memberships' THEN
    v_user_id := NEW.user_id;
    IF EXISTS (
      SELECT 1 FROM public.platform_support_agents a
      WHERE a.user_id=v_user_id
    ) THEN
      RAISE EXCEPTION 'Contas da equipe de suporte não podem receber vínculo municipal. Use uma conta municipal exclusiva.'
        USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='platform_admins' THEN
    v_user_id := NEW.user_id;
    IF EXISTS (
      SELECT 1 FROM public.platform_support_agents a
      WHERE a.user_id=v_user_id
    ) THEN
      RAISE EXCEPTION 'Uma conta técnica de suporte não pode ser promovida a Administrador Master. Use uma conta exclusiva.'
        USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='platform_support_agents' THEN
    v_user_id := NEW.user_id;
    IF EXISTS (
      SELECT 1 FROM public.platform_admins pa
      WHERE pa.user_id=v_user_id
    ) THEN
      RAISE EXCEPTION 'Administradores Master não podem ser cadastrados como técnicos de suporte.'
        USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id=v_user_id
    ) THEN
      RAISE EXCEPTION 'Contas com histórico de vínculo municipal não podem ser cadastradas como técnicos de suporte. Use uma conta exclusiva.'
        USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_prevent_platform_support_role_overlap()
  FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS trg_prevent_support_tenant_membership_overlap ON public.tenant_memberships;
CREATE TRIGGER trg_prevent_support_tenant_membership_overlap
  BEFORE INSERT OR UPDATE OF user_id,status ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_support_role_overlap();

DROP TRIGGER IF EXISTS trg_prevent_support_master_role_overlap ON public.platform_admins;
CREATE TRIGGER trg_prevent_support_master_role_overlap
  BEFORE INSERT OR UPDATE OF user_id,is_active ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_support_role_overlap();

DROP TRIGGER IF EXISTS trg_prevent_support_agent_role_overlap ON public.platform_support_agents;
CREATE TRIGGER trg_prevent_support_agent_role_overlap
  BEFORE INSERT OR UPDATE OF user_id,status ON public.platform_support_agents
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_support_role_overlap();

CREATE OR REPLACE FUNCTION public.list_tenant_admin_candidates()
RETURNS TABLE(user_id uuid,full_name text,email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master pode consultar candidatos administrativos.'
      USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT p.id,p.full_name,u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id=p.id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND NOT u.is_anonymous
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=p.id
    )
  ORDER BY p.full_name,u.email;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_tenant_admin_candidates()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_candidates()
  TO authenticated;

COMMIT;
