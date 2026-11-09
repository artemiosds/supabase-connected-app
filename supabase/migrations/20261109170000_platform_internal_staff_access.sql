-- Equipe interna do fornecedor SaaS: identidade separada, RBAC no banco e auditoria.
-- Esta migration somente adiciona o modelo de acesso interno; nao altera contas existentes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.platform_staff (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  CONSTRAINT platform_staff_activation_consistency CHECK (
    (status = 'invited' AND activated_at IS NULL)
    OR (status IN ('active','suspended') AND activated_at IS NOT NULL)
  )
);

CREATE TABLE public.platform_staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,59}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_staff_permissions (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_staff_role_permissions (
  role_id uuid NOT NULL REFERENCES public.platform_staff_roles(id) ON DELETE RESTRICT,
  permission_code text NOT NULL REFERENCES public.platform_staff_permissions(code) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE public.platform_staff_role_assignments (
  user_id uuid NOT NULL REFERENCES public.platform_staff(user_id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.platform_staff_roles(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_platform_staff_status ON public.platform_staff(status, display_name);
CREATE INDEX idx_platform_staff_role_assignments_role ON public.platform_staff_role_assignments(role_id, user_id);

ALTER TABLE public.platform_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff_role_assignments FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_staff, public.platform_staff_roles,
  public.platform_staff_permissions, public.platform_staff_role_permissions,
  public.platform_staff_role_assignments FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.platform_staff_permissions(code,name,description,category) VALUES
 ('dashboard.view','Visão interna','Acessar o painel de trabalho interno.','Geral'),
 ('clients.view','Consultar clientes','Consultar cadastro básico e situação das Secretarias.','Comercial'),
 ('plans.view','Consultar planos','Consultar distribuição de clientes por plano.','Comercial'),
 ('billing.summary.view','Consultar resumo financeiro','Consultar mensalidades e indicadores financeiros agregados, sem credenciais de cobrança.','Financeiro'),
 ('metrics.view','Consultar métricas','Consultar indicadores globais não sensíveis da plataforma.','Gestão'),
 ('audit.view','Consultar auditoria','Consultar trilha global de eventos, sem dados privados ou segredos.','Segurança'),
 ('support.team.manage','Gerenciar equipe técnica','Convidar, atribuir e suspender técnicos da Equipe de Suporte. Não permite iniciar sessões de suporte Master.','Suporte')
ON CONFLICT(code) DO UPDATE SET
 name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category;

INSERT INTO public.platform_staff_roles(slug,name,description,is_system) VALUES
 ('comercial','Comercial','Consulta de clientes, planos e indicadores comerciais.',true),
 ('financeiro','Financeiro','Consulta de resumo financeiro e indicadores, sem acesso às credenciais do provedor.',true),
 ('implantacao','Implantação','Consulta de clientes e situação de implantação.',true),
 ('suporte-interno','Suporte interno','Gestão da equipe técnica de suporte, sem acesso direto aos dados operacionais dos clientes.',true),
 ('auditoria','Auditoria','Consulta de indicadores e trilha de auditoria.',true)
ON CONFLICT(slug) DO NOTHING;

INSERT INTO public.platform_staff_role_permissions(role_id,permission_code)
SELECT r.id,p.code
FROM public.platform_staff_roles r
JOIN (VALUES
 ('comercial','dashboard.view'),('comercial','clients.view'),('comercial','plans.view'),('comercial','metrics.view'),
 ('financeiro','dashboard.view'),('financeiro','clients.view'),('financeiro','billing.summary.view'),('financeiro','metrics.view'),
 ('implantacao','dashboard.view'),('implantacao','clients.view'),
 ('suporte-interno','dashboard.view'),('suporte-interno','clients.view'),('suporte-interno','support.team.manage'),
 ('auditoria','dashboard.view'),('auditoria','clients.view'),('auditoria','metrics.view'),('auditoria','audit.view')
) AS defaults(role_slug,permission_code) ON defaults.role_slug=r.slug
JOIN public.platform_staff_permissions p ON p.code=defaults.permission_code
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app_auth.is_platform_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM public.platform_staff s
   JOIN auth.users u ON u.id=s.user_id
   WHERE s.user_id=(SELECT auth.uid())
     AND s.status='active'
     AND u.email_confirmed_at IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(u.email))=s.email
 );
$function$;
REVOKE ALL ON FUNCTION app_auth.is_platform_staff() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.is_platform_staff() TO authenticated;

CREATE OR REPLACE FUNCTION app_auth.has_platform_staff_permission(p_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT COALESCE(
   (SELECT app_auth.is_platform_staff()
     AND EXISTS(
       SELECT 1
       FROM public.platform_staff_role_assignments a
       JOIN public.platform_staff_role_permissions rp ON rp.role_id=a.role_id
       JOIN public.platform_staff_roles r ON r.id=a.role_id AND r.is_active
       WHERE a.user_id=(SELECT auth.uid()) AND rp.permission_code=p_code
     )),
   false
 );
$function$;
REVOKE ALL ON FUNCTION app_auth.has_platform_staff_permission(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.has_platform_staff_permission(text) TO authenticated;

CREATE OR REPLACE FUNCTION app_auth.can_manage_platform_support_team()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT app_auth.is_platform_admin()
     OR app_auth.has_platform_staff_permission('support.team.manage');
$function$;
REVOKE ALL ON FUNCTION app_auth.can_manage_platform_support_team() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_auth.can_manage_platform_support_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_platform_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT app_auth.is_platform_admin();
$function$;
REVOKE ALL ON FUNCTION public.can_manage_platform_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_platform_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_platform_staff_access()
RETURNS TABLE(
 is_staff boolean,
 staff_status text,
 display_name text,
 role_names text[],
 permission_codes text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_staff public.platform_staff%ROWTYPE;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN
  RETURN QUERY SELECT false,NULL::text,NULL::text,ARRAY[]::text[],ARRAY[]::text[];
  RETURN;
 END IF;
 SELECT * INTO v_staff FROM public.platform_staff WHERE user_id=(SELECT auth.uid());
 IF NOT FOUND THEN
  RETURN QUERY SELECT false,NULL::text,NULL::text,ARRAY[]::text[],ARRAY[]::text[];
  RETURN;
 END IF;
 RETURN QUERY
 SELECT
   v_staff.status='active' AND EXISTS(
     SELECT 1 FROM auth.users u WHERE u.id=v_staff.user_id
       AND u.email_confirmed_at IS NOT NULL
       AND pg_catalog.lower(pg_catalog.btrim(u.email))=v_staff.email
   ),
   v_staff.status,
   v_staff.display_name,
   COALESCE((
     SELECT pg_catalog.array_agg(DISTINCT r.name ORDER BY r.name)
     FROM public.platform_staff_role_assignments a
     JOIN public.platform_staff_roles r ON r.id=a.role_id AND r.is_active
     WHERE a.user_id=v_staff.user_id
   ),ARRAY[]::text[]),
   COALESCE((
     SELECT pg_catalog.array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
     FROM public.platform_staff_role_assignments a
     JOIN public.platform_staff_roles r ON r.id=a.role_id AND r.is_active
     JOIN public.platform_staff_role_permissions rp ON rp.role_id=r.id
     WHERE a.user_id=v_staff.user_id
   ),ARRAY[]::text[]);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_platform_staff_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_platform_staff_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_staff()
RETURNS TABLE(
 user_id uuid,email text,display_name text,status text,created_at timestamptz,
 activated_at timestamptz,role_ids uuid[],role_names text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT s.user_id,s.email,s.display_name,s.status,s.created_at,s.activated_at,
   COALESCE(pg_catalog.array_agg(DISTINCT r.id) FILTER(WHERE r.id IS NOT NULL),ARRAY[]::uuid[]),
   COALESCE(pg_catalog.array_agg(DISTINCT r.name) FILTER(WHERE r.id IS NOT NULL),ARRAY[]::text[])
 FROM public.platform_staff s
 LEFT JOIN public.platform_staff_role_assignments a ON a.user_id=s.user_id
 LEFT JOIN public.platform_staff_roles r ON r.id=a.role_id AND r.is_active
 WHERE app_auth.is_platform_admin()
 GROUP BY s.user_id,s.email,s.display_name,s.status,s.created_at,s.activated_at
 ORDER BY s.display_name,s.email;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_staff_roles()
RETURNS TABLE(
 id uuid,slug text,name text,description text,is_system boolean,is_active boolean,
 permission_codes text[],staff_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT r.id,r.slug,r.name,r.description,r.is_system,r.is_active,
   COALESCE(pg_catalog.array_agg(DISTINCT rp.permission_code) FILTER(WHERE rp.permission_code IS NOT NULL),ARRAY[]::text[]),
   (SELECT pg_catalog.count(*) FROM public.platform_staff_role_assignments a WHERE a.role_id=r.id)
 FROM public.platform_staff_roles r
 LEFT JOIN public.platform_staff_role_permissions rp ON rp.role_id=r.id
 WHERE app_auth.is_platform_admin()
 GROUP BY r.id
 ORDER BY r.is_system DESC,r.name;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_staff_roles() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_staff_roles() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_invite_platform_staff(p_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN
  RAISE EXCEPTION 'Somente o Administrador Master pode validar convites internos.'
   USING ERRCODE='42501';
 END IF;
 IF p_email IS NULL
  OR pg_catalog.length(pg_catalog.btrim(p_email)) NOT BETWEEN 3 AND 254
  OR pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+
 p_user_id uuid,p_email text,p_display_name text,p_role_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_email text; v_name text:=pg_catalog.btrim(COALESCE(p_display_name,''));
 v_confirmed timestamptz;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN
  RAISE EXCEPTION 'Somente o Administrador Master pode convidar colaboradores internos.' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR p_email IS NULL
  OR pg_catalog.length(pg_catalog.btrim(p_email)) NOT BETWEEN 3 AND 254
  OR pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 THEN
  RAISE EXCEPTION 'Informe nome e e-mail válidos.';
 END IF;
 SELECT pg_catalog.lower(pg_catalog.btrim(u.email)),u.email_confirmed_at
  INTO v_email,v_confirmed
 FROM auth.users u WHERE u.id=p_user_id;
 IF NOT FOUND OR v_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email)) THEN
  RAISE EXCEPTION 'A conta de autenticação não corresponde ao e-mail convidado.';
 END IF;
 IF v_confirmed IS NOT NULL THEN
  RAISE EXCEPTION 'Esta conta ja esta confirmada. Convide um e-mail novo e exclusivo para a equipe interna.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user_id)
  OR EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=p_user_id)
  OR EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=p_user_id) THEN
  RAISE EXCEPTION 'Esta conta já pertence a outro perfil. Colaboradores internos usam uma conta exclusiva.';
 END IF;
 IF p_role_ids IS NULL OR pg_catalog.cardinality(p_role_ids)=0
  OR EXISTS(SELECT 1 FROM unnest(p_role_ids) x(id)
    WHERE NOT EXISTS(SELECT 1 FROM public.platform_staff_roles r WHERE r.id=x.id AND r.is_active)) THEN
  RAISE EXCEPTION 'Selecione ao menos um perfil interno válido.';
 END IF;
 INSERT INTO public.platform_staff(user_id,email,display_name,status,invited_by)
 VALUES(p_user_id,v_email,v_name,'invited',(SELECT auth.uid()));
 INSERT INTO public.platform_staff_role_assignments(user_id,role_id,assigned_by)
 SELECT p_user_id,r.id,(SELECT auth.uid())
 FROM public.platform_staff_roles r WHERE r.id=ANY(p_role_ids) AND r.is_active
 ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.invited','platform_staff',p_user_id::text,
  pg_catalog.jsonb_build_object('email',v_email,'display_name',v_name,'role_ids',p_role_ids));
END;
$function$;
REVOKE ALL ON FUNCTION public.register_platform_staff(uuid,text,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_platform_staff(uuid,text,text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_my_platform_staff()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_user uuid:=(SELECT auth.uid()); v_email text; v_status text;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.lower(pg_catalog.btrim(u.email)) INTO v_email
 FROM auth.users u WHERE u.id=v_user AND u.email_confirmed_at IS NOT NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT s.status INTO v_status FROM public.platform_staff s
 WHERE s.user_id=v_user AND s.email=v_email;
 IF NOT FOUND OR v_status='suspended' THEN RETURN false; END IF;
 IF v_status='invited' THEN
  UPDATE public.platform_staff SET status='active',activated_at=pg_catalog.now(),
   updated_at=pg_catalog.now() WHERE user_id=v_user AND status='invited';
  INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
  VALUES(v_user,'platform_staff.activated','platform_staff',v_user::text,
   pg_catalog.jsonb_build_object('activation','confirmed_email_and_first_password'));
 END IF;
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.activate_my_platform_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_my_platform_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_staff_status(p_user_id uuid,p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_activated timestamptz;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode suspender colaboradores.' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
 SELECT activated_at INTO v_activated FROM public.platform_staff WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
 IF p_status='active' AND v_activated IS NULL THEN
  RAISE EXCEPTION 'O convite precisa ser aceito antes da ativação.';
 END IF;
 IF p_status='active' AND NOT EXISTS(
   SELECT 1 FROM auth.users u
   JOIN public.platform_staff s ON s.user_id=u.id
   WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(u.email))=s.email
 ) THEN
  RAISE EXCEPTION 'A conta precisa confirmar o e-mail cadastrado antes da reativação.';
 END IF;
 UPDATE public.platform_staff SET status=p_status,
   suspended_at=CASE WHEN p_status='suspended' THEN pg_catalog.now() ELSE NULL END,
   updated_at=pg_catalog.now()
 WHERE user_id=p_user_id;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.status_changed','platform_staff',p_user_id::text,
  pg_catalog.jsonb_build_object('status',p_status));
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_staff_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_staff_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_staff_roles(p_user_id uuid,p_role_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode alterar perfis internos.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=p_user_id) THEN
  RAISE EXCEPTION 'Colaborador não encontrado.';
 END IF;
 IF p_role_ids IS NULL OR pg_catalog.cardinality(p_role_ids)=0
  OR EXISTS(SELECT 1 FROM unnest(p_role_ids) x(id)
   WHERE NOT EXISTS(SELECT 1 FROM public.platform_staff_roles r WHERE r.id=x.id AND r.is_active)) THEN
  RAISE EXCEPTION 'O colaborador deve manter ao menos um perfil válido.';
 END IF;
 DELETE FROM public.platform_staff_role_assignments WHERE user_id=p_user_id;
 INSERT INTO public.platform_staff_role_assignments(user_id,role_id,assigned_by)
 SELECT p_user_id,r.id,(SELECT auth.uid())
 FROM public.platform_staff_roles r WHERE r.id=ANY(p_role_ids) AND r.is_active;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.roles_changed','platform_staff',p_user_id::text,
  pg_catalog.jsonb_build_object('role_ids',p_role_ids));
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_staff_roles(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_staff_roles(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_platform_staff_role(
 p_role_id uuid,p_slug text,p_name text,p_description text,p_permission_codes text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_id uuid; v_slug text:=pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug,'')));
 v_name text:=pg_catalog.btrim(COALESCE(p_name,'')); v_system boolean;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode configurar perfis internos.' USING ERRCODE='42501'; END IF;
 IF v_slug !~ '^[a-z0-9][a-z0-9_-]{1,59}$' OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 80 THEN
  RAISE EXCEPTION 'Informe nome e identificador válidos para o perfil.';
 END IF;
 IF p_permission_codes IS NULL OR pg_catalog.cardinality(p_permission_codes)=0
  OR NOT ('dashboard.view'=ANY(p_permission_codes))
  OR EXISTS(SELECT 1 FROM unnest(p_permission_codes) x(code)
   WHERE NOT EXISTS(SELECT 1 FROM public.platform_staff_permissions p WHERE p.code=x.code)) THEN
  RAISE EXCEPTION 'Cada perfil precisa incluir o acesso básico ao Portal Interno e permissões válidas.';
 END IF;
 IF p_role_id IS NULL THEN
  INSERT INTO public.platform_staff_roles(slug,name,description,is_system,created_by)
  VALUES(v_slug,v_name,NULLIF(pg_catalog.btrim(COALESCE(p_description,'')),''),false,(SELECT auth.uid()))
  RETURNING id INTO v_id;
 ELSE
  SELECT is_system INTO v_system FROM public.platform_staff_roles WHERE id=p_role_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil não encontrado.'; END IF;
  IF v_system THEN
   UPDATE public.platform_staff_roles SET description=NULLIF(pg_catalog.btrim(COALESCE(p_description,'')),''),
    updated_at=pg_catalog.now() WHERE id=p_role_id;
   v_id:=p_role_id;
  ELSE
   UPDATE public.platform_staff_roles SET slug=v_slug,name=v_name,
    description=NULLIF(pg_catalog.btrim(COALESCE(p_description,'')),''),
    updated_at=pg_catalog.now() WHERE id=p_role_id;
   v_id:=p_role_id;
  END IF;
 END IF;
 DELETE FROM public.platform_staff_role_permissions WHERE role_id=v_id;
 INSERT INTO public.platform_staff_role_permissions(role_id,permission_code)
 SELECT v_id,p.code FROM public.platform_staff_permissions p
 WHERE p.code=ANY(p_permission_codes);
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.role_permissions_changed','platform_staff_roles',v_id::text,
  pg_catalog.jsonb_build_object('permission_codes',p_permission_codes));
 RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_platform_staff_role(uuid,text,text,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_platform_staff_role(uuid,text,text,text,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_staff_tenants()
RETURNS TABLE(
 id uuid,name text,slug text,status text,commercial_status text,plan_tier text,
 monthly_fee numeric,municipality text,state text,created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_billing boolean:=app_auth.has_platform_staff_permission('billing.summary.view');
BEGIN
 IF NOT (
   app_auth.has_platform_staff_permission('clients.view')
   OR app_auth.has_platform_staff_permission('plans.view')
   OR app_auth.has_platform_staff_permission('billing.summary.view')
   OR app_auth.has_platform_staff_permission('support.team.manage')
 ) THEN
  RAISE EXCEPTION 'Sem permissão para consultar clientes.' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT t.id,t.name,t.slug,t.status,t.commercial_status,t.plan_tier,
   CASE WHEN v_billing THEN t.monthly_fee ELSE NULL END,
   t.municipality,t.state,t.created_at
 FROM public.tenants t ORDER BY t.name;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_staff_tenants() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_staff_tenants() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_staff_metrics()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_billing boolean:=app_auth.has_platform_staff_permission('billing.summary.view');
BEGIN
 IF NOT (
   app_auth.has_platform_staff_permission('metrics.view')
   OR app_auth.has_platform_staff_permission('billing.summary.view')
 ) THEN
  RAISE EXCEPTION 'Sem permissão para consultar métricas ou resumo financeiro.' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'mrr_estimated',CASE WHEN v_billing THEN
    (SELECT COALESCE(pg_catalog.sum(t.monthly_fee),0) FROM public.tenants t WHERE t.commercial_status='active' AND t.status='active')
    ELSE NULL END,
  'active_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='active' AND t.status='active'),
  'trial_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='trial'),
  'blocked_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='blocked_billing'),
  'suspended_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='suspended' OR t.status='suspended'),
  'contracts_total',(SELECT pg_catalog.count(*) FROM public.contracts),
  'processes_total',(SELECT pg_catalog.count(*) FROM public.procurement_processes),
  'suppliers_total',(SELECT pg_catalog.count(*) FROM public.suppliers)
 );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_platform_staff_metrics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_platform_staff_metrics() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_staff_audit_events(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,action text,entity text,entity_id text,created_at timestamptz,actor_email text,tenant_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF NOT app_auth.has_platform_staff_permission('audit.view') THEN
  RAISE EXCEPTION 'Sem permissão para consultar auditoria.' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT e.id,e.action,e.entity,e.entity_id,e.created_at,u.email::text,t.name
 FROM public.audit_events e
 LEFT JOIN auth.users u ON u.id=e.actor_id
 LEFT JOIN public.tenants t ON t.id=e.tenant_id
 ORDER BY e.created_at DESC
 LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_staff_audit_events(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_staff_audit_events(integer) TO authenticated;

-- As contas internas nao podem ser misturadas com Master, tecnico de suporte ou usuario municipal.
CREATE OR REPLACE FUNCTION public.fn_prevent_platform_staff_role_overlap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_user_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Contas internas devem ser suspensas, nao excluidas fisicamente.';
 END IF;
 v_user_id:=NEW.user_id;
 IF TG_TABLE_NAME='platform_staff' THEN
  IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=v_user_id)
   OR EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=v_user_id)
   OR EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Esta conta ja pertence a outro perfil. Use uma conta exclusiva para a equipe interna.'
    USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='tenant_memberships' THEN
  IF EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Contas internas nao podem receber vinculo municipal.'
    USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='platform_admins' THEN
  IF EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Contas internas nao podem ser promovidas a Administrador Master.'
    USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='platform_support_agents' THEN
  IF EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Contas internas nao podem ser cadastradas como tecnicos de suporte.'
    USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_prevent_platform_staff_role_overlap() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER trg_prevent_platform_staff_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.platform_staff
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();
CREATE TRIGGER trg_prevent_staff_membership_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.tenant_memberships
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();
CREATE TRIGGER trg_prevent_staff_master_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.platform_admins
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();
CREATE TRIGGER trg_prevent_staff_support_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.platform_support_agents
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();

-- A Equipe Interna pode administrar somente a equipe técnica; sessao de suporte Master
-- continua exclusiva do Administrador Master.
DO $support_permissions$
DECLARE v_signature text; v_oid regprocedure; v_definition text; v_updated text;
BEGIN
 FOREACH v_signature IN ARRAY ARRAY[
  'public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)',
  'public.add_platform_support_agent(uuid,text)',
  'public.set_platform_support_agent_status(uuid,text)',
  'public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean)',
  'public.list_platform_support_candidates()',
  'public.list_platform_support_team()',
  'public.list_platform_support_assignments(uuid)'
 ] LOOP
  v_oid:=pg_catalog.to_regprocedure(v_signature);
  IF v_oid IS NOT NULL THEN
   v_definition:=pg_catalog.pg_get_functiondef(v_oid);
   v_updated:=pg_catalog.replace(v_definition,'IF NOT app_auth.is_platform_admin() THEN',
      'IF NOT app_auth.can_manage_platform_support_team() THEN');
   v_updated:=pg_catalog.replace(v_updated,'WHERE app_auth.is_platform_admin()',
      'WHERE app_auth.can_manage_platform_support_team()');
   IF v_updated IS DISTINCT FROM v_definition THEN
    EXECUTE v_updated;
   END IF;
  END IF;
 END LOOP;
END;
$support_permissions$;


-- Never offer internal staff accounts as municipal administrators or technical agents.
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
  AND NOT EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=p.id)
 ORDER BY p.full_name,u.email;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_tenant_admin_candidates() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_support_candidates()
RETURNS TABLE(user_id uuid,email text,display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT u.id,u.email,
  COALESCE(NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'),''),NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'),''),u.email)
 FROM auth.users u
 WHERE app_auth.can_manage_platform_support_team()
  AND u.email_confirmed_at IS NOT NULL
  AND u.deleted_at IS NULL
  AND NOT u.is_anonymous
  AND NOT EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=u.id)
 ORDER BY u.email;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_support_candidates() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_support_candidates() TO authenticated;


CREATE OR REPLACE FUNCTION public.can_manage_platform_support_team()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT app_auth.can_manage_platform_support_team();
$function$;
REVOKE ALL ON FUNCTION public.can_manage_platform_support_team() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_platform_support_team() TO authenticated;

COMMIT;
 THEN
  RETURN false;
 END IF;
 RETURN NOT EXISTS(
  SELECT 1 FROM auth.users u
  WHERE pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(p_email))
 );
END;
$function$;
REVOKE ALL ON FUNCTION public.can_invite_platform_staff(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_invite_platform_staff(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_platform_staff(
 p_user_id uuid,p_email text,p_display_name text,p_role_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_email text; v_name text:=pg_catalog.btrim(COALESCE(p_display_name,''));
BEGIN
 IF NOT app_auth.is_platform_admin() THEN
  RAISE EXCEPTION 'Somente o Administrador Master pode convidar colaboradores internos.' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR p_email IS NULL
  OR pg_catalog.length(pg_catalog.btrim(p_email)) NOT BETWEEN 3 AND 254
  OR pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 THEN
  RAISE EXCEPTION 'Informe nome e e-mail válidos.';
 END IF;
 SELECT pg_catalog.lower(pg_catalog.btrim(u.email)) INTO v_email
 FROM auth.users u WHERE u.id=p_user_id;
 IF NOT FOUND OR v_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email)) THEN
  RAISE EXCEPTION 'A conta de autenticação não corresponde ao e-mail convidado.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user_id)
  OR EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=p_user_id)
  OR EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=p_user_id) THEN
  RAISE EXCEPTION 'Esta conta já pertence a outro perfil. Colaboradores internos usam uma conta exclusiva.';
 END IF;
 IF p_role_ids IS NULL OR pg_catalog.cardinality(p_role_ids)=0
  OR EXISTS(SELECT 1 FROM unnest(p_role_ids) x(id)
    WHERE NOT EXISTS(SELECT 1 FROM public.platform_staff_roles r WHERE r.id=x.id AND r.is_active)) THEN
  RAISE EXCEPTION 'Selecione ao menos um perfil interno válido.';
 END IF;
 INSERT INTO public.platform_staff(user_id,email,display_name,status,invited_by)
 VALUES(p_user_id,v_email,v_name,'invited',(SELECT auth.uid()));
 INSERT INTO public.platform_staff_role_assignments(user_id,role_id,assigned_by)
 SELECT p_user_id,r.id,(SELECT auth.uid())
 FROM public.platform_staff_roles r WHERE r.id=ANY(p_role_ids) AND r.is_active
 ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.invited','platform_staff',p_user_id::text,
  pg_catalog.jsonb_build_object('email',v_email,'display_name',v_name,'role_ids',p_role_ids));
END;
$function$;
REVOKE ALL ON FUNCTION public.register_platform_staff(uuid,text,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_platform_staff(uuid,text,text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_my_platform_staff()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_user uuid:=(SELECT auth.uid()); v_email text; v_status text;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.lower(pg_catalog.btrim(u.email)) INTO v_email
 FROM auth.users u WHERE u.id=v_user AND u.email_confirmed_at IS NOT NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT s.status INTO v_status FROM public.platform_staff s
 WHERE s.user_id=v_user AND s.email=v_email;
 IF NOT FOUND OR v_status='suspended' THEN RETURN false; END IF;
 IF v_status='invited' THEN
  UPDATE public.platform_staff SET status='active',activated_at=pg_catalog.now(),
   updated_at=pg_catalog.now() WHERE user_id=v_user AND status='invited';
  INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
  VALUES(v_user,'platform_staff.activated','platform_staff',v_user::text,
   pg_catalog.jsonb_build_object('activation','confirmed_email_and_first_password'));
 END IF;
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.activate_my_platform_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_my_platform_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_staff_status(p_user_id uuid,p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_activated timestamptz;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode suspender colaboradores.' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
 SELECT activated_at INTO v_activated FROM public.platform_staff WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
 IF p_status='active' AND v_activated IS NULL THEN
  RAISE EXCEPTION 'O convite precisa ser aceito antes da ativação.';
 END IF;
 IF p_status='active' AND NOT EXISTS(
   SELECT 1 FROM auth.users u
   JOIN public.platform_staff s ON s.user_id=u.id
   WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(u.email))=s.email
 ) THEN
  RAISE EXCEPTION 'A conta precisa confirmar o e-mail cadastrado antes da reativação.';
 END IF;
 UPDATE public.platform_staff SET status=p_status,
   suspended_at=CASE WHEN p_status='suspended' THEN pg_catalog.now() ELSE NULL END,
   updated_at=pg_catalog.now()
 WHERE user_id=p_user_id;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.status_changed','platform_staff',p_user_id::text,
  pg_catalog.jsonb_build_object('status',p_status));
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_staff_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_staff_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_staff_roles(p_user_id uuid,p_role_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode alterar perfis internos.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=p_user_id) THEN
  RAISE EXCEPTION 'Colaborador não encontrado.';
 END IF;
 IF p_role_ids IS NULL OR pg_catalog.cardinality(p_role_ids)=0
  OR EXISTS(SELECT 1 FROM unnest(p_role_ids) x(id)
   WHERE NOT EXISTS(SELECT 1 FROM public.platform_staff_roles r WHERE r.id=x.id AND r.is_active)) THEN
  RAISE EXCEPTION 'O colaborador deve manter ao menos um perfil válido.';
 END IF;
 DELETE FROM public.platform_staff_role_assignments WHERE user_id=p_user_id;
 INSERT INTO public.platform_staff_role_assignments(user_id,role_id,assigned_by)
 SELECT p_user_id,r.id,(SELECT auth.uid())
 FROM public.platform_staff_roles r WHERE r.id=ANY(p_role_ids) AND r.is_active;
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.roles_changed','platform_staff',p_user_id::text,
  pg_catalog.jsonb_build_object('role_ids',p_role_ids));
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_staff_roles(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_platform_staff_roles(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_platform_staff_role(
 p_role_id uuid,p_slug text,p_name text,p_description text,p_permission_codes text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_id uuid; v_slug text:=pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug,'')));
 v_name text:=pg_catalog.btrim(COALESCE(p_name,'')); v_system boolean;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o Administrador Master pode configurar perfis internos.' USING ERRCODE='42501'; END IF;
 IF v_slug !~ '^[a-z0-9][a-z0-9_-]{1,59}$' OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 80 THEN
  RAISE EXCEPTION 'Informe nome e identificador válidos para o perfil.';
 END IF;
 IF p_permission_codes IS NULL OR pg_catalog.cardinality(p_permission_codes)=0
  OR NOT ('dashboard.view'=ANY(p_permission_codes))
  OR EXISTS(SELECT 1 FROM unnest(p_permission_codes) x(code)
   WHERE NOT EXISTS(SELECT 1 FROM public.platform_staff_permissions p WHERE p.code=x.code)) THEN
  RAISE EXCEPTION 'Cada perfil precisa incluir o acesso básico ao Portal Interno e permissões válidas.';
 END IF;
 IF p_role_id IS NULL THEN
  INSERT INTO public.platform_staff_roles(slug,name,description,is_system,created_by)
  VALUES(v_slug,v_name,NULLIF(pg_catalog.btrim(COALESCE(p_description,'')),''),false,(SELECT auth.uid()))
  RETURNING id INTO v_id;
 ELSE
  SELECT is_system INTO v_system FROM public.platform_staff_roles WHERE id=p_role_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil não encontrado.'; END IF;
  IF v_system THEN
   UPDATE public.platform_staff_roles SET description=NULLIF(pg_catalog.btrim(COALESCE(p_description,'')),''),
    updated_at=pg_catalog.now() WHERE id=p_role_id;
   v_id:=p_role_id;
  ELSE
   UPDATE public.platform_staff_roles SET slug=v_slug,name=v_name,
    description=NULLIF(pg_catalog.btrim(COALESCE(p_description,'')),''),
    updated_at=pg_catalog.now() WHERE id=p_role_id;
   v_id:=p_role_id;
  END IF;
 END IF;
 DELETE FROM public.platform_staff_role_permissions WHERE role_id=v_id;
 INSERT INTO public.platform_staff_role_permissions(role_id,permission_code)
 SELECT v_id,p.code FROM public.platform_staff_permissions p
 WHERE p.code=ANY(p_permission_codes);
 INSERT INTO public.audit_events(actor_id,action,entity,entity_id,details)
 VALUES((SELECT auth.uid()),'platform_staff.role_permissions_changed','platform_staff_roles',v_id::text,
  pg_catalog.jsonb_build_object('permission_codes',p_permission_codes));
 RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_platform_staff_role(uuid,text,text,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_platform_staff_role(uuid,text,text,text,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_staff_tenants()
RETURNS TABLE(
 id uuid,name text,slug text,status text,commercial_status text,plan_tier text,
 monthly_fee numeric,municipality text,state text,created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_billing boolean:=app_auth.has_platform_staff_permission('billing.summary.view');
BEGIN
 IF NOT (
   app_auth.has_platform_staff_permission('clients.view')
   OR app_auth.has_platform_staff_permission('plans.view')
   OR app_auth.has_platform_staff_permission('billing.summary.view')
   OR app_auth.has_platform_staff_permission('support.team.manage')
 ) THEN
  RAISE EXCEPTION 'Sem permissão para consultar clientes.' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT t.id,t.name,t.slug,t.status,t.commercial_status,t.plan_tier,
   CASE WHEN v_billing THEN t.monthly_fee ELSE NULL END,
   t.municipality,t.state,t.created_at
 FROM public.tenants t ORDER BY t.name;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_staff_tenants() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_staff_tenants() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_staff_metrics()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_billing boolean:=app_auth.has_platform_staff_permission('billing.summary.view');
BEGIN
 IF NOT (
   app_auth.has_platform_staff_permission('metrics.view')
   OR app_auth.has_platform_staff_permission('billing.summary.view')
 ) THEN
  RAISE EXCEPTION 'Sem permissão para consultar métricas ou resumo financeiro.' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'mrr_estimated',CASE WHEN v_billing THEN
    (SELECT COALESCE(pg_catalog.sum(t.monthly_fee),0) FROM public.tenants t WHERE t.commercial_status='active' AND t.status='active')
    ELSE NULL END,
  'active_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='active' AND t.status='active'),
  'trial_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='trial'),
  'blocked_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='blocked_billing'),
  'suspended_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='suspended' OR t.status='suspended'),
  'contracts_total',(SELECT pg_catalog.count(*) FROM public.contracts),
  'processes_total',(SELECT pg_catalog.count(*) FROM public.procurement_processes),
  'suppliers_total',(SELECT pg_catalog.count(*) FROM public.suppliers)
 );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_platform_staff_metrics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_platform_staff_metrics() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_staff_audit_events(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,action text,entity text,entity_id text,created_at timestamptz,actor_email text,tenant_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF NOT app_auth.has_platform_staff_permission('audit.view') THEN
  RAISE EXCEPTION 'Sem permissão para consultar auditoria.' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT e.id,e.action,e.entity,e.entity_id,e.created_at,u.email::text,t.name
 FROM public.audit_events e
 LEFT JOIN auth.users u ON u.id=e.actor_id
 LEFT JOIN public.tenants t ON t.id=e.tenant_id
 ORDER BY e.created_at DESC
 LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_staff_audit_events(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_staff_audit_events(integer) TO authenticated;

-- As contas internas nao podem ser misturadas com Master, tecnico de suporte ou usuario municipal.
CREATE OR REPLACE FUNCTION public.fn_prevent_platform_staff_role_overlap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_user_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Contas internas devem ser suspensas, nao excluidas fisicamente.';
 END IF;
 v_user_id:=NEW.user_id;
 IF TG_TABLE_NAME='platform_staff' THEN
  IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=v_user_id)
   OR EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=v_user_id)
   OR EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Esta conta ja pertence a outro perfil. Use uma conta exclusiva para a equipe interna.'
    USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='tenant_memberships' THEN
  IF EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Contas internas nao podem receber vinculo municipal.'
    USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='platform_admins' THEN
  IF EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Contas internas nao podem ser promovidas a Administrador Master.'
    USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='platform_support_agents' THEN
  IF EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=v_user_id) THEN
   RAISE EXCEPTION 'Contas internas nao podem ser cadastradas como tecnicos de suporte.'
    USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_prevent_platform_staff_role_overlap() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER trg_prevent_platform_staff_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.platform_staff
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();
CREATE TRIGGER trg_prevent_staff_membership_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.tenant_memberships
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();
CREATE TRIGGER trg_prevent_staff_master_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.platform_admins
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();
CREATE TRIGGER trg_prevent_staff_support_overlap
 BEFORE INSERT OR UPDATE OF user_id ON public.platform_support_agents
 FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_platform_staff_role_overlap();

-- A Equipe Interna pode administrar somente a equipe técnica; sessao de suporte Master
-- continua exclusiva do Administrador Master.
DO $support_permissions$
DECLARE v_signature text; v_oid regprocedure; v_definition text; v_updated text;
BEGIN
 FOREACH v_signature IN ARRAY ARRAY[
  'public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)',
  'public.add_platform_support_agent(uuid,text)',
  'public.set_platform_support_agent_status(uuid,text)',
  'public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean)',
  'public.list_platform_support_candidates()',
  'public.list_platform_support_team()',
  'public.list_platform_support_assignments(uuid)'
 ] LOOP
  v_oid:=pg_catalog.to_regprocedure(v_signature);
  IF v_oid IS NOT NULL THEN
   v_definition:=pg_catalog.pg_get_functiondef(v_oid);
   v_updated:=pg_catalog.replace(v_definition,'IF NOT app_auth.is_platform_admin() THEN',
      'IF NOT app_auth.can_manage_platform_support_team() THEN');
   v_updated:=pg_catalog.replace(v_updated,'WHERE app_auth.is_platform_admin()',
      'WHERE app_auth.can_manage_platform_support_team()');
   IF v_updated IS DISTINCT FROM v_definition THEN
    EXECUTE v_updated;
   END IF;
  END IF;
 END LOOP;
END;
$support_permissions$;


-- Never offer internal staff accounts as municipal administrators or technical agents.
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
  AND NOT EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=p.id)
 ORDER BY p.full_name,u.email;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_tenant_admin_candidates() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_support_candidates()
RETURNS TABLE(user_id uuid,email text,display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT u.id,u.email,
  COALESCE(NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'),''),NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'),''),u.email)
 FROM auth.users u
 WHERE app_auth.can_manage_platform_support_team()
  AND u.email_confirmed_at IS NOT NULL
  AND u.deleted_at IS NULL
  AND NOT u.is_anonymous
  AND NOT EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_support_agents sa WHERE sa.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.platform_staff s WHERE s.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=u.id)
 ORDER BY u.email;
$function$;
REVOKE ALL ON FUNCTION public.list_platform_support_candidates() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_support_candidates() TO authenticated;


CREATE OR REPLACE FUNCTION public.can_manage_platform_support_team()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT app_auth.can_manage_platform_support_team();
$function$;
REVOKE ALL ON FUNCTION public.can_manage_platform_support_team() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_platform_support_team() TO authenticated;

COMMIT;
