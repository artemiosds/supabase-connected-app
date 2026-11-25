-- =============================================================================
-- Frente 6 (Painel Master): Ativação Real do Gateway (Mercado Pago / Stripe),
-- Geração de Links de Pagamento e Baixa Automática por Webhook
-- =============================================================================

-- 1. Liberar payments_enabled real na configuração de cobrança
ALTER TABLE public.platform_payment_integrations
  DROP CONSTRAINT IF EXISTS platform_payment_processing_off_check;

COMMENT ON TABLE public.platform_payment_integrations IS
  'Global payment-provider account configuration. Private credentials are stored only in Supabase Vault and accessed exclusively via service_role Edge Functions.';
COMMENT ON COLUMN public.platform_payment_integrations.payments_enabled IS
  'Controls whether live checkout link generation and webhook processing are active for the configured gateway.';

-- Atualizar platform_billing_save_credentials para preservar payments_enabled quando mesmo provedor/ambiente
CREATE OR REPLACE FUNCTION public.platform_billing_save_credentials(
  p_actor_id uuid,
  p_provider text,
  p_provider_other_name text,
  p_environment text,
  p_account_name text,
  p_account_reference text,
  p_account_email text,
  p_client_id text,
  p_public_key text,
  p_secret_bundle jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.platform_payment_integrations%ROWTYPE;
  v_secret_id uuid;
  v_description text;
  v_has_private_credential boolean := false;
  v_keep_enabled boolean := false;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active = true
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar a conta de cobrança.'
      USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('mercado_pago', 'stripe', 'other') OR p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Provedor ou ambiente de cobrança inválido.';
  END IF;
  IF p_account_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_account_name)) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Informe o nome da conta (2 a 160 caracteres).';
  END IF;
  IF p_provider = 'other' AND (p_provider_other_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_provider_other_name)) NOT BETWEEN 2 AND 100) THEN
    RAISE EXCEPTION 'Informe o nome do provedor selecionado como Outro.';
  END IF;
  IF p_provider <> 'other' AND p_provider_other_name IS NOT NULL THEN
    RAISE EXCEPTION 'Nome adicional de provedor não se aplica a esta opção.';
  END IF;
  IF p_account_email IS NOT NULL AND (pg_catalog.length(p_account_email) > 254 OR p_account_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'E-mail da conta de cobrança inválido.';
  END IF;
  IF p_account_reference IS NOT NULL AND pg_catalog.length(p_account_reference) > 160 THEN
    RAISE EXCEPTION 'Identificador da conta excede o limite permitido.';
  END IF;
  IF p_client_id IS NOT NULL AND pg_catalog.length(p_client_id) > 512 THEN
    RAISE EXCEPTION 'Client ID excede o limite permitido.';
  END IF;
  IF p_public_key IS NOT NULL AND pg_catalog.length(p_public_key) > 1024 THEN
    RAISE EXCEPTION 'Chave pública excede o limite permitido.';
  END IF;
  IF p_secret_bundle IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_secret_bundle) <> 'object' OR pg_catalog.length(p_secret_bundle::text) > 12000 THEN
      RAISE EXCEPTION 'As credenciais privadas devem ser um objeto JSON válido, até 12 KB.';
    END IF;
    v_has_private_credential :=
      pg_catalog.length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'access_token', ''))) > 0
      OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'secret_key', ''))) > 0
      OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'client_secret', ''))) > 0
      OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'webhook_secret', ''))) > 0;
    IF NOT v_has_private_credential THEN
      RAISE EXCEPTION 'Informe ao menos um token privado ou chave secreta.';
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.platform_payment_integrations i WHERE i.id = 1 FOR UPDATE;
  v_secret_id := v_existing.vault_secret_id;
  IF p_secret_bundle IS NULL AND v_secret_id IS NOT NULL AND
    (v_existing.provider IS DISTINCT FROM p_provider OR v_existing.environment IS DISTINCT FROM p_environment)
  THEN
    RAISE EXCEPTION 'Ao trocar o provedor ou ambiente, informe novamente as credenciais privadas.';
  END IF;

  v_keep_enabled := COALESCE(v_existing.payments_enabled, false)
    AND v_existing.provider = p_provider
    AND v_existing.environment = p_environment;

  v_description := pg_catalog.format(
    'Platform billing credentials for provider %s in %s environment.',
    p_provider,
    p_environment
  );
  IF p_secret_bundle IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      v_secret_id := vault.create_secret(p_secret_bundle::text, 'gfs_platform_billing_credentials', v_description, NULL);
    ELSE
      PERFORM vault.update_secret(v_secret_id, p_secret_bundle::text, 'gfs_platform_billing_credentials', v_description, NULL);
    END IF;
  ELSIF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'Cadastre as credenciais privadas antes de salvar a conta.';
  END IF;

  INSERT INTO public.platform_payment_integrations (
    id, provider, provider_other_name, environment, account_name, account_reference,
    account_email, client_id, public_key, vault_secret_id, status, payments_enabled,
    created_by, updated_by, created_at, updated_at
  ) VALUES (
    1, p_provider, NULLIF(pg_catalog.btrim(p_provider_other_name), ''), p_environment,
    pg_catalog.btrim(p_account_name), NULLIF(pg_catalog.btrim(p_account_reference), ''),
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_account_email)), ''),
    NULLIF(pg_catalog.btrim(p_client_id), ''), NULLIF(pg_catalog.btrim(p_public_key), ''),
    v_secret_id, 'credentials_saved', false, p_actor_id, p_actor_id, pg_catalog.now(), pg_catalog.now()
  )
  ON CONFLICT (id) DO UPDATE SET
    provider = EXCLUDED.provider,
    provider_other_name = EXCLUDED.provider_other_name,
    environment = EXCLUDED.environment,
    account_name = EXCLUDED.account_name,
    account_reference = EXCLUDED.account_reference,
    account_email = EXCLUDED.account_email,
    client_id = EXCLUDED.client_id,
    public_key = EXCLUDED.public_key,
    vault_secret_id = EXCLUDED.vault_secret_id,
    status = 'credentials_saved',
    payments_enabled = v_keep_enabled,
    updated_by = p_actor_id,
    updated_at = pg_catalog.now();

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    NULL, p_actor_id, 'PLATFORM_BILLING_CREDENTIALS_SAVED', 'platform_payment_integrations', '1',
    pg_catalog.jsonb_build_object(
      'provider', p_provider,
      'environment', p_environment,
      'account_name', pg_catalog.btrim(p_account_name),
      'secret_updated', p_secret_bundle IS NOT NULL,
      'payments_enabled', v_keep_enabled
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'saved', true,
    'provider', p_provider,
    'environment', p_environment,
    'status', 'credentials_saved',
    'payments_enabled', v_keep_enabled
  );
END;
$function$;

-- 2. Ativar ou desativar processamento de cobrança pelo gateway
CREATE OR REPLACE FUNCTION public.platform_billing_set_payments_enabled(
  p_actor_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.platform_payment_integrations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active = true
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode ativar ou pausar o gateway.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.platform_payment_integrations WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cadastre uma conta de cobrança antes de ativar o processamento.';
  END IF;

  IF COALESCE(p_enabled, false) THEN
    IF v_row.status <> 'credentials_saved' OR v_row.vault_secret_id IS NULL THEN
      RAISE EXCEPTION 'Salve as credenciais do provedor antes de ativar o gateway.';
    END IF;
    IF v_row.provider = 'other' THEN
      RAISE EXCEPTION 'Checkout automático disponível nativamente para Mercado Pago e Stripe.';
    END IF;
  END IF;

  UPDATE public.platform_payment_integrations
  SET
    payments_enabled = COALESCE(p_enabled, false),
    updated_by = p_actor_id,
    updated_at = pg_catalog.now()
  WHERE id = 1;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    NULL, p_actor_id, 'PLATFORM_BILLING_PAYMENTS_TOGGLED', 'platform_payment_integrations', '1',
    pg_catalog.jsonb_build_object('provider', v_row.provider, 'payments_enabled', COALESCE(p_enabled, false)),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object('payments_enabled', COALESCE(p_enabled, false));
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_set_payments_enabled(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_billing_set_payments_enabled(uuid, boolean)
  TO service_role;

-- 3. Leitura segura das credenciais descriptografadas exclusivamente por Edge Functions (service_role)
CREATE OR REPLACE FUNCTION public.platform_billing_get_credentials()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.platform_payment_integrations%ROWTYPE;
  v_secret text;
BEGIN
  SELECT * INTO v_row FROM public.platform_payment_integrations WHERE id = 1;
  IF NOT FOUND OR v_row.vault_secret_id IS NULL OR v_row.status <> 'credentials_saved' THEN
    RETURN NULL;
  END IF;

  SELECT ds.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.id = v_row.vault_secret_id;

  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'provider', v_row.provider,
    'environment', v_row.environment,
    'payments_enabled', v_row.payments_enabled,
    'credentials', v_secret::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_get_credentials()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_billing_get_credentials()
  TO service_role;

-- 4. Vincular link de pagamento gerado pelo gateway a uma fatura
CREATE OR REPLACE FUNCTION public.platform_billing_attach_payment_link(
  p_actor_id uuid,
  p_invoice_id uuid,
  p_payment_url text,
  p_external_reference text
)
RETURNS public.platform_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.platform_invoices;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_actor_id AND pa.is_active = true
  ) THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode vincular links de cobrança.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.platform_invoices
  SET
    payment_url = pg_catalog.btrim(p_payment_url),
    external_reference = COALESCE(NULLIF(pg_catalog.btrim(p_external_reference), ''), external_reference),
    payment_method = 'gateway',
    updated_by = p_actor_id,
    updated_at = pg_catalog.now()
  WHERE id = p_invoice_id
    AND status IN ('pending', 'overdue')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Fatura elegível não encontrada para gerar cobrança.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    v_row.tenant_id, p_actor_id, 'PLATFORM_INVOICE_GATEWAY_LINK_CREATED', 'platform_invoices', v_row.id::text,
    pg_catalog.jsonb_build_object('external_reference', v_row.external_reference),
    pg_catalog.now()
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_attach_payment_link(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_billing_attach_payment_link(uuid, uuid, text, text)
  TO service_role;

-- Permitir que chamadas autenticadas via service_role (como webhook de pagamento) reativem clientes
CREATE OR REPLACE FUNCTION public.fn_protect_tenant_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_jwt_role text := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    (pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A identidade e a data de criacao da organizacao sao imutaveis.';
  END IF;
  IF NOT app_auth.is_platform_admin() AND v_jwt_role IS DISTINCT FROM 'service_role' THEN
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

-- 5. Confirmar pagamento recebido via webhook (idempotente e com reativação automática)
CREATE OR REPLACE FUNCTION public.platform_billing_confirm_webhook_payment(
  p_external_reference text,
  p_invoice_id uuid DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_event_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inv public.platform_invoices;
  v_tenant_status text;
  v_other_overdue boolean;
  v_reactivated boolean := false;
BEGIN
  SELECT * INTO v_inv
  FROM public.platform_invoices inv
  WHERE (p_invoice_id IS NOT NULL AND inv.id = p_invoice_id)
     OR (p_external_reference IS NOT NULL AND inv.external_reference = p_external_reference)
  ORDER BY inv.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('matched', false);
  END IF;

  IF v_inv.status = 'paid' THEN
    RETURN pg_catalog.jsonb_build_object('matched', true, 'already_paid', true, 'invoice_id', v_inv.id);
  END IF;

  IF v_inv.status = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object('matched', true, 'cancelled', true, 'invoice_id', v_inv.id);
  END IF;

  UPDATE public.platform_invoices
  SET
    status = 'paid',
    paid_at = pg_catalog.now(),
    payment_method = 'gateway',
    external_reference = COALESCE(NULLIF(pg_catalog.btrim(p_external_reference), ''), external_reference),
    updated_at = pg_catalog.now()
  WHERE id = v_inv.id;

  SELECT t.commercial_status INTO v_tenant_status
  FROM public.tenants t
  WHERE t.id = v_inv.tenant_id;

  IF v_tenant_status = 'blocked_billing' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.platform_invoices other_inv
      WHERE other_inv.tenant_id = v_inv.tenant_id
        AND other_inv.id <> v_inv.id
        AND other_inv.status = 'overdue'
    ) INTO v_other_overdue;

    IF NOT v_other_overdue THEN
      UPDATE public.tenants
      SET commercial_status = 'active', status = 'active'
      WHERE id = v_inv.tenant_id;
      v_reactivated := true;
    END IF;
  END IF;

  INSERT INTO public.audit_events (tenant_id, actor_id, action, entity, entity_id, details, created_at)
  VALUES (
    v_inv.tenant_id,
    NULL,
    'PLATFORM_INVOICE_WEBHOOK_PAID',
    'platform_invoices',
    v_inv.id::text,
    pg_catalog.jsonb_build_object(
      'provider', p_provider,
      'event_id', p_event_id,
      'external_reference', p_external_reference,
      'amount', v_inv.amount,
      'reactivated_tenant', v_reactivated
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'matched', true,
    'already_paid', false,
    'invoice_id', v_inv.id,
    'tenant_id', v_inv.tenant_id,
    'reactivated_tenant', v_reactivated
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_confirm_webhook_payment(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_billing_confirm_webhook_payment(text, uuid, text, text)
  TO service_role;
