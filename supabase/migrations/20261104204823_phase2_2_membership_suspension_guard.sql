-- Impede auto-suspensão e bloqueio do último administrador de uma Secretaria.
CREATE OR REPLACE FUNCTION public.fn_guard_tenant_membership_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE v_active_admins bigint;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'O vínculo não pode ser transferido para outro usuário ou Secretaria.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('suspended','inactive') THEN
    IF NOT app_auth.has_tenant_permission(OLD.tenant_id,'users:delete') THEN
      RAISE EXCEPTION 'Sem permissão para suspender usuários nesta Secretaria.';
    END IF;
    IF NEW.user_id = (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'Você não pode suspender o próprio acesso à Secretaria.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.membership_roles mr
      JOIN public.tenant_roles r ON r.id=mr.role_id AND r.tenant_id=mr.tenant_id
      WHERE mr.membership_id=OLD.id AND mr.tenant_id=OLD.tenant_id AND r.slug='admin'
    ) THEN
      SELECT count(DISTINCT m.id) INTO v_active_admins
      FROM public.tenant_memberships m
      JOIN public.membership_roles mr ON mr.membership_id=m.id AND mr.tenant_id=m.tenant_id
      JOIN public.tenant_roles r ON r.id=mr.role_id AND r.tenant_id=mr.tenant_id
      WHERE m.tenant_id=OLD.tenant_id AND m.status='active' AND r.slug='admin';
      IF v_active_admins <= 1 THEN
        RAISE EXCEPTION 'A Secretaria precisa manter pelo menos um administrador ativo.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_tenant_membership_status() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_tenant_membership_status ON public.tenant_memberships;
CREATE TRIGGER trg_guard_tenant_membership_status
BEFORE UPDATE ON public.tenant_memberships
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_tenant_membership_status();
