-- Reuse existing membership_roles audit triggers. The authenticated client
-- cannot INSERT directly into protected audit_events.
CREATE OR REPLACE FUNCTION public.set_tenant_member_role(
 p_membership_id uuid,p_role_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
 v_tenant_id uuid; v_user_id uuid; v_target_is_admin boolean; v_new_is_admin boolean; v_active_admins bigint;
BEGIN
 SELECT tm.tenant_id,tm.user_id INTO v_tenant_id,v_user_id
 FROM public.tenant_memberships tm WHERE tm.id=p_membership_id FOR UPDATE;
 IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Vinculo de usuario nao encontrado.'; END IF;
 IF NOT app_auth.has_tenant_permission(v_tenant_id,'users:assign_role') THEN
  RAISE EXCEPTION 'Sem permissao para alterar papeis nesta Secretaria.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenant_roles r WHERE r.id=p_role_id AND r.tenant_id=v_tenant_id) THEN
  RAISE EXCEPTION 'O papel selecionado nao pertence a esta Secretaria.';
 END IF;
 SELECT EXISTS (
  SELECT 1 FROM public.membership_roles mr
  JOIN public.tenant_roles r ON r.id=mr.role_id AND r.tenant_id=mr.tenant_id
  WHERE mr.membership_id=p_membership_id AND mr.tenant_id=v_tenant_id AND r.slug='admin'
 ) INTO v_target_is_admin;
 SELECT r.slug='admin' INTO v_new_is_admin
 FROM public.tenant_roles r WHERE r.id=p_role_id AND r.tenant_id=v_tenant_id;
 IF v_user_id=(SELECT auth.uid()) AND v_target_is_admin AND NOT v_new_is_admin THEN
  RAISE EXCEPTION 'Voce nao pode remover o proprio papel de administrador.';
 END IF;
 IF v_target_is_admin AND NOT v_new_is_admin THEN
  SELECT count(DISTINCT tm.id) INTO v_active_admins
  FROM public.tenant_memberships tm
  JOIN public.membership_roles mr ON mr.membership_id=tm.id AND mr.tenant_id=tm.tenant_id
  JOIN public.tenant_roles r ON r.id=mr.role_id AND r.tenant_id=mr.tenant_id
  WHERE tm.tenant_id=v_tenant_id AND tm.status='active' AND r.slug='admin';
  IF v_active_admins<=1 THEN RAISE EXCEPTION 'A Secretaria precisa manter pelo menos um administrador ativo.'; END IF;
 END IF;
 DELETE FROM public.membership_roles WHERE membership_id=p_membership_id AND tenant_id=v_tenant_id;
 INSERT INTO public.membership_roles(membership_id,role_id,tenant_id) VALUES(p_membership_id,p_role_id,v_tenant_id);
END;
$function$;
