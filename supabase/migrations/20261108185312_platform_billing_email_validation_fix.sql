BEGIN;
ALTER TABLE public.platform_payment_integrations
  DROP CONSTRAINT IF EXISTS platform_payment_account_email_check;
ALTER TABLE public.platform_payment_integrations
  ADD CONSTRAINT platform_payment_account_email_check
  CHECK (
    account_email IS NULL OR (
      length(account_email) <= 254
      AND account_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

CREATE OR REPLACE FUNCTION public.platform_billing_save_credentials(
  p_actor_id uuid,p_provider text,p_provider_other_name text,p_environment text,
  p_account_name text,p_account_reference text,p_account_email text,
  p_client_id text,p_public_key text,p_secret_bundle jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_existing public.platform_payment_integrations%ROWTYPE;
  v_secret_id uuid;
  v_description text;
  v_has_private_credential boolean := false;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_actor_id AND pa.is_active=true
  ) THEN RAISE EXCEPTION 'Somente o Administrador Master ativo pode configurar a conta de cobrança.' USING ERRCODE='42501'; END IF;
  IF p_provider NOT IN ('mercado_pago','stripe','other') OR p_environment NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'Provedor ou ambiente de cobrança inválido.'; END IF;
  IF p_account_name IS NULL OR length(btrim(p_account_name)) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Informe o nome da conta (2 a 160 caracteres).'; END IF;
  IF p_provider='other' AND (p_provider_other_name IS NULL OR length(btrim(p_provider_other_name)) NOT BETWEEN 2 AND 100) THEN RAISE EXCEPTION 'Informe o nome do provedor selecionado como Outro.'; END IF;
  IF p_provider<>'other' AND p_provider_other_name IS NOT NULL THEN RAISE EXCEPTION 'Nome adicional de provedor não se aplica a esta opção.'; END IF;
  IF p_account_email IS NOT NULL AND (length(p_account_email)>254 OR p_account_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'E-mail da conta de cobrança inválido.'; END IF;
  IF p_account_reference IS NOT NULL AND length(p_account_reference)>160 THEN RAISE EXCEPTION 'Identificador da conta excede o limite permitido.'; END IF;
  IF p_client_id IS NOT NULL AND length(p_client_id)>512 THEN RAISE EXCEPTION 'Client ID excede o limite permitido.'; END IF;
  IF p_public_key IS NOT NULL AND length(p_public_key)>1024 THEN RAISE EXCEPTION 'Chave pública excede o limite permitido.'; END IF;
  IF p_secret_bundle IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_secret_bundle)<>'object' OR pg_catalog.length(p_secret_bundle::text)>12000 THEN RAISE EXCEPTION 'As credenciais privadas devem ser um objeto JSON válido, até 12 KB.'; END IF;
    v_has_private_credential :=
      length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'access_token','')))>0
      OR length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'secret_key','')))>0
      OR length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'client_secret','')))>0
      OR length(pg_catalog.btrim(COALESCE(p_secret_bundle->>'webhook_secret','')))>0;
    IF NOT v_has_private_credential THEN RAISE EXCEPTION 'Informe ao menos um token privado ou chave secreta.'; END IF;
  END IF;
  SELECT * INTO v_existing FROM public.platform_payment_integrations i WHERE i.id=1 FOR UPDATE;
  v_secret_id:=v_existing.vault_secret_id;
  IF p_secret_bundle IS NULL AND v_secret_id IS NOT NULL AND
    (v_existing.provider IS DISTINCT FROM p_provider OR v_existing.environment IS DISTINCT FROM p_environment)
  THEN RAISE EXCEPTION 'Ao trocar o provedor ou ambiente, informe novamente as credenciais privadas.'; END IF;
  v_description:=pg_catalog.format('Platform billing credentials for provider %s in %s environment.',p_provider,p_environment);
  IF p_secret_bundle IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      v_secret_id:=vault.create_secret(p_secret_bundle::text,'gfs_platform_billing_credentials',v_description,NULL);
    ELSE
      PERFORM vault.update_secret(v_secret_id,p_secret_bundle::text,'gfs_platform_billing_credentials',v_description,NULL);
    END IF;
  ELSIF v_secret_id IS NULL THEN RAISE EXCEPTION 'Cadastre as credenciais privadas antes de salvar a conta.'; END IF;
  INSERT INTO public.platform_payment_integrations (
    id,provider,provider_other_name,environment,account_name,account_reference,
    account_email,client_id,public_key,vault_secret_id,status,payments_enabled,
    created_by,updated_by,created_at,updated_at
  ) VALUES (
    1,p_provider,NULLIF(pg_catalog.btrim(p_provider_other_name),''),p_environment,
    pg_catalog.btrim(p_account_name),NULLIF(pg_catalog.btrim(p_account_reference),''),
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_account_email)),''),
    NULLIF(pg_catalog.btrim(p_client_id),''),NULLIF(pg_catalog.btrim(p_public_key),''),
    v_secret_id,'credentials_saved',false,p_actor_id,p_actor_id,pg_catalog.now(),pg_catalog.now()
  )
  ON CONFLICT(id) DO UPDATE SET
    provider=EXCLUDED.provider,provider_other_name=EXCLUDED.provider_other_name,
    environment=EXCLUDED.environment,account_name=EXCLUDED.account_name,
    account_reference=EXCLUDED.account_reference,account_email=EXCLUDED.account_email,
    client_id=EXCLUDED.client_id,public_key=EXCLUDED.public_key,
    vault_secret_id=EXCLUDED.vault_secret_id,status='credentials_saved',
    payments_enabled=false,updated_by=p_actor_id,updated_at=pg_catalog.now();
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(NULL,p_actor_id,'PLATFORM_BILLING_CREDENTIALS_SAVED','platform_payment_integrations','1',
    pg_catalog.jsonb_build_object('provider',p_provider,'environment',p_environment,
      'account_name',pg_catalog.btrim(p_account_name),'secret_updated',p_secret_bundle IS NOT NULL,
      'payments_enabled',false),pg_catalog.now());
  RETURN pg_catalog.jsonb_build_object('saved',true,'provider',p_provider,'environment',p_environment,
    'status','credentials_saved','payments_enabled',false);
END;
$function$;

CREATE POLICY platform_payment_integrations_service_role_only
  ON public.platform_payment_integrations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
COMMIT;