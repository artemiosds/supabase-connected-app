-- Scoped technical support for the SaaS platform.
-- Support identities are not tenant memberships and never inherit tenant-admin roles.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE TABLE IF NOT EXISTS public.platform_support_agents (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 2 AND 120),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_support_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agent_user_id uuid NOT NULL REFERENCES public.platform_support_agents(user_id) ON DELETE RESTRICT,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 can_view_suppliers boolean NOT NULL DEFAULT true,
 can_create_suppliers boolean NOT NULL DEFAULT false,
 can_update_suppliers boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT platform_support_assignments_agent_tenant_unique UNIQUE(agent_user_id,tenant_id),
 CONSTRAINT platform_support_assignments_permission_hierarchy CHECK (
  (NOT can_create_suppliers OR can_view_suppliers) AND (NOT can_update_suppliers OR can_view_suppliers)
 )
);
CREATE TABLE IF NOT EXISTS public.platform_support_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 allowed_actions text[] NOT NULL DEFAULT ARRAY['suppliers:view']::text[],
 started_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '60 minutes'),
 ended_at timestamptz,
 ended_by uuid REFERENCES auth.users(id),
 CONSTRAINT platform_support_sessions_expiry CHECK(expires_at>started_at AND expires_at<=started_at+interval '2 hours'),
 CONSTRAINT platform_support_sessions_end_pair CHECK((ended_at IS NULL AND ended_by IS NULL) OR (ended_at IS NOT NULL AND ended_by IS NOT NULL)),
 CONSTRAINT platform_support_sessions_actions CHECK(allowed_actions <@ ARRAY['suppliers:view','suppliers:create','suppliers:update']::text[])
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_support_one_open_session
 ON public.platform_support_sessions(actor_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_platform_support_assignments_tenant
 ON public.platform_support_assignments(tenant_id,is_active);
CREATE INDEX IF NOT EXISTS ix_platform_support_sessions_actor_recent
 ON public.platform_support_sessions(actor_id,started_at DESC);
CREATE INDEX IF NOT EXISTS ix_platform_support_sessions_tenant_recent
 ON public.platform_support_sessions(tenant_id,started_at DESC);

ALTER TABLE public.platform_support_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_support_agents,public.platform_support_assignments,public.platform_support_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.platform_support_agents,public.platform_support_assignments,public.platform_support_sessions TO authenticated;
CREATE POLICY p_support_agents_master_read ON public.platform_support_agents FOR SELECT TO authenticated USING((SELECT app_auth.is_platform_admin()));
CREATE POLICY p_support_assignments_master_read ON public.platform_support_assignments FOR SELECT TO authenticated USING((SELECT app_auth.is_platform_admin()));
CREATE POLICY p_support_sessions_actor_or_master_read ON public.platform_support_sessions FOR SELECT TO authenticated
 USING(actor_id=(SELECT auth.uid()) OR (SELECT app_auth.is_platform_admin()));

CREATE OR REPLACE FUNCTION app_auth.is_active_platform_support_agent()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT EXISTS(SELECT 1 FROM public.platform_support_agents a WHERE a.user_id=(SELECT auth.uid()) AND a.status='active');
$f$;
REVOKE ALL ON FUNCTION app_auth.is_active_platform_support_agent() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.is_active_platform_support_agent() TO authenticated;

CREATE OR REPLACE FUNCTION app_auth.has_active_supplier_support_session(p_tenant_id uuid,p_permission_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT EXISTS(
  SELECT 1 FROM public.platform_support_sessions s
  JOIN public.platform_support_agents a ON a.user_id=s.actor_id AND a.status='active'
  JOIN public.tenants t ON t.id=s.tenant_id
  WHERE s.actor_id=(SELECT auth.uid()) AND s.tenant_id=p_tenant_id
   AND s.ended_at IS NULL AND s.expires_at>pg_catalog.now()
   AND t.status='active' AND app_auth.is_tenant_in_good_standing(s.tenant_id)
   AND app_auth.is_tenant_module_enabled(s.tenant_id,'fornecedores')
   AND p_permission_code=ANY(s.allowed_actions)
 )
 OR EXISTS(
  SELECT 1 FROM public.platform_support_sessions s
  JOIN public.platform_admins pa ON pa.user_id=s.actor_id AND pa.is_active
  JOIN public.tenants t ON t.id=s.tenant_id
  WHERE s.actor_id=(SELECT auth.uid()) AND s.tenant_id=p_tenant_id
   AND s.ended_at IS NULL AND s.expires_at>pg_catalog.now()
   AND t.status='active' AND app_auth.is_tenant_in_good_standing(s.tenant_id)
   AND app_auth.is_tenant_module_enabled(s.tenant_id,'fornecedores')
   AND p_permission_code=ANY(s.allowed_actions)
 );
$f$;
REVOKE ALL ON FUNCTION app_auth.has_active_supplier_support_session(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.has_active_supplier_support_session(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION app_auth.has_supplier_permission(p_tenant_id uuid,p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT app_auth.has_active_supplier_support_session(p_tenant_id,p_code)
 OR (
  NOT app_auth.is_platform_admin()
  AND EXISTS(
   SELECT 1 FROM public.tenant_memberships tm
   JOIN public.tenants t ON t.id=tm.tenant_id
   JOIN public.membership_roles mr ON mr.membership_id=tm.id AND mr.tenant_id=tm.tenant_id
   JOIN public.tenant_roles tr ON tr.id=mr.role_id AND tr.tenant_id=mr.tenant_id
   JOIN public.tenant_role_permissions trp ON trp.role_id=tr.id
   JOIN public.permissions p ON p.id=trp.permission_id
   WHERE tm.tenant_id=p_tenant_id AND tm.user_id=(SELECT auth.uid())
    AND tm.status='active' AND t.status='active' AND p.code=p_code
  )
 );
$f$;
REVOKE ALL ON FUNCTION app_auth.has_supplier_permission(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.has_supplier_permission(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_support_candidates()
RETURNS TABLE(user_id uuid,email text,display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT u.id,u.email,
  COALESCE(NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'),''),NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'),''),u.email)
 FROM auth.users u
 WHERE app_auth.is_platform_admin()
  AND u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=u.id AND pa.is_active)
  AND NOT EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=u.id AND tm.status='active')
 ORDER BY u.email;
$f$;
REVOKE ALL ON FUNCTION public.list_platform_support_candidates() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_support_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_support_team()
RETURNS TABLE(user_id uuid,email text,display_name text,status text,assignment_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT a.user_id,u.email,a.display_name,a.status,
  (SELECT count(*) FROM public.platform_support_assignments x WHERE x.agent_user_id=a.user_id AND x.is_active)
 FROM public.platform_support_agents a JOIN auth.users u ON u.id=a.user_id
 WHERE app_auth.is_platform_admin()
 ORDER BY a.display_name;
$f$;
REVOKE ALL ON FUNCTION public.list_platform_support_team() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_support_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.add_platform_support_agent(p_user_id uuid,p_display_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode cadastrar técnicos.' USING ERRCODE='42501'; END IF;
 IF p_display_name IS NULL OR length(pg_catalog.btrim(p_display_name)) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Informe o nome do técnico.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'O usuário precisa existir e confirmar o e-mail antes do cadastro.'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user_id AND pa.is_active)
  OR EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=p_user_id AND tm.status='active') THEN
  RAISE EXCEPTION 'Este usuário já possui um perfil administrativo ou municipal. Use uma conta exclusiva de suporte.';
 END IF;
 INSERT INTO public.platform_support_agents(user_id,display_name,created_by)
 VALUES(p_user_id,pg_catalog.btrim(p_display_name),(SELECT auth.uid()))
 ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,status='active',updated_at=pg_catalog.now();
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_support.agent_added','platform_support_agents',p_user_id::text,
  jsonb_build_object('support_agent_id',p_user_id,'display_name',pg_catalog.btrim(p_display_name)));
END;
$f$;
REVOKE ALL ON FUNCTION public.add_platform_support_agent(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_platform_support_agent(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_support_agent_status(p_user_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode alterar a equipe.' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
 UPDATE public.platform_support_agents SET status=p_status,updated_at=pg_catalog.now() WHERE user_id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Técnico não encontrado.'; END IF;
 IF p_status='suspended' THEN
  UPDATE public.platform_support_sessions SET ended_at=pg_catalog.now(),ended_by=(SELECT auth.uid())
   WHERE actor_id=p_user_id AND ended_at IS NULL;
 END IF;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_support.agent_status_changed','platform_support_agents',p_user_id::text,jsonb_build_object('status',p_status));
END;
$f$;
REVOKE ALL ON FUNCTION public.set_platform_support_agent_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_support_agent_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_support_assignment(
 p_agent_user_id uuid,p_tenant_id uuid,p_is_active boolean,
 p_can_view_suppliers boolean DEFAULT true,p_can_create_suppliers boolean DEFAULT false,p_can_update_suppliers boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode atribuir Secretarias.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_support_agents a WHERE a.user_id=p_agent_user_id AND a.status='active') THEN RAISE EXCEPTION 'Técnico não cadastrado ou suspenso.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id) THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
 IF NOT p_can_view_suppliers AND (p_can_create_suppliers OR p_can_update_suppliers) THEN RAISE EXCEPTION 'Criar ou editar exige permissão de consulta.'; END IF;
 INSERT INTO public.platform_support_assignments(agent_user_id,tenant_id,is_active,can_view_suppliers,can_create_suppliers,can_update_suppliers,created_by)
 VALUES(p_agent_user_id,p_tenant_id,p_is_active,p_can_view_suppliers,p_can_create_suppliers,p_can_update_suppliers,(SELECT auth.uid()))
 ON CONFLICT(agent_user_id,tenant_id) DO UPDATE SET is_active=EXCLUDED.is_active,
  can_view_suppliers=EXCLUDED.can_view_suppliers,can_create_suppliers=EXCLUDED.can_create_suppliers,
  can_update_suppliers=EXCLUDED.can_update_suppliers,updated_at=pg_catalog.now();
 INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),p_tenant_id,'platform_support.assignment_changed','platform_support_assignments',p_agent_user_id::text,
  jsonb_build_object('agent_user_id',p_agent_user_id,'is_active',p_is_active,'can_view_suppliers',p_can_view_suppliers,
   'can_create_suppliers',p_can_create_suppliers,'can_update_suppliers',p_can_update_suppliers));
END;
$f$;
REVOKE ALL ON FUNCTION public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_platform_support_tenants()
RETURNS TABLE(id uuid,name text,slug text,status text,commercial_status text,plan_tier text,monthly_fee numeric,trial_starts_at timestamptz,trial_ends_at timestamptz,enabled_modules jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT t.id,t.name,t.slug,t.status,t.commercial_status,t.plan_tier,t.monthly_fee,t.trial_starts_at,t.trial_ends_at,t.enabled_modules
 FROM public.tenants t
 JOIN public.platform_support_assignments a ON a.tenant_id=t.id AND a.agent_user_id=(SELECT auth.uid()) AND a.is_active
 JOIN public.platform_support_agents sa ON sa.user_id=a.agent_user_id AND sa.status='active'
 WHERE t.status='active'
 ORDER BY t.name;
$f$;
REVOKE ALL ON FUNCTION public.list_my_platform_support_tenants() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_my_platform_support_tenants() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_support_assignments(p_agent_user_id uuid)
RETURNS TABLE(tenant_id uuid,tenant_name text,is_active boolean,can_view_suppliers boolean,can_create_suppliers boolean,can_update_suppliers boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT a.tenant_id,t.name,a.is_active,a.can_view_suppliers,a.can_create_suppliers,a.can_update_suppliers
 FROM public.platform_support_assignments a JOIN public.tenants t ON t.id=a.tenant_id
 WHERE app_auth.is_platform_admin() AND a.agent_user_id=p_agent_user_id ORDER BY t.name;
$f$;
REVOKE ALL ON FUNCTION public.list_platform_support_assignments(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_support_assignments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_platform_support_session(p_tenant_id uuid,p_reason text)
RETURNS TABLE(session_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_actor uuid:=(SELECT auth.uid()); v_actions text[]; v_session uuid; v_expires timestamptz;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Descreva o motivo do atendimento (10 a 500 caracteres).'; END IF;
 IF app_auth.is_platform_admin() THEN
  v_actions:=ARRAY['suppliers:view','suppliers:create','suppliers:update']::text[];
 ELSE
  SELECT array_remove(ARRAY[
    CASE WHEN a.can_view_suppliers THEN 'suppliers:view' END,
    CASE WHEN a.can_create_suppliers THEN 'suppliers:create' END,
    CASE WHEN a.can_update_suppliers THEN 'suppliers:update' END
   ],NULL) INTO v_actions
  FROM public.platform_support_assignments a
  JOIN public.platform_support_agents sa ON sa.user_id=a.agent_user_id AND sa.status='active'
  WHERE a.agent_user_id=v_actor AND a.tenant_id=p_tenant_id AND a.is_active;
  IF v_actions IS NULL THEN RAISE EXCEPTION 'Você não possui atribuição ativa para esta organização.' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.status='active'
  AND app_auth.is_tenant_in_good_standing(t.id) AND app_auth.is_tenant_module_enabled(t.id,'fornecedores')) THEN
  RAISE EXCEPTION 'A organização está inativa ou o módulo Fornecedores não está habilitado.' USING ERRCODE='42501';
 END IF;
 UPDATE public.platform_support_sessions SET ended_at=pg_catalog.now(),ended_by=v_actor
  WHERE actor_id=v_actor AND ended_at IS NULL;
 INSERT INTO public.platform_support_sessions(actor_id,tenant_id,reason,allowed_actions,expires_at)
 VALUES(v_actor,p_tenant_id,pg_catalog.btrim(p_reason),v_actions,pg_catalog.now()+interval '60 minutes')
 RETURNING id,platform_support_sessions.expires_at INTO v_session,v_expires;
 INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
 VALUES(v_actor,p_tenant_id,'platform_support.session_started','platform_support_sessions',v_session::text,
  jsonb_build_object('reason',pg_catalog.btrim(p_reason),'allowed_actions',v_actions,'expires_at',v_expires));
 RETURN QUERY SELECT v_session,v_expires;
END;
$f$;
REVOKE ALL ON FUNCTION public.start_platform_support_session(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_platform_support_session(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_platform_support_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 UPDATE public.platform_support_sessions SET ended_at=pg_catalog.now(),ended_by=(SELECT auth.uid())
 WHERE id=p_session_id AND actor_id=(SELECT auth.uid()) AND ended_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sessão ativa não encontrada para esta conta.'; END IF;
 INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
 SELECT (SELECT auth.uid()),s.tenant_id,'platform_support.session_ended','platform_support_sessions',s.id::text,
  jsonb_build_object('started_at',s.started_at,'ended_at',s.ended_at)
 FROM public.platform_support_sessions s WHERE s.id=p_session_id;
END;
$f$;
REVOKE ALL ON FUNCTION public.end_platform_support_session(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.end_platform_support_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_supplier_support_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_tenant uuid; v_id uuid; v_session uuid; v_action text;
BEGIN
 IF TG_OP='DELETE' THEN v_tenant:=OLD.tenant_id; v_id:=OLD.id; ELSE v_tenant:=NEW.tenant_id; v_id:=NEW.id; END IF;
 SELECT s.id INTO v_session FROM public.platform_support_sessions s
 WHERE s.actor_id=(SELECT auth.uid()) AND s.tenant_id=v_tenant AND s.ended_at IS NULL AND s.expires_at>pg_catalog.now()
 ORDER BY s.started_at DESC LIMIT 1;
 IF v_session IS NOT NULL THEN
  v_action:=CASE WHEN TG_OP='INSERT' THEN 'supplier.created_by_support' ELSE 'supplier.updated_by_support' END;
  INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
  VALUES((SELECT auth.uid()),v_tenant,v_action,'suppliers',v_id::text,jsonb_build_object('support_session_id',v_session,'operation',TG_OP));
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION public.log_supplier_support_write() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_supplier_support_audit ON public.suppliers;
CREATE TRIGGER trg_supplier_support_audit AFTER INSERT OR UPDATE ON public.suppliers
 FOR EACH ROW EXECUTE FUNCTION public.log_supplier_support_write();

-- Remove the old global operational read path for Master: data access now requires
-- an explicit support session, while aggregate commercial metrics remain available.
DROP POLICY IF EXISTS p_suppliers_select ON public.suppliers;
CREATE POLICY p_suppliers_select ON public.suppliers FOR SELECT TO authenticated
 USING(app_auth.has_supplier_permission(tenant_id,'suppliers:view'));
DROP POLICY IF EXISTS p_master_support_read_suppliers ON public.suppliers;


CREATE OR REPLACE FUNCTION public.list_my_platform_support_tenants_safe()
RETURNS TABLE(id uuid,name text,slug text,status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT t.id,t.name,t.slug,t.status
 FROM public.tenants t
 JOIN public.platform_support_assignments a ON a.tenant_id=t.id
  AND a.agent_user_id=(SELECT auth.uid()) AND a.is_active AND a.can_view_suppliers
 JOIN public.platform_support_agents sa ON sa.user_id=a.agent_user_id AND sa.status='active'
 JOIN auth.users u ON u.id=sa.user_id AND u.email_confirmed_at IS NOT NULL
 WHERE t.status='active' AND app_auth.is_tenant_in_good_standing(t.id)
  AND app_auth.is_tenant_module_enabled(t.id,'fornecedores')
 ORDER BY t.name;
$f$;
REVOKE ALL ON FUNCTION public.list_my_platform_support_tenants_safe() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_my_platform_support_tenants_safe() TO authenticated;


COMMIT;
