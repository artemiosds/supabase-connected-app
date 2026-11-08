BEGIN;
CREATE TABLE public.platform_payment_integrations (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider text NOT NULL CHECK (provider IN ('mercado_pago', 'stripe', 'other')),
  provider_other_name text,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  account_name text NOT NULL CHECK (length(btrim(account_name)) BETWEEN 2 AND 160),
  account_reference text,
  account_email text,
  client_id text,
  public_key text,
  vault_secret_id uuid,
  status text NOT NULL DEFAULT 'credentials_saved' CHECK (status IN ('credentials_saved', 'disabled')),
  payments_enabled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT platform_payment_provider_name_check CHECK (
    (provider='other' AND provider_other_name IS NOT NULL AND length(btrim(provider_other_name)) BETWEEN 2 AND 100)
    OR (provider<>'other' AND provider_other_name IS NULL)
  ),
  CONSTRAINT platform_payment_account_email_check CHECK (
    account_email IS NULL OR (length(account_email)<=254 AND account_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  ),
  CONSTRAINT platform_payment_processing_off_check CHECK (payments_enabled=false)
);
COMMENT ON TABLE public.platform_payment_integrations IS
  'Global payment-provider account configuration. Private credentials are stored only in Supabase Vault; processing stays disabled until a future provider integration release.';
COMMENT ON COLUMN public.platform_payment_integrations.vault_secret_id IS
  'Reference to an encrypted JSON credential bundle in Supabase Vault. Never return the decrypted value through the Data API or browser.';
COMMENT ON COLUMN public.platform_payment_integrations.payments_enabled IS
  'Forced off in this configuration-only release. A future payment integration migration must explicitly remove this guard.';
ALTER TABLE public.platform_payment_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_payment_integrations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_payment_integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_payment_integrations TO service_role;

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

CREATE OR REPLACE FUNCTION public.platform_billing_disconnect(p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_existing public.platform_payment_integrations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_actor_id AND pa.is_active=true
  ) THEN RAISE EXCEPTION 'Somente o Administrador Master ativo pode desconectar a conta de cobrança.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_existing FROM public.platform_payment_integrations i WHERE i.id=1 FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('disconnected',true); END IF;
  IF v_existing.vault_secret_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=v_existing.vault_secret_id; END IF;
  UPDATE public.platform_payment_integrations SET vault_secret_id=NULL,status='disabled',
    payments_enabled=false,client_id=NULL,public_key=NULL,updated_by=p_actor_id,updated_at=pg_catalog.now()
  WHERE id=1;
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(NULL,p_actor_id,'PLATFORM_BILLING_ACCOUNT_DISCONNECTED','platform_payment_integrations','1',
    pg_catalog.jsonb_build_object('provider',v_existing.provider,'environment',v_existing.environment,
      'secret_deleted',v_existing.vault_secret_id IS NOT NULL,'payments_enabled',false),pg_catalog.now());
  RETURN pg_catalog.jsonb_build_object('disconnected',true,'payments_enabled',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_save_credentials(uuid,text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_billing_save_credentials(uuid,text,text,text,text,text,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.platform_billing_disconnect(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_billing_disconnect(uuid) TO service_role;
COMMIT;