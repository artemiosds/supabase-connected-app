-- Capabilities e trilha de auditoria para gestão de usuários.
CREATE OR REPLACE FUNCTION public.get_tenant_user_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean,can_create boolean,can_edit boolean,can_assign_role boolean,can_suspend boolean)
LANGUAGE sql STABLE SET search_path = '' AS $function$
 SELECT app_auth.has_tenant_permission(p_tenant_id,'users:view'),
        app_auth.has_tenant_permission(p_tenant_id,'users:create'),
        app_auth.has_tenant_permission(p_tenant_id,'users:edit'),
        app_auth.has_tenant_permission(p_tenant_id,'users:assign_role'),
        app_auth.has_tenant_permission(p_tenant_id,'users:delete');
$function$;
REVOKE ALL ON FUNCTION public.get_tenant_user_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_user_capabilities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_audit_tenant_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_tenant_id uuid; v_user_id uuid; v_fields jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
  v_tenant_id:=NEW.tenant_id; v_user_id:=NEW.user_id; v_fields:='["membership_created"]'::jsonb;
 ELSE
  v_tenant_id:=NEW.tenant_id; v_user_id:=NEW.user_id;
  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key),'[]'::jsonb) INTO v_fields
  FROM jsonb_each(to_jsonb(NEW)) n(key,value)
  WHERE n.key NOT IN ('updated_at') AND (to_jsonb(OLD)->n.key) IS DISTINCT FROM n.value;
 END IF;
 INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
 VALUES(v_tenant_id,(SELECT auth.uid()),TG_OP,'tenant_memberships',v_user_id::text,jsonb_build_object('changed_fields',v_fields),now());
 RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_audit_tenant_membership() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_tenant_memberships_audit ON public.tenant_memberships;
CREATE TRIGGER trg_tenant_memberships_audit AFTER INSERT OR UPDATE ON public.tenant_memberships
 FOR EACH ROW EXECUTE FUNCTION public.fn_audit_tenant_membership();
