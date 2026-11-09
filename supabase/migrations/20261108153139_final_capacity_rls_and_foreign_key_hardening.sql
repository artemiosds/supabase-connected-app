BEGIN;

CREATE INDEX IF NOT EXISTS idx_document_template_versions_created_by ON public.document_template_versions (created_by);
CREATE INDEX IF NOT EXISTS idx_document_template_versions_template_tenant ON public.document_template_versions (template_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_catalog_template_id ON public.document_templates (catalog_template_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_process_tenant ON public.generated_documents (process_id, tenant_id) WHERE process_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_procurement_budget_allocations_created_by ON public.procurement_budget_allocations (created_by);
CREATE INDEX IF NOT EXISTS idx_procurement_budget_allocations_updated_by ON public.procurement_budget_allocations (updated_by);
CREATE INDEX IF NOT EXISTS idx_procurement_items_created_by ON public.procurement_items (created_by);
CREATE INDEX IF NOT EXISTS idx_procurement_items_updated_by ON public.procurement_items (updated_by);
CREATE INDEX IF NOT EXISTS idx_procurement_price_quotes_created_by ON public.procurement_price_quotes (created_by);
CREATE INDEX IF NOT EXISTS idx_procurement_price_quotes_updated_by ON public.procurement_price_quotes (updated_by);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_accepted_by ON public.tenant_invitations (accepted_by) WHERE accepted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_invited_by ON public.tenant_invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_invited_user_id ON public.tenant_invitations (invited_user_id) WHERE invited_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_revoked_by ON public.tenant_invitations (revoked_by) WHERE revoked_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_role_tenant ON public.tenant_invitations (role_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_pending_expiry ON public.tenant_invitations (tenant_id, expires_at) WHERE status = 'pending';

DROP POLICY IF EXISTS p_master_support_read_contract_amendments ON public.contract_amendments;
DROP POLICY IF EXISTS p_amend_select ON public.contract_amendments;
CREATE POLICY p_amend_select ON public.contract_amendments FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_contracts ON public.contracts;
DROP POLICY IF EXISTS p_contracts_select ON public.contracts;
CREATE POLICY p_contracts_select ON public.contracts FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_document_templates ON public.document_templates;
DROP POLICY IF EXISTS p_document_templates_select ON public.document_templates;
CREATE POLICY p_document_templates_select ON public.document_templates FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_generated_documents ON public.generated_documents;
DROP POLICY IF EXISTS p_generated_documents_select ON public.generated_documents;
CREATE POLICY p_generated_documents_select ON public.generated_documents FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_process_items ON public.process_items;
DROP POLICY IF EXISTS p_items_select ON public.process_items;
CREATE POLICY p_items_select ON public.process_items FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_procurement_budget_allocations_master_read ON public.procurement_budget_allocations;
DROP POLICY IF EXISTS p_procurement_budget_allocations_select ON public.procurement_budget_allocations;
CREATE POLICY p_procurement_budget_allocations_select ON public.procurement_budget_allocations FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_procurement_items_master_read ON public.procurement_items;
DROP POLICY IF EXISTS p_procurement_items_select ON public.procurement_items;
CREATE POLICY p_procurement_items_select ON public.procurement_items FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_procurement_price_quotes_master_read ON public.procurement_price_quotes;
DROP POLICY IF EXISTS p_procurement_price_quotes_select ON public.procurement_price_quotes;
CREATE POLICY p_procurement_price_quotes_select ON public.procurement_price_quotes FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_procurement_processes ON public.procurement_processes;
DROP POLICY IF EXISTS p_processes_select ON public.procurement_processes;
CREATE POLICY p_processes_select ON public.procurement_processes FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_supplier_documents ON public.supplier_documents;
DROP POLICY IF EXISTS p_supplier_documents_select ON public.supplier_documents;
CREATE POLICY p_supplier_documents_select ON public.supplier_documents FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_master_support_read_suppliers ON public.suppliers;
DROP POLICY IF EXISTS p_suppliers_select ON public.suppliers;
CREATE POLICY p_suppliers_select ON public.suppliers FOR SELECT TO authenticated
USING ((SELECT app_auth.has_supplier_permission(tenant_id, 'suppliers:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_tenants_master_support_select ON public.tenants;
DROP POLICY IF EXISTS p_tenants_select ON public.tenants;
CREATE POLICY p_tenants_select ON public.tenants FOR SELECT TO authenticated
USING ((SELECT app_auth.has_tenant_permission(id, 'org:view')) OR (SELECT app_auth.is_platform_admin()));

DROP POLICY IF EXISTS p_tenants_master_commercial_update ON public.tenants;
DROP POLICY IF EXISTS p_tenants_update ON public.tenants;
CREATE POLICY p_tenants_update ON public.tenants FOR UPDATE TO authenticated
USING ((SELECT app_auth.has_tenant_permission(id, 'org:edit')) OR (SELECT app_auth.is_platform_admin()))
WITH CHECK ((SELECT app_auth.has_tenant_permission(id, 'org:edit')) OR (SELECT app_auth.is_platform_admin()));

CREATE OR REPLACE FUNCTION public.fn_enforce_tenant_user_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_limit integer;
  v_active_count integer := 0;
  v_pending_count integer := 0;
  v_should_count boolean := false;
  v_exclude_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_count := NEW.status = 'active';
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_count :=
      NEW.status = 'active'
      AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id);
    v_exclude_id := OLD.id;
  END IF;

  IF NOT v_should_count THEN
    RETURN NEW;
  END IF;

  SELECT t.max_users
    INTO v_limit
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id
  FOR UPDATE;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Secretaria não encontrada para aplicar o limite de usuários.';
  END IF;

  SELECT count(*)::integer
    INTO v_active_count
  FROM public.tenant_memberships tm
  WHERE tm.tenant_id = NEW.tenant_id
    AND tm.status = 'active'
    AND (v_exclude_id IS NULL OR tm.id <> v_exclude_id);

  SELECT count(*)::integer
    INTO v_pending_count
  FROM public.tenant_invitations i
  WHERE i.tenant_id = NEW.tenant_id
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();

  IF v_active_count + v_pending_count >= v_limit THEN
    RAISE EXCEPTION
      'Limite de usuários atingido para esta Secretaria: usuários ativos e convites pendentes já reservam todas as vagas do plano (%).',
      v_limit
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_tenant_user_limit_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_active_count integer := 0;
  v_pending_count integer := 0;
BEGIN
  IF NEW.max_users IS NOT DISTINCT FROM OLD.max_users THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO v_active_count
  FROM public.tenant_memberships m
  WHERE m.tenant_id = OLD.id
    AND m.status = 'active';

  SELECT count(*)::integer INTO v_pending_count
  FROM public.tenant_invitations i
  WHERE i.tenant_id = OLD.id
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();

  IF NEW.max_users < v_active_count + v_pending_count THEN
    RAISE EXCEPTION
      'O limite não pode ser reduzido para %, pois há % usuários ativos e % convites pendentes reservados.',
      NEW.max_users, v_active_count, v_pending_count
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_guard_tenant_user_limit_update() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_tenant_user_limit_update ON public.tenants;
CREATE TRIGGER trg_guard_tenant_user_limit_update BEFORE UPDATE OF max_users ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_tenant_user_limit_update();

CREATE OR REPLACE FUNCTION app_auth.create_tenant_invitation(p_tenant_id uuid, p_email text, p_role_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_email text := lower(pg_catalog.btrim(p_email));
  v_id uuid;
  v_limit integer;
  v_active_count integer := 0;
  v_pending_count integer := 0;
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

  SELECT t.max_users
    INTO v_limit
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Secretaria não encontrada para aplicar o limite de usuários.';
  END IF;

  UPDATE public.tenant_invitations i
  SET status = 'expired'
  WHERE i.tenant_id = p_tenant_id
    AND i.status = 'pending'
    AND i.expires_at <= pg_catalog.now();

  SELECT count(*)::integer INTO v_active_count
  FROM public.tenant_memberships m
  WHERE m.tenant_id = p_tenant_id
    AND m.status = 'active';

  SELECT count(*)::integer INTO v_pending_count
  FROM public.tenant_invitations i
  WHERE i.tenant_id = p_tenant_id
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();

  IF v_active_count + v_pending_count >= v_limit THEN
    RAISE EXCEPTION
      'Limite de usuários atingido: usuários ativos e convites pendentes já reservam todas as vagas do plano.';
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

CREATE OR REPLACE FUNCTION app_auth.accept_my_tenant_invitations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_email text;
  v_confirmed_at timestamptz;
  v_is_anonymous boolean;
  v_candidate record;
  v_tenant record;
  v_locked_invitation public.tenant_invitations%ROWTYPE;
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

  -- Expire this user's invitations while obeying the same tenant -> invitation lock order.
  FOR v_tenant IN
    SELECT DISTINCT i.tenant_id
    FROM public.tenant_invitations i
    WHERE i.invited_email = v_email
      AND i.status = 'pending'
      AND i.expires_at <= pg_catalog.now()
      AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id)
    ORDER BY i.tenant_id
  LOOP
    PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant.tenant_id FOR UPDATE;

    UPDATE public.tenant_invitations i
    SET status = 'expired'
    WHERE i.tenant_id = v_tenant.tenant_id
      AND i.invited_email = v_email
      AND i.status = 'pending'
      AND i.expires_at <= pg_catalog.now()
      AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = v_user_id AND pa.is_active
  ) THEN
    FOR v_tenant IN
      SELECT DISTINCT i.tenant_id
      FROM public.tenant_invitations i
      WHERE i.invited_email = v_email
        AND i.status = 'pending'
        AND i.expires_at > pg_catalog.now()
        AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id)
      ORDER BY i.tenant_id
    LOOP
      PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant.tenant_id FOR UPDATE;

      UPDATE public.tenant_invitations i
      SET status = 'revoked',
          revoked_at = pg_catalog.now(),
          revoked_by = i.invited_by
      WHERE i.tenant_id = v_tenant.tenant_id
        AND i.invited_email = v_email
        AND i.status = 'pending'
        AND i.expires_at > pg_catalog.now()
        AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id);
    END LOOP;
    RETURN 0;
  END IF;

  FOR v_candidate IN
    SELECT i.id, i.tenant_id
    FROM public.tenant_invitations i
    WHERE i.invited_email = v_email
      AND i.status = 'pending'
      AND i.expires_at > pg_catalog.now()
      AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id)
    ORDER BY i.tenant_id, i.created_at, i.id
  LOOP
    PERFORM 1
    FROM public.tenants t
    WHERE t.id = v_candidate.tenant_id
    FOR UPDATE;

    SELECT i.*
      INTO v_locked_invitation
    FROM public.tenant_invitations i
    WHERE i.id = v_candidate.id
      AND i.tenant_id = v_candidate.tenant_id
      AND i.invited_email = v_email
      AND i.status = 'pending'
      AND i.expires_at > pg_catalog.now()
      AND (i.invited_user_id IS NULL OR i.invited_user_id = v_user_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF NOT app_auth.is_tenant_in_good_standing(v_locked_invitation.tenant_id) THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_roles r
      WHERE r.id = v_locked_invitation.role_id
        AND r.tenant_id = v_locked_invitation.tenant_id
    ) THEN
      UPDATE public.tenant_invitations
      SET status = 'revoked',
          revoked_at = pg_catalog.now(),
          revoked_by = invited_by
      WHERE id = v_locked_invitation.id;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.tenant_id = v_locked_invitation.tenant_id
        AND m.user_id = v_user_id
    ) THEN
      UPDATE public.tenant_invitations
      SET status = 'already_member'
      WHERE id = v_locked_invitation.id;
      CONTINUE;
    END IF;

    -- Release the invitation reservation before the membership trigger counts reserved seats.
    UPDATE public.tenant_invitations
    SET status = 'accepted',
        accepted_at = pg_catalog.now(),
        accepted_by = v_user_id
    WHERE id = v_locked_invitation.id;

    INSERT INTO public.tenant_memberships (tenant_id, user_id, status)
    VALUES (v_locked_invitation.tenant_id, v_user_id, 'active')
    RETURNING id INTO v_membership_id;

    INSERT INTO public.membership_roles (membership_id, role_id, tenant_id)
    VALUES (
      v_membership_id,
      v_locked_invitation.role_id,
      v_locked_invitation.tenant_id
    );

    v_accepted := v_accepted + 1;
  END LOOP;

  RETURN v_accepted;
END;
$function$;

COMMENT ON FUNCTION app_auth.create_tenant_invitation(uuid,text,uuid) IS
'Creates a tenant invitation under a tenant row lock, reserving a seat and preventing concurrent overbooking.';
COMMENT ON FUNCTION app_auth.accept_my_tenant_invitations() IS
'Accepts invitations after email confirmation with deterministic tenant-before-invitation row locking.';
COMMENT ON FUNCTION public.fn_enforce_tenant_user_limit() IS
'Enforces max_users against active memberships plus non-expired pending invitations under a tenant row lock.';

COMMIT;
