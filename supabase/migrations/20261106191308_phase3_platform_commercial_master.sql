-- Fase comercial do SaaS: adição segura à estrutura multitenant existente.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS commercial_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'profissional',
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS manager_name text,
  ADD COLUMN IF NOT EXISTS ibge_code text,
  ADD COLUMN IF NOT EXISTS trial_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS monthly_fee numeric(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS billing_day integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_contact text,
  ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":false,"auditoria":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS max_users integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS commercial_notes text;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_commercial_status_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_commercial_status_check CHECK (commercial_status IN ('active','trial','blocked_billing','suspended','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_plan_tier_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_tier_check CHECK (plan_tier IN ('basico','profissional','enterprise','consorcio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_monthly_fee_nonnegative_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_monthly_fee_nonnegative_check CHECK (monthly_fee >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_billing_day_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_billing_day_check CHECK (billing_day BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_max_users_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_max_users_check CHECK (max_users >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_trial_window_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_trial_window_check CHECK (commercial_status <> 'trial' OR (trial_starts_at IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_starts_at < trial_ends_at));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_enabled_modules_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_enabled_modules_check CHECK (
      jsonb_typeof(enabled_modules) = 'object'
      AND jsonb_typeof(enabled_modules->'fornecedores') = 'boolean'
      AND jsonb_typeof(enabled_modules->'documentos') = 'boolean'
      AND jsonb_typeof(enabled_modules->'processos') = 'boolean'
      AND jsonb_typeof(enabled_modules->'contratos') = 'boolean'
      AND jsonb_typeof(enabled_modules->'modelos') = 'boolean'
      AND jsonb_typeof(enabled_modules->'ged') = 'boolean'
      AND jsonb_typeof(enabled_modules->'auditoria') = 'boolean'
      AND (enabled_modules - ARRAY['fornecedores','documentos','processos','contratos','modelos','ged','auditoria']::text[]) = '{}'::jsonb
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_ibge_code_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_ibge_code_check CHECK (ibge_code IS NULL OR ibge_code ~ '^[0-9]{7}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_commercial_email_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_commercial_email_check CHECK (billing_email IS NULL OR (length(billing_email) <= 254 AND billing_email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'));
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_tenants_commercial_status_trial ON public.tenants (commercial_status, trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_tenants_plan_status ON public.tenants (plan_tier, commercial_status);

CREATE OR REPLACE FUNCTION app_auth.is_tenant_in_good_standing(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.status = 'active'
      AND (t.commercial_status = 'active'
        OR (t.commercial_status = 'trial' AND t.trial_starts_at <= pg_catalog.now() AND t.trial_ends_at > pg_catalog.now()))
  );
$function$;

CREATE OR REPLACE FUNCTION app_auth.is_tenant_module_enabled(p_tenant_id uuid, p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT t.enabled_modules -> p_module = 'true'::jsonb FROM public.tenants t WHERE t.id = p_tenant_id), false);
$function$;

REVOKE ALL ON FUNCTION app_auth.is_tenant_in_good_standing(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_auth.is_tenant_module_enabled(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_auth.is_tenant_in_good_standing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.is_tenant_module_enabled(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_protect_tenant_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A identidade e a data de criacao da organizacao sao imutaveis.';
  END IF;
  IF NOT app_auth.is_platform_admin() THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.status IS DISTINCT FROM OLD.status OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Somente a administracao global pode alterar slug, status ou autor de criacao da organizacao.';
    END IF;
    IF NEW.commercial_status IS DISTINCT FROM OLD.commercial_status
       OR NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
       OR NEW.trial_starts_at IS DISTINCT FROM OLD.trial_starts_at
       OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.monthly_fee IS DISTINCT FROM OLD.monthly_fee
       OR NEW.billing_day IS DISTINCT FROM OLD.billing_day
       OR NEW.billing_email IS DISTINCT FROM OLD.billing_email
       OR NEW.billing_contact IS DISTINCT FROM OLD.billing_contact
       OR NEW.enabled_modules IS DISTINCT FROM OLD.enabled_modules
       OR NEW.max_users IS DISTINCT FROM OLD.max_users
       OR NEW.commercial_notes IS DISTINCT FROM OLD.commercial_notes THEN
      RAISE EXCEPTION 'Somente a administracao global pode alterar dados comerciais, planos, modulos e cobranca.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_protect_tenant_fields() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_tenant_commercial_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_tenant_id uuid; v_module text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant_id := OLD.tenant_id; ELSE v_tenant_id := NEW.tenant_id; END IF;
  CASE TG_TABLE_NAME
    WHEN 'suppliers' THEN v_module := 'fornecedores';
    WHEN 'supplier_documents' THEN v_module := 'fornecedores';
    WHEN 'procurement_processes' THEN v_module := 'processos';
    WHEN 'process_items' THEN v_module := 'processos';
    WHEN 'contracts' THEN v_module := 'contratos';
    WHEN 'contract_amendments' THEN v_module := 'contratos';
    WHEN 'document_templates' THEN v_module := 'modelos';
    WHEN 'generated_documents' THEN v_module := 'documentos';
    ELSE RAISE EXCEPTION 'Tabela operacional sem modulo comercial mapeado: %', TG_TABLE_NAME;
  END CASE;
  IF NOT app_auth.is_tenant_in_good_standing(v_tenant_id) THEN
    RAISE EXCEPTION 'A Secretaria está sem acesso operacional: situação comercial inativa, suspensa ou período de demonstração encerrado.' USING ERRCODE = '42501';
  END IF;
  IF NOT app_auth.is_tenant_module_enabled(v_tenant_id, v_module) THEN
    RAISE EXCEPTION 'O módulo "%" não está contratado ou habilitado para esta Secretaria.', v_module USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_tenant_commercial_write() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_enforce_tenant_user_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_limit integer; v_active_count integer; v_should_count boolean := false; v_exclude_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_count := NEW.status = 'active';
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_count := NEW.status = 'active' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id);
    v_exclude_id := OLD.id;
  END IF;
  IF NOT v_should_count THEN RETURN NEW; END IF;
  SELECT t.max_users INTO v_limit FROM public.tenants t WHERE t.id = NEW.tenant_id FOR UPDATE;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'Secretaria não encontrada para aplicar o limite de usuários.'; END IF;
  SELECT count(*)::integer INTO v_active_count
  FROM public.tenant_memberships tm
  WHERE tm.tenant_id = NEW.tenant_id AND tm.status = 'active'
    AND (v_exclude_id IS NULL OR tm.id <> v_exclude_id);
  IF v_active_count >= v_limit THEN
    RAISE EXCEPTION 'Limite de usuários ativos atingido para esta Secretaria (%).', v_limit USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_enforce_tenant_user_limit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_tenant_user_limit ON public.tenant_memberships;
CREATE TRIGGER trg_enforce_tenant_user_limit BEFORE INSERT OR UPDATE OF status, tenant_id ON public.tenant_memberships FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_tenant_user_limit();

DO $commercial_triggers$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('suppliers','trg_commercial_guard_suppliers'),
    ('supplier_documents','trg_commercial_guard_supplier_documents'),
    ('procurement_processes','trg_commercial_guard_procurement_processes'),
    ('process_items','trg_commercial_guard_process_items'),
    ('contracts','trg_commercial_guard_contracts'),
    ('contract_amendments','trg_commercial_guard_contract_amendments'),
    ('document_templates','trg_commercial_guard_document_templates'),
    ('generated_documents','trg_commercial_guard_generated_documents')
  ) AS x(table_name,trigger_name)
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I',r.table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS %I ON public.%I',r.trigger_name,r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_guard_tenant_commercial_write()',
      r.trigger_name,r.table_name
    );
  END LOOP;
END
$commercial_triggers$;

DO $policies$
DECLARE r record; v_table text; v_module text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('suppliers','fornecedores'),('supplier_documents','fornecedores'),
    ('procurement_processes','processos'),('process_items','processos'),
    ('contracts','contratos'),('contract_amendments','contratos'),
    ('document_templates','modelos'),('generated_documents','documentos')
  ) AS x(table_name,module_name)
  LOOP
    v_table := r.table_name; v_module := r.module_name;
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I',v_table)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS p_master_support_read_%I ON public.%I',v_table,v_table);
    EXECUTE format('CREATE POLICY p_master_support_read_%I ON public.%I FOR SELECT TO authenticated USING ((SELECT app_auth.is_platform_admin()))',v_table,v_table);
    EXECUTE format('DROP POLICY IF EXISTS p_commercial_select_%I ON public.%I',v_table,v_table);
    EXECUTE format('CREATE POLICY p_commercial_select_%I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L))))',v_table,v_table,v_module);
    EXECUTE format('DROP POLICY IF EXISTS p_commercial_insert_%I ON public.%I',v_table,v_table);
    EXECUTE format('CREATE POLICY p_commercial_insert_%I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L)))',v_table,v_table,v_module);
    EXECUTE format('DROP POLICY IF EXISTS p_commercial_update_%I ON public.%I',v_table,v_table);
    EXECUTE format('CREATE POLICY p_commercial_update_%I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L))) WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L)))',v_table,v_table,v_module,v_module);
    EXECUTE format('DROP POLICY IF EXISTS p_commercial_delete_%I ON public.%I',v_table,v_table);
    EXECUTE format('CREATE POLICY p_commercial_delete_%I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id,%L)))',v_table,v_table,v_module);
  END LOOP;
END
$policies$;

CREATE OR REPLACE FUNCTION public.create_tenant_with_admin_commercial(p_name text,p_slug text,p_admin_user_id uuid,p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb; v_tenant_id uuid; v_status text; v_plan text; v_modules jsonb; v_trial_start timestamptz; v_trial_end timestamptz;
BEGIN
  IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Somente o superadministrador global pode cadastrar clientes.'; END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' THEN RAISE EXCEPTION 'Os dados institucionais e comerciais são obrigatórios.'; END IF;
  v_status := COALESCE(NULLIF(p_details->>'commercial_status',''),'active');
  v_plan := COALESCE(NULLIF(p_details->>'plan_tier',''),'profissional');
  v_trial_start := NULLIF(p_details->>'trial_starts_at','')::timestamptz;
  v_trial_end := NULLIF(p_details->>'trial_ends_at','')::timestamptz;
  v_modules := COALESCE(p_details->'enabled_modules','{"fornecedores":true,"documentos":true,"processos":true,"contratos":true,"modelos":true,"ged":false,"auditoria":true}'::jsonb);
  IF v_status NOT IN ('active','trial','blocked_billing','suspended','cancelled') THEN RAISE EXCEPTION 'Status comercial inválido.'; END IF;
  IF v_plan NOT IN ('basico','profissional','enterprise','consorcio') THEN RAISE EXCEPTION 'Plano comercial inválido.'; END IF;
  IF v_status = 'trial' AND (v_trial_start IS NULL OR v_trial_end IS NULL OR v_trial_start >= v_trial_end) THEN RAISE EXCEPTION 'Demonstração exige início e vencimento válidos.'; END IF;
  IF jsonb_typeof(v_modules) <> 'object' THEN RAISE EXCEPTION 'A configuração de módulos precisa ser um objeto JSON.'; END IF;
  v_result := public.create_tenant_with_admin(p_name,p_slug,p_admin_user_id);
  v_tenant_id := (v_result->>'tenant_id')::uuid;
  UPDATE public.tenants
  SET trade_name=NULLIF(pg_catalog.btrim(p_details->>'trade_name'),''),
      cnpj=CASE WHEN NULLIF(pg_catalog.btrim(p_details->>'cnpj'),'') IS NULL THEN NULL ELSE public.normalize_cnpj(p_details->>'cnpj') END,
      municipality=NULLIF(pg_catalog.btrim(p_details->>'municipality'),''),
      state=CASE WHEN NULLIF(pg_catalog.btrim(p_details->>'state'),'') IS NULL THEN NULL ELSE pg_catalog.upper(pg_catalog.btrim(p_details->>'state')) END,
      ibge_code=NULLIF(pg_catalog.btrim(p_details->>'ibge_code'),''),
      manager_name=NULLIF(pg_catalog.btrim(p_details->>'manager_name'),''),
      contact_email=NULLIF(pg_catalog.btrim(p_details->>'contact_email'),''),
      contact_phone=NULLIF(pg_catalog.btrim(p_details->>'contact_phone'),''),
      street=NULLIF(pg_catalog.btrim(p_details->>'street'),''),
      commercial_status=v_status, plan_tier=v_plan, trial_starts_at=v_trial_start, trial_ends_at=v_trial_end,
      monthly_fee=COALESCE(NULLIF(p_details->>'monthly_fee','')::numeric,0),
      billing_day=COALESCE(NULLIF(p_details->>'billing_day','')::integer,10),
      billing_email=NULLIF(pg_catalog.btrim(p_details->>'billing_email'),''),
      billing_contact=NULLIF(pg_catalog.btrim(p_details->>'billing_contact'),''),
      enabled_modules=v_modules, max_users=COALESCE(NULLIF(p_details->>'max_users','')::integer,20),
      commercial_notes=NULLIF(pg_catalog.btrim(p_details->>'commercial_notes'),'')
  WHERE id=v_tenant_id;
  RETURN v_result || pg_catalog.jsonb_build_object('commercial_status',v_status,'plan_tier',v_plan);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_tenant_with_admin_commercial(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_admin_commercial(text,text,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_master_metrics()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN RAISE EXCEPTION 'Acesso negado ao painel Master.' USING ERRCODE='42501'; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'mrr_estimated',(SELECT COALESCE(pg_catalog.sum(t.monthly_fee),0) FROM public.tenants t WHERE t.commercial_status='active' AND t.status='active'),
    'active_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='active' AND t.status='active'),
    'trial_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='trial'),
    'trials_expiring_7d',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='trial' AND t.trial_ends_at>pg_catalog.now() AND t.trial_ends_at<=pg_catalog.now()+interval '7 days'),
    'blocked_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='blocked_billing'),
    'suspended_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='suspended' OR t.status='suspended'),
    'cancelled_clients',(SELECT pg_catalog.count(*) FROM public.tenants t WHERE t.commercial_status='cancelled' OR t.status='closed'),
    'contracts_total',(SELECT pg_catalog.count(*) FROM public.contracts),
    'processes_total',(SELECT pg_catalog.count(*) FROM public.procurement_processes),
    'suppliers_total',(SELECT pg_catalog.count(*) FROM public.suppliers),
    'audit_events_total',(SELECT pg_catalog.count(*) FROM public.audit_events)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_platform_master_metrics() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_platform_master_metrics() TO authenticated;

CREATE OR REPLACE FUNCTION public.log_platform_admin_access_attempt(p_route text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Sessão autenticada obrigatória.' USING ERRCODE='42501'; END IF;
  IF app_auth.is_platform_admin() THEN RETURN; END IF;
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details)
  VALUES(NULL,(SELECT auth.uid()),'ACCESS_DENIED','platform_admin_route',
    pg_catalog.left(COALESCE(NULLIF(p_route,''),'/admin-master'),120),
    pg_catalog.jsonb_build_object('route',pg_catalog.left(COALESCE(p_route,'/admin-master'),120)));
END;
$function$;
REVOKE ALL ON FUNCTION public.log_platform_admin_access_attempt(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_platform_admin_access_attempt(text) TO authenticated;

COMMENT ON COLUMN public.tenants.commercial_status IS 'Status comercial controlado exclusivamente pelo painel Master.';
COMMENT ON COLUMN public.tenants.enabled_modules IS 'Feature flags comerciais aplicadas por RLS restritiva e gatilhos de escrita.';
COMMENT ON FUNCTION app_auth.is_tenant_in_good_standing(uuid) IS 'Retorna true somente para tenant institucional ativo e comercial ativo ou trial vigente.';
COMMENT ON FUNCTION public.get_platform_master_metrics() IS 'Métricas agregadas do SaaS, acessíveis somente a platform_admins ativos.';