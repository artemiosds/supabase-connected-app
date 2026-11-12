BEGIN;

-- A Google Drive connection is owned by one tenant and is never exposed
-- through direct table access. The refresh token lives only in Supabase Vault.
CREATE TABLE public.tenant_drive_connections (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  google_subject text NOT NULL CHECK (length(google_subject) BETWEEN 1 AND 255),
  google_email text NOT NULL CHECK (
    length(google_email) <= 254
    AND google_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  drive_folder_id text NOT NULL CHECK (length(drive_folder_id) BETWEEN 1 AND 255),
  drive_folder_name text NOT NULL CHECK (length(drive_folder_name) BETWEEN 1 AND 255),
  vault_secret_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error')),
  connected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  connected_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

COMMENT ON TABLE public.tenant_drive_connections IS
  'One Google Drive OAuth connection per tenant. OAuth refresh credentials are stored only in Supabase Vault.';
COMMENT ON COLUMN public.tenant_drive_connections.vault_secret_id IS
  'Reference to the encrypted refresh-token bundle in Supabase Vault. Never expose this identifier or decrypted value to browser clients.';

CREATE TABLE public.tenant_drive_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  folder_name text NOT NULL CHECK (length(folder_name) BETWEEN 1 AND 255),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX idx_tenant_drive_oauth_states_expiry
  ON public.tenant_drive_oauth_states (expires_at);

ALTER TABLE public.tenant_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_drive_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_drive_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_drive_oauth_states FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_drive_connections
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tenant_drive_oauth_states
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_drive_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_drive_oauth_states TO service_role;

-- Only the tenant administrator (org:edit) can connect or disconnect a
-- Google account. The tenant must be active, paid/in good standing and have
-- both GED and supplier-document modules enabled.
CREATE OR REPLACE FUNCTION public.can_manage_tenant_drive(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND app_auth.has_tenant_data_permission(p_tenant_id, 'org:edit')
    AND app_auth.is_tenant_in_good_standing(p_tenant_id)
    AND app_auth.is_tenant_module_enabled(p_tenant_id, 'ged')
    AND app_auth.is_tenant_module_enabled(p_tenant_id, 'fornecedores');
$function$;

REVOKE ALL ON FUNCTION public.can_manage_tenant_drive(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_tenant_drive(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_drive_connection_status(p_tenant_id uuid)
RETURNS TABLE (
  can_manage boolean,
  is_connected boolean,
  connection_status text,
  google_email text,
  drive_folder_name text,
  connected_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    public.can_manage_tenant_drive(p_tenant_id),
    c.tenant_id IS NOT NULL AND c.status = 'connected',
    c.status,
    c.google_email,
    c.drive_folder_name,
    c.connected_at
  FROM (SELECT (SELECT auth.uid()) AS user_id) actor
  LEFT JOIN public.tenant_drive_connections c ON c.tenant_id = p_tenant_id
  WHERE actor.user_id IS NOT NULL
    AND app_auth.has_tenant_data_permission(p_tenant_id, 'documents:view')
    AND app_auth.is_tenant_in_good_standing(p_tenant_id)
    AND app_auth.is_tenant_module_enabled(p_tenant_id, 'ged')
    AND app_auth.is_tenant_module_enabled(p_tenant_id, 'fornecedores');
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_drive_connection_status(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_drive_connection_status(uuid)
  TO authenticated, service_role;

-- The browser submits only a SHA-256 state hash and a PKCE verifier. Raw state
-- stays in the authorization URL; the callback consumes it once, within 10 min.
CREATE OR REPLACE FUNCTION public.create_tenant_drive_oauth_state(
  p_tenant_id uuid,
  p_state_hash text,
  p_code_verifier text
)
RETURNS TABLE (folder_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_name text;
  v_folder_name text;
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR NOT public.can_manage_tenant_drive(p_tenant_id) THEN
    RAISE EXCEPTION 'Somente o administrador da Secretaria pode conectar o Google Drive.'
      USING ERRCODE = '42501';
  END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$'
     OR p_code_verifier IS NULL OR length(p_code_verifier) NOT BETWEEN 43 AND 128 THEN
    RAISE EXCEPTION 'Parâmetros OAuth inválidos.';
  END IF;

  SELECT t.name INTO v_tenant_name
  FROM public.tenants t
  WHERE t.id = p_tenant_id AND t.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secretaria não encontrada ou inativa.';
  END IF;

  v_folder_name := left('Gestão de Fornecedores - ' || btrim(v_tenant_name), 255);

  DELETE FROM public.tenant_drive_oauth_states
  WHERE tenant_id = p_tenant_id
    AND user_id = v_user_id
    AND (expires_at <= pg_catalog.now() OR consumed_at IS NOT NULL);

  INSERT INTO public.tenant_drive_oauth_states (
    state_hash, tenant_id, user_id, code_verifier, folder_name, expires_at
  )
  VALUES (
    p_state_hash, p_tenant_id, v_user_id, p_code_verifier,
    v_folder_name, pg_catalog.now() + interval '10 minutes'
  );

  RETURN QUERY SELECT v_folder_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_tenant_drive_oauth_state(uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_drive_oauth_state(uuid,text,text)
  TO authenticated;

-- Service-role-only callback exchange. The conditional UPDATE makes state
-- consumption atomic and prevents callback replay.
CREATE OR REPLACE FUNCTION public.consume_tenant_drive_oauth_state(p_state_hash text)
RETURNS TABLE (
  tenant_id uuid,
  user_id uuid,
  code_verifier text,
  folder_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operação interna não autorizada.' USING ERRCODE = '42501';
  END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.tenant_drive_oauth_states s
  SET consumed_at = pg_catalog.now()
  WHERE s.state_hash = p_state_hash
    AND s.consumed_at IS NULL
    AND s.expires_at > pg_catalog.now()
  RETURNING s.tenant_id, s.user_id, s.code_verifier, s.folder_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_tenant_drive_oauth_state(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_tenant_drive_oauth_state(text)
  TO service_role;

-- Persist the refresh token in Vault only after the callback was consumed and
-- the tenant administrator still has the required permission.
CREATE OR REPLACE FUNCTION public.save_tenant_drive_connection(
  p_state_hash text,
  p_google_subject text,
  p_google_email text,
  p_email_verified boolean,
  p_drive_folder_id text,
  p_refresh_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.tenant_drive_oauth_states%ROWTYPE;
  v_old_secret uuid;
  v_secret_id uuid;
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_google_email, '')));
  v_folder_id text := pg_catalog.btrim(coalesce(p_drive_folder_id, ''));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operação interna não autorizada.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_state
  FROM public.tenant_drive_oauth_states s
  WHERE s.state_hash = p_state_hash
    AND s.consumed_at IS NOT NULL
    AND s.expires_at > pg_catalog.now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O estado OAuth expirou, não existe ou já foi utilizado.'
      USING ERRCODE = '42501';
  END IF;

  IF p_google_subject IS NULL OR length(btrim(p_google_subject)) NOT BETWEEN 1 AND 255
     OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     OR p_email_verified IS DISTINCT FROM true
     OR v_folder_id = '' OR length(v_folder_id) > 255
     OR p_refresh_token IS NULL OR length(btrim(p_refresh_token)) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'A resposta do Google não contém uma identidade verificada e credenciais válidas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.membership_roles mr
      ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
    JOIN public.tenant_roles tr
      ON tr.id = mr.role_id AND tr.tenant_id = mr.tenant_id
    JOIN public.tenant_role_permissions rp ON rp.role_id = tr.id
    JOIN public.permissions p ON p.id = rp.permission_id
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = v_state.tenant_id
      AND tm.user_id = v_state.user_id
      AND tm.status = 'active'
      AND t.status = 'active'
      AND p.code = 'org:edit'
      AND app_auth.is_tenant_in_good_standing(t.id)
      AND app_auth.is_tenant_module_enabled(t.id, 'ged')
      AND app_auth.is_tenant_module_enabled(t.id, 'fornecedores')
  ) THEN
    RAISE EXCEPTION 'O administrador perdeu a permissão ou a Secretaria não está habilitada.'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.vault_secret_id INTO v_old_secret
  FROM public.tenant_drive_connections c
  WHERE c.tenant_id = v_state.tenant_id
  FOR UPDATE;

  IF v_old_secret IS NULL THEN
    v_secret_id := vault.create_secret(
      pg_catalog.jsonb_build_object('refresh_token', p_refresh_token)::text,
      'gfs_tenant_google_drive_' || v_state.tenant_id::text,
      'Google Drive refresh token for tenant ' || v_state.tenant_id::text,
      NULL
    );
  ELSE
    PERFORM vault.update_secret(
      v_old_secret,
      pg_catalog.jsonb_build_object('refresh_token', p_refresh_token)::text,
      'gfs_tenant_google_drive_' || v_state.tenant_id::text,
      'Google Drive refresh token for tenant ' || v_state.tenant_id::text,
      NULL
    );
    v_secret_id := v_old_secret;
  END IF;

  INSERT INTO public.tenant_drive_connections (
    tenant_id, google_subject, google_email, drive_folder_id, drive_folder_name,
    vault_secret_id, status, connected_by, connected_at, updated_at
  )
  VALUES (
    v_state.tenant_id, p_google_subject, v_email, v_folder_id, v_state.folder_name,
    v_secret_id, 'connected', v_state.user_id, pg_catalog.now(), pg_catalog.now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    google_subject = EXCLUDED.google_subject,
    google_email = EXCLUDED.google_email,
    drive_folder_id = EXCLUDED.drive_folder_id,
    drive_folder_name = EXCLUDED.drive_folder_name,
    vault_secret_id = EXCLUDED.vault_secret_id,
    status = 'connected',
    connected_by = EXCLUDED.connected_by,
    connected_at = pg_catalog.now(),
    updated_at = pg_catalog.now();

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  )
  VALUES (
    v_state.tenant_id, v_state.user_id, 'tenant.google_drive_connected',
    'tenant_drive_connections', v_state.tenant_id::text,
    pg_catalog.jsonb_build_object(
      'google_email', v_email,
      'folder_name', v_state.folder_name,
      'scope', 'drive.file',
      'refresh_token_stored_in_vault', true
    ),
    pg_catalog.now()
  );

  DELETE FROM public.tenant_drive_oauth_states
  WHERE state_hash = p_state_hash;

  RETURN pg_catalog.jsonb_build_object(
    'connected', true,
    'tenant_id', v_state.tenant_id,
    'google_email', v_email,
    'folder_name', v_state.folder_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_tenant_drive_connection(text,text,text,boolean,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_tenant_drive_connection(text,text,text,boolean,text,text)
  TO service_role;

-- A service-role caller can fetch a refresh token only for an active tenant
-- member with the requested document permission. Tokens never enter RPCs
-- callable by the browser.
CREATE OR REPLACE FUNCTION public.get_tenant_drive_refresh_token(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_permission_code text DEFAULT 'documents:view'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret_id uuid;
  v_token text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operação interna não autorizada.' USING ERRCODE = '42501';
  END IF;
  IF p_permission_code NOT IN ('documents:view', 'documents:create', 'org:edit') THEN
    RAISE EXCEPTION 'Permissão de acesso ao Drive inválida.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.membership_roles mr
      ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
    JOIN public.tenant_roles tr
      ON tr.id = mr.role_id AND tr.tenant_id = mr.tenant_id
    JOIN public.tenant_role_permissions rp ON rp.role_id = tr.id
    JOIN public.permissions p ON p.id = rp.permission_id
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = p_actor_id
      AND tm.status = 'active'
      AND t.status = 'active'
      AND p.code = p_permission_code
      AND app_auth.is_tenant_in_good_standing(t.id)
      AND app_auth.is_tenant_module_enabled(t.id, 'ged')
      AND app_auth.is_tenant_module_enabled(t.id, 'fornecedores')
  ) THEN
    RAISE EXCEPTION 'Esta conta não tem permissão para acessar o Google Drive desta Secretaria.'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.vault_secret_id INTO v_secret_id
  FROM public.tenant_drive_connections c
  WHERE c.tenant_id = p_tenant_id AND c.status = 'connected';
  IF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'O Google Drive não está conectado para esta Secretaria.';
  END IF;

  SELECT ds.decrypted_secret::jsonb->>'refresh_token'
  INTO v_token
  FROM vault.decrypted_secrets ds
  WHERE ds.id = v_secret_id;
  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'A credencial do Google Drive não está disponível no Vault.';
  END IF;

  RETURN v_token;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_drive_refresh_token(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_drive_refresh_token(uuid,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.disconnect_tenant_drive(
  p_tenant_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operação interna não autorizada.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.membership_roles mr
      ON mr.membership_id = tm.id AND mr.tenant_id = tm.tenant_id
    JOIN public.tenant_roles tr
      ON tr.id = mr.role_id AND tr.tenant_id = mr.tenant_id
    JOIN public.tenant_role_permissions rp ON rp.role_id = tr.id
    JOIN public.permissions p ON p.id = rp.permission_id
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = p_actor_id
      AND tm.status = 'active'
      AND t.status = 'active'
      AND p.code = 'org:edit'
      AND app_auth.is_tenant_in_good_standing(t.id)
      AND app_auth.is_tenant_module_enabled(t.id, 'ged')
      AND app_auth.is_tenant_module_enabled(t.id, 'fornecedores')
  ) THEN
    RAISE EXCEPTION 'Somente o administrador ativo desta Secretaria pode desconectar o Drive.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.supplier_documents d
    WHERE d.tenant_id = p_tenant_id
      AND d.storage_provider = 'google_drive'
      AND d.drive_file_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Existem documentos vinculados ao Google Drive. Migre ou preserve esses arquivos antes de desconectar a conta.';
  END IF;

  SELECT c.vault_secret_id INTO v_secret_id
  FROM public.tenant_drive_connections c
  WHERE c.tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_secret_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('disconnected', true, 'already_disconnected', true);
  END IF;

  DELETE FROM vault.secrets WHERE id = v_secret_id;
  DELETE FROM public.tenant_drive_connections WHERE tenant_id = p_tenant_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  )
  VALUES (
    p_tenant_id, p_actor_id, 'tenant.google_drive_disconnected',
    'tenant_drive_connections', p_tenant_id::text,
    pg_catalog.jsonb_build_object('vault_secret_deleted', true),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object('disconnected', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.disconnect_tenant_drive(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_tenant_drive(uuid,uuid)
  TO service_role;

COMMIT;
