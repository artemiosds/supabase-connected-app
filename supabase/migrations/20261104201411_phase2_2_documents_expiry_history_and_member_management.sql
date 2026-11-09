-- Fase 2.2: documentos de fornecedores, modelos, vencimentos e documentos gerados.
-- Inclui verificação tenant-aware, auditoria e gestão inicial de vínculos.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS municipality text,
  ADD COLUMN IF NOT EXISTS state text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_state_format'
      AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_state_format
      CHECK (state IS NULL OR state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
END $$;

CREATE TABLE public.supplier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'outros',
  issue_date date,
  expires_at date,
  storage_provider text NOT NULL DEFAULT 'external_link',
  external_url text,
  drive_file_id text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_documents_title_length CHECK (length(btrim(title)) BETWEEN 2 AND 180),
  CONSTRAINT supplier_documents_type_valid CHECK (document_type IN (
    'contrato','certidao_federal','certidao_estadual','certidao_municipal',
    'fgts','trabalhista','sanitaria','alvara','proposta','outros'
  )),
  CONSTRAINT supplier_documents_provider_valid CHECK (storage_provider IN ('google_drive','external_link')),
  CONSTRAINT supplier_documents_url_valid CHECK (external_url IS NULL OR external_url ~ '^https?://'),
  CONSTRAINT supplier_documents_status_valid CHECK (status IN ('active','archived')),
  CONSTRAINT supplier_documents_dates_valid CHECK (issue_date IS NULL OR expires_at IS NULL OR expires_at >= issue_date),
  CONSTRAINT supplier_documents_tenant_id_pair UNIQUE (id, tenant_id)
);
CREATE INDEX idx_supplier_documents_tenant_expiry
  ON public.supplier_documents (tenant_id, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;
CREATE INDEX idx_supplier_documents_tenant_supplier
  ON public.supplier_documents (tenant_id, supplier_id, status);
CREATE INDEX idx_supplier_documents_tenant_type
  ON public.supplier_documents (tenant_id, document_type, status);

CREATE TABLE public.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  title text NOT NULL,
  description text,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_templates_title_length CHECK (length(btrim(title)) BETWEEN 2 AND 180),
  CONSTRAINT document_templates_content_length CHECK (length(content) BETWEEN 1 AND 50000),
  CONSTRAINT document_templates_description_length CHECK (description IS NULL OR length(description) <= 1000)
);
CREATE INDEX idx_document_templates_tenant_active
  ON public.document_templates (tenant_id, is_active, title);

CREATE TABLE public.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  template_id uuid REFERENCES public.document_templates(id),
  title text NOT NULL,
  content_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  signed_by uuid REFERENCES auth.users(id),
  signed_name text,
  signed_email text,
  signed_at timestamptz,
  signature_statement text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generated_documents_title_length CHECK (length(btrim(title)) BETWEEN 2 AND 180),
  CONSTRAINT generated_documents_content_length CHECK (length(content_snapshot) BETWEEN 1 AND 100000),
  CONSTRAINT generated_documents_status_valid CHECK (status IN ('draft','signed','cancelled')),
  CONSTRAINT generated_documents_signature_consistency CHECK (
    (status = 'signed' AND signed_by IS NOT NULL AND signed_at IS NOT NULL
      AND signed_name IS NOT NULL AND signature_statement IS NOT NULL)
    OR (status <> 'signed' AND signed_by IS NULL AND signed_at IS NULL)
  )
);
CREATE INDEX idx_generated_documents_tenant_created
  ON public.generated_documents (tenant_id, created_at DESC);
CREATE INDEX idx_generated_documents_tenant_status
  ON public.generated_documents (tenant_id, status, created_at DESC);
CREATE INDEX idx_generated_documents_tenant_supplier
  ON public.generated_documents (tenant_id, supplier_id);

ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_auth.has_tenant_data_permission(p_tenant_id uuid, p_permission_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT NOT app_auth.is_platform_admin()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      JOIN public.tenants t ON t.id = tm.tenant_id
      JOIN public.membership_roles mr ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
      JOIN public.tenant_roles tr ON tr.id = mr.role_id AND tr.tenant_id = mr.tenant_id
      JOIN public.tenant_role_permissions rp ON rp.role_id = tr.id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE tm.tenant_id = p_tenant_id
        AND tm.user_id = (SELECT auth.uid())
        AND tm.status = 'active'
        AND t.status = 'active'
        AND p.code = p_permission_code
    );
$function$;
REVOKE ALL ON FUNCTION app_auth.has_tenant_data_permission(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_auth TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.has_tenant_data_permission(uuid,text) TO authenticated;

CREATE POLICY p_supplier_documents_select ON public.supplier_documents
  FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_supplier_documents_insert ON public.supplier_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );
CREATE POLICY p_supplier_documents_update ON public.supplier_documents
  FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')))
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update')));

CREATE POLICY p_document_templates_select ON public.document_templates
  FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_document_templates_insert ON public.document_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:manage_templates'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );
CREATE POLICY p_document_templates_update ON public.document_templates
  FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:manage_templates')))
  WITH CHECK ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:manage_templates')));

CREATE POLICY p_generated_documents_select ON public.generated_documents
  FOR SELECT TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
CREATE POLICY p_generated_documents_insert ON public.generated_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:create'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );
CREATE POLICY p_generated_documents_update ON public.generated_documents
  FOR UPDATE TO authenticated
  USING (
    (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    OR (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:sign'))
  )
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:update'))
    OR (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:sign'))
  );

REVOKE ALL ON public.supplier_documents, public.document_templates, public.generated_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.supplier_documents, public.document_templates, public.generated_documents TO authenticated;
REVOKE DELETE ON public.supplier_documents, public.document_templates, public.generated_documents FROM authenticated;

CREATE OR REPLACE FUNCTION public.fn_guard_supplier_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE v_supplier_tenant uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria, fornecedor e dados de criacao sao imutaveis.';
    END IF;
    NEW.updated_by := (SELECT auth.uid());
    NEW.updated_at := now();
  END IF;
  SELECT s.tenant_id INTO v_supplier_tenant FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  IF v_supplier_tenant IS NULL OR v_supplier_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'O documento e o fornecedor precisam pertencer a mesma Secretaria.';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_supplier_documents_guard BEFORE INSERT OR UPDATE ON public.supplier_documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_supplier_document();

CREATE OR REPLACE FUNCTION public.fn_guard_document_template()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid()); NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := now(); NEW.updated_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria e dados de criacao do modelo sao imutaveis.';
    END IF;
    NEW.updated_by := (SELECT auth.uid()); NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_document_templates_guard BEFORE INSERT OR UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_document_template();

CREATE OR REPLACE FUNCTION public.fn_guard_generated_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE v_supplier_tenant uuid; v_template_tenant uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Novos documentos precisam iniciar como rascunho.'; END IF;
    NEW.created_by := (SELECT auth.uid()); NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := now(); NEW.updated_at := now();
    NEW.signed_by := NULL; NEW.signed_name := NULL; NEW.signed_email := NULL;
    NEW.signed_at := NULL; NEW.signature_statement := NULL;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Identidade, Secretaria e dados de criacao sao imutaveis.';
    END IF;
    IF OLD.status = 'signed' THEN RAISE EXCEPTION 'Documento assinado e imutavel.'; END IF;
    IF NEW.status = 'signed' THEN
      IF NOT app_auth.has_tenant_data_permission(OLD.tenant_id,'documents:sign') THEN
        RAISE EXCEPTION 'Sem permissao para registrar assinatura deste documento.';
      END IF;
      NEW.title := OLD.title; NEW.content_snapshot := OLD.content_snapshot;
      NEW.supplier_id := OLD.supplier_id; NEW.template_id := OLD.template_id;
      NEW.signed_by := (SELECT auth.uid());
      SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),'Usuario')
        INTO NEW.signed_name FROM public.profiles p WHERE p.id = (SELECT auth.uid());
      SELECT u.email INTO NEW.signed_email FROM auth.users u WHERE u.id = (SELECT auth.uid());
      NEW.signed_at := now();
      NEW.signature_statement := 'Assinatura eletronica simples registrada com autenticacao da conta na plataforma.';
    ELSE
      NEW.signed_by := NULL; NEW.signed_name := NULL; NEW.signed_email := NULL;
      NEW.signed_at := NULL; NEW.signature_statement := NULL;
    END IF;
    NEW.updated_by := (SELECT auth.uid()); NEW.updated_at := now();
  END IF;
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_supplier_tenant FROM public.suppliers s WHERE s.id = NEW.supplier_id;
    IF v_supplier_tenant IS NULL OR v_supplier_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'O documento e o fornecedor precisam pertencer a mesma Secretaria.';
    END IF;
  END IF;
  IF NEW.template_id IS NOT NULL THEN
    SELECT t.tenant_id INTO v_template_tenant FROM public.document_templates t WHERE t.id = NEW.template_id;
    IF v_template_tenant IS NULL OR v_template_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'O modelo e o documento precisam pertencer a mesma Secretaria.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_generated_documents_guard BEFORE INSERT OR UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_generated_document();

CREATE OR REPLACE FUNCTION public.fn_audit_document_module()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_fields jsonb; v_entity text := TG_TABLE_NAME; v_tenant_id uuid; v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_fields := '["created"]'::jsonb; v_tenant_id := NEW.tenant_id; v_id := NEW.id;
  ELSE
    SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key),'[]'::jsonb) INTO v_fields
    FROM jsonb_each(to_jsonb(NEW)) n(key,value)
    WHERE n.key NOT IN ('updated_at','updated_by')
      AND (to_jsonb(OLD)->n.key) IS DISTINCT FROM n.value;
    v_tenant_id := NEW.tenant_id; v_id := NEW.id;
  END IF;
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(v_tenant_id,(SELECT auth.uid()),TG_OP,v_entity,v_id::text,jsonb_build_object('changed_fields',v_fields),now());
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_audit_document_module() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_supplier_document() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_document_template() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_generated_document() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_supplier_documents_audit AFTER INSERT OR UPDATE ON public.supplier_documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();
CREATE TRIGGER trg_document_templates_audit AFTER INSERT OR UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();
CREATE TRIGGER trg_generated_documents_audit AFTER INSERT OR UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();

CREATE OR REPLACE FUNCTION public.get_document_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean,can_create boolean,can_update boolean,can_sign boolean,can_manage_templates boolean)
LANGUAGE sql STABLE SET search_path = ''
AS $function$
 SELECT app_auth.has_tenant_data_permission(p_tenant_id,'documents:view'),
        app_auth.has_tenant_data_permission(p_tenant_id,'documents:create'),
        app_auth.has_tenant_data_permission(p_tenant_id,'documents:update'),
        app_auth.has_tenant_data_permission(p_tenant_id,'documents:sign'),
        app_auth.has_tenant_data_permission(p_tenant_id,'documents:manage_templates');
$function$;
REVOKE ALL ON FUNCTION public.get_document_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_capabilities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_tenant_member(p_tenant_id uuid,p_user_id uuid,p_role_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE v_membership_id uuid;
BEGIN
  IF NOT app_auth.has_tenant_permission(p_tenant_id,'users:create')
    OR NOT app_auth.has_tenant_permission(p_tenant_id,'users:assign_role') THEN
    RAISE EXCEPTION 'Sem permissao para incluir usuarios e atribuir papeis nesta Secretaria.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.status='active') THEN
    RAISE EXCEPTION 'Secretaria inexistente ou inativa.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_user_id) THEN
    RAISE EXCEPTION 'A conta precisa estar cadastrada e confirmada antes do vinculo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user_id AND pa.is_active) THEN
    RAISE EXCEPTION 'Administrador global nao pode ser vinculado como administrador municipal.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_roles r WHERE r.id=p_role_id AND r.tenant_id=p_tenant_id) THEN
    RAISE EXCEPTION 'Papel nao pertence a Secretaria selecionada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant_id AND m.user_id=p_user_id AND m.status='active') THEN
    RAISE EXCEPTION 'Este usuario ja possui vinculo ativo nesta Secretaria.';
  END IF;
  INSERT INTO public.tenant_memberships(tenant_id,user_id,status)
    VALUES(p_tenant_id,p_user_id,'active') RETURNING id INTO v_membership_id;
  INSERT INTO public.membership_roles(membership_id,role_id,tenant_id)
    VALUES(v_membership_id,p_role_id,p_tenant_id);
  RETURN v_membership_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.add_tenant_member(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_tenant_member(uuid,uuid,uuid) TO authenticated;

INSERT INTO public.permissions(code,name,description,module) VALUES
 ('documents:view','Visualizar documentos','Consultar documentos e vencimentos da Secretaria','documents'),
 ('documents:create','Criar documentos','Cadastrar documentos de fornecedores e gerar documentos','documents'),
 ('documents:update','Editar documentos','Editar documentos ainda nao assinados','documents'),
 ('documents:sign','Assinar documentos','Registrar assinatura eletronica simples','documents'),
 ('documents:manage_templates','Gerenciar modelos','Importar e editar modelos de documentos','documents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r JOIN public.permissions p
  ON p.code IN ('documents:view','documents:create','documents:update','documents:sign','documents:manage_templates')
WHERE r.is_system AND r.slug='admin' ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r JOIN public.permissions p
  ON p.code IN ('documents:view','documents:create','documents:update','documents:sign')
WHERE r.is_system AND r.slug='manager' ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r JOIN public.permissions p
  ON p.code IN ('documents:view','documents:create')
WHERE r.is_system AND r.slug='operator' ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.tenant_roles r JOIN public.permissions p
  ON p.code='documents:view'
WHERE r.is_system AND r.slug='viewer' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_tenant_with_admin(
 p_name text,p_slug text,p_admin_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
 v_tenant_id uuid; v_membership_id uuid; v_admin_role_id uuid;
 v_manager_role_id uuid; v_operator_role_id uuid; v_viewer_role_id uuid; v_slug text;
BEGIN
 IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Acesso negado: somente superadministrador da plataforma pode provisionar organizacoes.'; END IF;
 IF p_admin_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_admin_user_id)
 THEN RAISE EXCEPTION 'O usuario administrador precisa existir no cadastro e possuir perfil.'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_admin_user_id)
 THEN RAISE EXCEPTION 'Superadministrador global nao pode ser administrador municipal.'; END IF;
 IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 3 AND 160
 THEN RAISE EXCEPTION 'Nome da organizacao invalido (3 a 160 caracteres).'; END IF;
 v_slug:=pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug,'')));
 IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR pg_catalog.length(v_slug) NOT BETWEEN 3 AND 63
 THEN RAISE EXCEPTION 'Slug invalido.'; END IF;
 INSERT INTO public.tenants(name,slug,created_by,status)
 VALUES(pg_catalog.btrim(p_name),v_slug,(SELECT auth.uid()),'active') RETURNING id INTO v_tenant_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Administrador da Organizacao','admin','Administracao da organizacao',true) RETURNING id INTO v_admin_role_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Gestor','manager','Gestao com privilegios limitados',true) RETURNING id INTO v_manager_role_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Operador','operator','Operacao com privilegios limitados',true) RETURNING id INTO v_operator_role_id;
 INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
 VALUES(v_tenant_id,'Consulta','viewer','Consulta com privilegios limitados',true) RETURNING id INTO v_viewer_role_id;
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_admin_role_id,p.id FROM public.permissions p;
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_manager_role_id,p.id FROM public.permissions p
 WHERE p.code IN ('org:view','users:view','suppliers:view','suppliers:create','suppliers:update','documents:view','documents:create','documents:update','documents:sign');
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_operator_role_id,p.id FROM public.permissions p
 WHERE p.code IN ('org:view','suppliers:view','suppliers:create','documents:view','documents:create');
 INSERT INTO public.tenant_role_permissions(role_id,permission_id) SELECT v_viewer_role_id,p.id FROM public.permissions p
 WHERE p.code IN ('org:view','suppliers:view','documents:view');
 INSERT INTO public.tenant_memberships(tenant_id,user_id,status) VALUES(v_tenant_id,p_admin_user_id,'active')
 RETURNING id INTO v_membership_id;
 INSERT INTO public.membership_roles(membership_id,role_id,tenant_id) VALUES(v_membership_id,v_admin_role_id,v_tenant_id);
 RETURN pg_catalog.jsonb_build_object('success',true,'tenant_id',v_tenant_id,'slug',v_slug,'admin_user_id',p_admin_user_id);
END;
$function$;
