-- Fase 2.1: cadastro de fornecedores e isolamento por Secretaria.
CREATE OR REPLACE FUNCTION public.normalize_cnpj(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT NULLIF(regexp_replace(upper(COALESCE(p,'')),'[./[:space:]-]','','g'),'');
$$;
CREATE OR REPLACE FUNCTION public.is_valid_cnpj(p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE v text:=public.normalize_cnpj(p); w1 int[]:=ARRAY[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[]:=ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2]; s int; r int; d int; i int; n int;
BEGIN
 IF v IS NULL OR v !~ '^[A-Z0-9]{12}[0-9]{2}$' OR v=repeat(substr(v,1,1),14) THEN RETURN false; END IF;
 s:=0; FOR i IN 1..12 LOOP n:=ascii(substr(v,i,1))-48; s:=s+n*w1[i]; END LOOP;
 r:=s%11; d:=CASE WHEN r<2 THEN 0 ELSE 11-r END; IF substr(v,13,1)::int<>d THEN RETURN false; END IF;
 s:=0; FOR i IN 1..13 LOOP n:=ascii(substr(v,i,1))-48; s:=s+n*w2[i]; END LOOP;
 r:=s%11; d:=CASE WHEN r<2 THEN 0 ELSE 11-r END; RETURN substr(v,14,1)::int=d;
END; $$;
CREATE TABLE public.suppliers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 cnpj text NOT NULL,legal_name text NOT NULL,trade_name text,category text NOT NULL DEFAULT 'outros',
 status text NOT NULL DEFAULT 'active',contact_name text,contact_phone text,contact_email text,website text,
 postal_code text,street text,street_number text,complement text,neighborhood text,city text,state text,notes text,
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT suppliers_cnpj_normalized CHECK(cnpj=public.normalize_cnpj(cnpj) AND public.is_valid_cnpj(cnpj)),
 CONSTRAINT suppliers_tenant_cnpj_unique UNIQUE(tenant_id,cnpj),
 CONSTRAINT suppliers_legal_name_length CHECK(length(btrim(legal_name)) BETWEEN 2 AND 200),
 CONSTRAINT suppliers_category_valid CHECK(category IN('medicamentos','materiais_hospitalares','equipamentos','servicos','alimentacao','transporte','outros')),
 CONSTRAINT suppliers_status_valid CHECK(status IN('active','inactive')),
 CONSTRAINT suppliers_state_format CHECK(state IS NULL OR state ~ '^[A-Z]{2}$'),
 CONSTRAINT suppliers_notes_length CHECK(notes IS NULL OR length(notes)<=2000)
);
CREATE INDEX idx_suppliers_tenant_status_name ON public.suppliers(tenant_id,status,legal_name);
CREATE INDEX idx_suppliers_tenant_category_name ON public.suppliers(tenant_id,category,legal_name);
CREATE INDEX idx_suppliers_tenant_updated ON public.suppliers(tenant_id,updated_at DESC);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY; ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION app_auth.has_supplier_permission(p_tenant_id uuid,p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT app_auth.is_platform_admin() AND EXISTS(
 SELECT 1 FROM public.tenant_memberships tm JOIN public.tenants t ON t.id=tm.tenant_id
 JOIN public.membership_roles mr ON mr.membership_id=tm.id AND mr.tenant_id=tm.tenant_id
 JOIN public.tenant_roles tr ON tr.id=mr.role_id AND tr.tenant_id=mr.tenant_id
 JOIN public.tenant_role_permissions rp ON rp.role_id=tr.id JOIN public.permissions p ON p.id=rp.permission_id
 WHERE tm.tenant_id=p_tenant_id AND tm.user_id=(SELECT auth.uid()) AND tm.status='active' AND t.status='active' AND p.code=p_code);
$$;
REVOKE ALL ON FUNCTION app_auth.has_supplier_permission(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA app_auth TO authenticated; GRANT EXECUTE ON FUNCTION app_auth.has_supplier_permission(uuid,text) TO authenticated;
CREATE POLICY p_suppliers_select ON public.suppliers FOR SELECT TO authenticated USING((SELECT app_auth.has_supplier_permission(tenant_id,'suppliers:view')));
CREATE POLICY p_suppliers_insert ON public.suppliers FOR INSERT TO authenticated WITH CHECK((SELECT app_auth.has_supplier_permission(tenant_id,'suppliers:create')) AND created_by=(SELECT auth.uid()) AND updated_by=(SELECT auth.uid()));
CREATE POLICY p_suppliers_update ON public.suppliers FOR UPDATE TO authenticated USING((SELECT app_auth.has_supplier_permission(tenant_id,'suppliers:update'))) WITH CHECK((SELECT app_auth.has_supplier_permission(tenant_id,'suppliers:update')));
REVOKE ALL ON public.suppliers FROM PUBLIC,anon; GRANT SELECT,INSERT,UPDATE ON public.suppliers TO authenticated; REVOKE DELETE ON public.suppliers FROM authenticated;
CREATE OR REPLACE FUNCTION public.fn_protect_supplier_write() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.cnpj:=public.normalize_cnpj(NEW.cnpj); NEW.created_by:=(SELECT auth.uid()); NEW.updated_by:=(SELECT auth.uid()); NEW.created_at:=now(); NEW.updated_at:=now(); RETURN NEW; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Identidade, Secretaria e dados de criacao sao imutaveis.'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT app_auth.has_supplier_permission(OLD.tenant_id,'suppliers:deactivate') THEN RAISE EXCEPTION 'Sem permissao para inativar ou reativar.'; END IF;
 NEW.cnpj:=public.normalize_cnpj(NEW.cnpj); NEW.updated_by:=(SELECT auth.uid()); NEW.updated_at:=now(); RETURN NEW;
END; $$;
CREATE TRIGGER trg_suppliers_protect_write BEFORE INSERT OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.fn_protect_supplier_write();
CREATE OR REPLACE FUNCTION public.fn_audit_supplier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fields jsonb;
BEGIN
 IF TG_OP='INSERT' THEN fields:='["cnpj","legal_name","trade_name","category","status"]'::jsonb;
 ELSE SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key),'[]'::jsonb) INTO fields FROM jsonb_each(to_jsonb(NEW)) n(key,value) WHERE n.key NOT IN('updated_at','updated_by') AND (to_jsonb(OLD)->n.key) IS DISTINCT FROM n.value; END IF;
 INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at) VALUES(NEW.tenant_id,(SELECT auth.uid()),TG_OP,'suppliers',NEW.id::text,jsonb_build_object('changed_fields',fields),now()); RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.fn_protect_supplier_write() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_audit_supplier() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_suppliers_audit AFTER INSERT OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.fn_audit_supplier();
CREATE OR REPLACE FUNCTION public.get_supplier_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean,can_create boolean,can_update boolean,can_deactivate boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT app_auth.has_supplier_permission(p_tenant_id,'suppliers:view'),app_auth.has_supplier_permission(p_tenant_id,'suppliers:create'),app_auth.has_supplier_permission(p_tenant_id,'suppliers:update'),app_auth.has_supplier_permission(p_tenant_id,'suppliers:deactivate');
$$;
REVOKE ALL ON FUNCTION public.get_supplier_capabilities(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_supplier_capabilities(uuid) TO authenticated;
INSERT INTO public.permissions(code,name,description,module) VALUES
 ('suppliers:view','Visualizar fornecedores','Consultar fornecedores da Secretaria','suppliers'),
 ('suppliers:create','Cadastrar fornecedores','Cadastrar fornecedores na Secretaria','suppliers'),
 ('suppliers:update','Editar fornecedores','Editar dados cadastrais','suppliers'),
 ('suppliers:deactivate','Inativar fornecedores','Inativar ou reativar sem apagar historico','suppliers') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT tr.id,p.id FROM public.tenant_roles tr JOIN public.permissions p ON p.code IN('suppliers:view','suppliers:create','suppliers:update','suppliers:deactivate') WHERE tr.is_system AND tr.slug='admin' ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT tr.id,p.id FROM public.tenant_roles tr JOIN public.permissions p ON p.code IN('suppliers:view','suppliers:create','suppliers:update') WHERE tr.is_system AND tr.slug='manager' ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT tr.id,p.id FROM public.tenant_roles tr JOIN public.permissions p ON p.code IN('suppliers:view','suppliers:create') WHERE tr.is_system AND tr.slug='operator' ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT tr.id,p.id FROM public.tenant_roles tr JOIN public.permissions p ON p.code='suppliers:view' WHERE tr.is_system AND tr.slug='viewer' ON CONFLICT DO NOTHING;
