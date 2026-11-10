-- Per-tenant Google Drive OAuth connection. Tokens are stored only in Supabase Vault.
-- This migration is code-only until separately reviewed and approved for deployment.

CREATE TABLE public.tenant_google_drive_connections (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  google_email text NOT NULL CHECK (length(google_email) BETWEEN 3 AND 254),
  google_subject text NOT NULL CHECK (length(google_subject) BETWEEN 1 AND 255),
  granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  root_folder_id text NOT NULL CHECK (length(root_folder_id) BETWEEN 1 AND 255),
  root_folder_name text NOT NULL CHECK (length(root_folder_name) BETWEEN 1 AND 180),
  access_token_secret_id uuid NOT NULL,
  refresh_token_secret_id uuid NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  connected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  connected_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.tenant_google_drive_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_tenant_google_drive_oauth_states_expiry
  ON public.tenant_google_drive_oauth_states(expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.tenant_google_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_google_drive_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_google_drive_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_google_drive_oauth_states FORCE ROW LEVEL SECURITY;

CREATE POLICY p_tenant_google_drive_connections_default_deny
  ON public.tenant_google_drive_connections
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY p_tenant_google_drive_oauth_states_default_deny
  ON public.tenant_google_drive_oauth_states
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.tenant_google_drive_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tenant_google_drive_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tenant_google_drive_connections TO service_role;
GRANT ALL ON TABLE public.tenant_google_drive_oauth_states TO service_role;

-- Callback authorization is rechecked after the user returns from Google. This prevents
-- a user whose tenant access was revoked during OAuth from completing the connection.
CREATE OR REPLACE FUNCTION public.is_tenant_google_drive_oauth_actor_authorized(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.tenants t
      WHERE t.id=p_tenant_id
        AND t.status='active'
        AND t.commercial_status IN ('active','trial')
        AND app_auth.is_tenant_in_good_standing(t.id)
        AND app_auth.is_tenant_module_enabled(t.id,'fornecedores')
        AND app_auth.is_tenant_module_enabled(t.id,'documentos')
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        JOIN public.membership_roles mr
          ON mr.membership_id=tm.id AND mr.tenant_id=tm.tenant_id
        JOIN public.tenant_role_permissions trp
          ON trp.role_id=mr.role_id
        JOIN public.permissions p
          ON p.id=trp.permission_id AND p.code='org:edit'
        WHERE tm.tenant_id=p_tenant_id
          AND tm.user_id=p_actor_user_id
          AND tm.status='active'
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.is_tenant_google_drive_oauth_actor_authorized(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_google_drive_oauth_actor_authorized(uuid,uuid)
  TO service_role;

-- Called only from trusted Edge Functions after OAuth state and actor validation.
CREATE OR REPLACE FUNCTION public.complete_tenant_google_drive_connection(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_google_email text,
  p_google_subject text,
  p_granted_scopes text[],
  p_root_folder_id text,
  p_root_folder_name text,
  p_access_token text,
  p_refresh_token text,
  p_access_token_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
  v_existing public.tenant_google_drive_connections%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required.' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_tenant_google_drive_oauth_actor_authorized(p_tenant_id,p_actor_user_id) THEN
    RAISE EXCEPTION 'The OAuth actor no longer has permission to connect Google Drive.' USING ERRCODE='42501';
  END IF;
  IF p_google_email IS NULL OR length(pg_catalog.btrim(p_google_email)) NOT BETWEEN 3 AND 254
     OR p_google_subject IS NULL OR length(pg_catalog.btrim(p_google_subject)) NOT BETWEEN 1 AND 255
     OR p_root_folder_id IS NULL OR length(pg_catalog.btrim(p_root_folder_id)) NOT BETWEEN 1 AND 255
     OR p_root_folder_name IS NULL OR length(pg_catalog.btrim(p_root_folder_name)) NOT BETWEEN 1 AND 180
     OR p_access_token IS NULL OR length(p_access_token)<20
     OR p_access_token_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Invalid Google Drive connection metadata.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.tenant_google_drive_connections
  WHERE tenant_id=p_tenant_id
  FOR UPDATE;

  IF v_existing.tenant_id IS NOT NULL THEN
    v_access_secret_id:=v_existing.access_token_secret_id;
    v_refresh_secret_id:=v_existing.refresh_token_secret_id;
    PERFORM vault.update_secret(
      v_access_secret_id,
      p_access_token,
      'gfs-drive-access-'||p_tenant_id::text,
      'Short-lived Google Drive access token for tenant '||p_tenant_id::text,
      NULL
    );
    IF p_refresh_token IS NOT NULL AND length(p_refresh_token)>=20 THEN
      PERFORM vault.update_secret(
        v_refresh_secret_id,
        p_refresh_token,
        'gfs-drive-refresh-'||p_tenant_id::text,
        'Google Drive refresh token for tenant '||p_tenant_id::text,
        NULL
      );
    ELSIF NOT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets s
      WHERE s.id=v_refresh_secret_id AND length(s.decrypted_secret)>=20
    ) THEN
      RAISE EXCEPTION 'Google did not return a refresh token for this connection.' USING ERRCODE='22023';
    END IF;
  ELSE
    IF p_refresh_token IS NULL OR length(p_refresh_token)<20 THEN
      RAISE EXCEPTION 'Google did not return a refresh token for this first connection.' USING ERRCODE='22023';
    END IF;
    SELECT vault.create_secret(
      p_access_token,
      'gfs-drive-access-'||p_tenant_id::text,
      'Short-lived Google Drive access token for tenant '||p_tenant_id::text,
      NULL
    ) INTO v_access_secret_id;
    SELECT vault.create_secret(
      p_refresh_token,
      'gfs-drive-refresh-'||p_tenant_id::text,
      'Google Drive refresh token for tenant '||p_tenant_id::text,
      NULL
    ) INTO v_refresh_secret_id;
  END IF;

  INSERT INTO public.tenant_google_drive_connections(
    tenant_id,google_email,google_subject,granted_scopes,
    root_folder_id,root_folder_name,access_token_secret_id,
    refresh_token_secret_id,access_token_expires_at,connected_by,connected_at,updated_at
  )
  VALUES(
    p_tenant_id,pg_catalog.lower(pg_catalog.btrim(p_google_email)),
    pg_catalog.btrim(p_google_subject),COALESCE(p_granted_scopes,ARRAY[]::text[]),
    pg_catalog.btrim(p_root_folder_id),pg_catalog.btrim(p_root_folder_name),
    v_access_secret_id,v_refresh_secret_id,p_access_token_expires_at,
    p_actor_user_id,pg_catalog.now(),pg_catalog.now()
  )
  ON CONFLICT(tenant_id) DO UPDATE SET
    google_email=EXCLUDED.google_email,
    google_subject=EXCLUDED.google_subject,
    granted_scopes=EXCLUDED.granted_scopes,
    root_folder_id=EXCLUDED.root_folder_id,
    root_folder_name=EXCLUDED.root_folder_name,
    access_token_secret_id=EXCLUDED.access_token_secret_id,
    refresh_token_secret_id=EXCLUDED.refresh_token_secret_id,
    access_token_expires_at=EXCLUDED.access_token_expires_at,
    connected_by=EXCLUDED.connected_by,
    connected_at=pg_catalog.now(),
    updated_at=pg_catalog.now();

  INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
  VALUES(
    p_actor_user_id,p_tenant_id,'tenant.google_drive.connected',
    'tenant_google_drive_connections',p_tenant_id::text,
    pg_catalog.jsonb_build_object(
      'google_email',pg_catalog.lower(pg_catalog.btrim(p_google_email)),
      'scopes',COALESCE(p_granted_scopes,ARRAY[]::text[])
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_tenant_google_drive_connection(
  uuid,uuid,text,text,text[],text,text,text,text,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_tenant_google_drive_connection(
  uuid,uuid,text,text,text[],text,text,text,text,timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_google_drive_credentials(p_tenant_id uuid)
RETURNS TABLE(
  tenant_id uuid,
  google_email text,
  google_subject text,
  root_folder_id text,
  root_folder_name text,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT
    c.tenant_id,c.google_email,c.google_subject,c.root_folder_id,c.root_folder_name,
    a.decrypted_secret,r.decrypted_secret,c.access_token_expires_at
  FROM public.tenant_google_drive_connections c
  JOIN vault.decrypted_secrets a ON a.id=c.access_token_secret_id
  JOIN vault.decrypted_secrets r ON r.id=c.refresh_token_secret_id
  WHERE c.tenant_id=p_tenant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_google_drive_credentials(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_google_drive_credentials(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_tenant_google_drive_access_token(
  p_tenant_id uuid,
  p_access_token text,
  p_access_token_expires_at timestamptz,
  p_refresh_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_connection public.tenant_google_drive_connections%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required.' USING ERRCODE='42501';
  END IF;
  IF p_access_token IS NULL OR length(p_access_token)<20
     OR p_access_token_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Invalid Google Drive access token.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_connection
  FROM public.tenant_google_drive_connections
  WHERE tenant_id=p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM vault.update_secret(
    v_connection.access_token_secret_id,
    p_access_token,
    'gfs-drive-access-'||p_tenant_id::text,
    'Short-lived Google Drive access token for tenant '||p_tenant_id::text,
    NULL
  );
  IF p_refresh_token IS NOT NULL AND length(p_refresh_token)>=20 THEN
    PERFORM vault.update_secret(
      v_connection.refresh_token_secret_id,
      p_refresh_token,
      'gfs-drive-refresh-'||p_tenant_id::text,
      'Google Drive refresh token for tenant '||p_tenant_id::text,
      NULL
    );
  END IF;
  UPDATE public.tenant_google_drive_connections
  SET access_token_expires_at=p_access_token_expires_at,updated_at=pg_catalog.now()
  WHERE tenant_id=p_tenant_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_tenant_google_drive_access_token(uuid,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_google_drive_access_token(uuid,text,timestamptz,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_google_drive_status(p_tenant_id uuid)
RETURNS TABLE(
  is_connected boolean,
  google_email text,
  root_folder_name text,
  connected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
  IF NOT (
    app_auth.has_tenant_permission(p_tenant_id,'org:view')
    OR app_auth.has_tenant_permission(p_tenant_id,'org:edit')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para consultar integrações desta Secretaria.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT true,c.google_email,c.root_folder_name,c.connected_at
  FROM public.tenant_google_drive_connections c
  WHERE c.tenant_id=p_tenant_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,NULL::text,NULL::text,NULL::timestamptz;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_google_drive_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_google_drive_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.disconnect_tenant_google_drive(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_connection public.tenant_google_drive_connections%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required.' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_tenant_google_drive_oauth_actor_authorized(p_tenant_id,p_actor_user_id) THEN
    RAISE EXCEPTION 'The tenant administrator no longer has permission to disconnect Google Drive.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.tenant_google_drive_connections
  WHERE tenant_id=p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM vault.secrets
  WHERE id IN (
    v_connection.access_token_secret_id,
    v_connection.refresh_token_secret_id
  );
  DELETE FROM public.tenant_google_drive_connections
  WHERE tenant_id=p_tenant_id;

  INSERT INTO public.audit_events(actor_id,tenant_id,action,entity,entity_id,details)
  VALUES(
    p_actor_user_id,p_tenant_id,'tenant.google_drive.disconnected',
    'tenant_google_drive_connections',p_tenant_id::text,
    pg_catalog.jsonb_build_object('google_email',v_connection.google_email)
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.disconnect_tenant_google_drive(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_tenant_google_drive(uuid,uuid) TO service_role;

COMMENT ON TABLE public.tenant_google_drive_connections IS
  'Per-tenant Google Drive connection metadata. OAuth tokens are encrypted in Supabase Vault and never returned to client roles.';
COMMENT ON TABLE public.tenant_google_drive_oauth_states IS
  'Short-lived, single-use hashes for Google Drive OAuth state validation. Raw OAuth state is never stored.';
