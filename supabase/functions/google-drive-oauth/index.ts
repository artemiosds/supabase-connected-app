import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const OPENID_SCOPES = ["openid", "email", DRIVE_SCOPE];
const OAUTH_STATE_TTL_SECONDS = 600;
const MAX_BODY_BYTES = 10_000;

type JsonObject = Record<string, unknown>;

function noStoreHeaders(origin?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function jsonResponse(payload: JsonObject, status: number, origin: string): Response {
  const headers = noStoreHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers });
}

function redirectToApp(appUrl: string, result: "connected" | "error"): Response {
  const destination = new URL("/configuracoes", appUrl);
  destination.searchParams.set("drive", result);
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function normalizeRedirectUri(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Google OAuth redirect URI must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Google OAuth redirect URI has unsupported components.");
  }
  return url.toString();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

function createRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function readJsonResponse(response: Response): Promise<JsonObject> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("The Google service returned an unexpected response.");
  }
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The Google service returned an invalid response.");
  }
  return payload as JsonObject;
}

function requireString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`Google response did not include a valid ${field}.`);
  }
  return value.trim();
}

function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function verifyUser(
  supabaseUrl: string,
  anonKey: string,
  authorization: string | null,
): Promise<{ id: string; email: string }> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sessão autenticada obrigatória.");

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (
    error ||
    !data.user ||
    data.user.is_anonymous ||
    !data.user.email_confirmed_at ||
    !data.user.email
  ) {
    throw new Error("Sua sessão expirou ou o e-mail ainda não foi confirmado.");
  }
  return { id: data.user.id, email: data.user.email };
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Google authorization code exchange failed.");
  const payload = await readJsonResponse(response);
  return {
    accessToken: requireString(payload.access_token, "access token", 8192),
    refreshToken: requireString(payload.refresh_token, "refresh token", 8192),
  };
}

async function fetchGoogleIdentity(accessToken: string): Promise<{
  subject: string;
  email: string;
  emailVerified: boolean;
}> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Google identity verification failed.");
  const identity = await readJsonResponse(response);
  return {
    subject: requireString(identity.sub, "Google subject", 255),
    email: requireString(identity.email, "Google email", 254).toLowerCase(),
    emailVerified: identity.email_verified === true,
  };
}

async function createTenantDriveFolder(
  accessToken: string,
  folderName: string,
): Promise<string> {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("Google Drive folder creation failed.");
  const folder = await readJsonResponse(response);
  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Google Drive did not create a folder.");
  }
  return requireString(folder.id, "Drive folder id", 255);
}

async function revokeGoogleToken(token: string): Promise<void> {
  const body = new URLSearchParams({ token });
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Google token revocation failed.");
}

async function deleteDriveFolder(accessToken: string, folderId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function startAuthorization(
  request: Request,
  origin: string,
  supabaseUrl: string,
  anonKey: string,
  redirectUri: string,
): Promise<Response> {
  const user = await verifyUser(supabaseUrl, anonKey, request.headers.get("Authorization"));
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "O corpo da solicitação é inválido." }, 400, origin);
  }
  const tenantId = (body as Record<string, unknown>).tenant_id;
  if (
    typeof tenantId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
  ) {
    return jsonResponse({ error: "Secretaria inválida." }, 400, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
      },
    },
  });
  const { data: canManage, error: accessError } = await userClient.rpc("can_manage_tenant_drive", {
    p_tenant_id: tenantId,
  });
  if (accessError || canManage !== true) {
    return jsonResponse(
      { error: "Somente o administrador ativo desta Secretaria pode conectar o Google Drive." },
      403,
      origin,
    );
  }

  const state = createRandomHex(32);
  const stateHash = await sha256Hex(state);
  const codeVerifier = createCodeVerifier();
  const challenge = await pkceChallenge(codeVerifier);
  const { data: stateData, error: stateError } = await userClient.rpc(
    "create_tenant_drive_oauth_state",
    {
      p_tenant_id: tenantId,
      p_state_hash: stateHash,
      p_code_verifier: codeVerifier,
    },
  );
  if (stateError || !stateData?.[0]?.folder_name) {
    console.error("Could not create Drive OAuth state:", stateError?.message);
    return jsonResponse(
      { error: "Não foi possível iniciar a conexão do Google Drive para esta Secretaria." },
      400,
      origin,
    );
  }

  const clientId = getRequiredEnv("GOOGLE_DRIVE_CLIENT_ID");
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", OPENID_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return jsonResponse(
    {
      authorization_url: authorizationUrl.toString(),
      scope: DRIVE_SCOPE,
      message: "O Google solicitará acesso somente aos arquivos criados ou abertos pelo aplicativo.",
    },
    200,
    origin,
  );
}

async function disconnectDrive(
  request: Request,
  origin: string,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
): Promise<Response> {
  const user = await verifyUser(supabaseUrl, anonKey, request.headers.get("Authorization"));
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "O corpo da solicitação é inválido." }, 400, origin);
  }
  const tenantId = (body as Record<string, unknown>).tenant_id;
  if (
    typeof tenantId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
  ) {
    return jsonResponse({ error: "Secretaria inválida." }, 400, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } },
  });
  const { data: canManage, error: accessError } = await userClient.rpc("can_manage_tenant_drive", {
    p_tenant_id: tenantId,
  });
  if (accessError || canManage !== true) {
    return jsonResponse({ error: "Somente o administrador desta Secretaria pode desconectar o Drive." }, 403, origin);
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  const { data: refreshToken, error: tokenError } = await serviceClient.rpc(
    "get_tenant_drive_refresh_token",
    {
      p_tenant_id: tenantId,
      p_actor_id: user.id,
      p_permission_code: "org:edit",
    },
  );
  if (tokenError || typeof refreshToken !== "string" || !refreshToken) {
    return jsonResponse(
      { error: "Não foi possível confirmar a conexão do Google Drive desta Secretaria." },
      409,
      origin,
    );
  }

  try {
    await revokeGoogleToken(refreshToken);
  } catch {
    return jsonResponse(
      { error: "O Google não confirmou a revogação. A conexão foi mantida para permitir nova tentativa." },
      502,
      origin,
    );
  }

  const { data, error } = await serviceClient.rpc("disconnect_tenant_drive", {
    p_tenant_id: tenantId,
    p_actor_id: user.id,
  });
  if (error) {
    // The token is revoked at Google, but the local secret remains so an
    // administrator can inspect and repair the connection record safely.
    console.error("Google token revoked but local disconnect failed:", error.message);
    return jsonResponse(
      { error: "O Google revogou o acesso, mas o registro local precisa de revisão administrativa." },
      409,
      origin,
    );
  }
  return jsonResponse({ disconnected: true, result: data }, 200, origin);
}

async function handleOAuthCallback(
  request: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  appUrl: string,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const providerError = url.searchParams.get("error");

  if (!state || state.length > 256 || !code || code.length > 4096 || providerError) {
    return redirectToApp(appUrl, "error");
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  const stateHash = await sha256Hex(state);
  const { data: stateData, error: consumeError } = await serviceClient.rpc(
    "consume_tenant_drive_oauth_state",
    { p_state_hash: stateHash },
  );
  const oauthState = stateData?.[0];
  if (consumeError || !oauthState) {
    console.error("Google Drive callback state rejected:", consumeError?.message);
    return redirectToApp(appUrl, "error");
  }

  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let folderId: string | undefined;
  try {
    const tokens = await exchangeAuthorizationCode(
      code,
      oauthState.code_verifier,
      clientId,
      clientSecret,
      redirectUri,
    );
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;

    const identity = await fetchGoogleIdentity(accessToken);
    if (!identity.emailVerified) {
      throw new Error("Google account email is not verified.");
    }

    folderId = await createTenantDriveFolder(accessToken, oauthState.folder_name);
    const { error: saveError } = await serviceClient.rpc("save_tenant_drive_connection", {
      p_state_hash: stateHash,
      p_google_subject: identity.subject,
      p_google_email: identity.email,
      p_email_verified: identity.emailVerified,
      p_drive_folder_id: folderId,
      p_refresh_token: refreshToken,
    });
    if (saveError) throw new Error("Could not save tenant Drive connection.");

    return redirectToApp(appUrl, "connected");
  } catch (error) {
    console.error(
      "Google Drive OAuth callback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    if (accessToken && folderId) await deleteDriveFolder(accessToken, folderId);
    if (refreshToken) {
      await revokeGoogleToken(refreshToken).catch(() => undefined);
    }
    return redirectToApp(appUrl, "error");
  }
}

Deno.serve(async (request: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response("Serviço do Google Drive não configurado.", {
      status: 503,
      headers: noStoreHeaders(),
    });
  }

  const appUrl = getRequiredEnv("APP_URL");
  const redirectUri = normalizeRedirectUri(getRequiredEnv("GOOGLE_DRIVE_REDIRECT_URI"));
  if (request.method === "GET") {
    return await handleOAuthCallback(
      request,
      supabaseUrl,
      serviceRoleKey,
      getRequiredEnv("GOOGLE_DRIVE_CLIENT_ID"),
      getRequiredEnv("GOOGLE_DRIVE_CLIENT_SECRET"),
      redirectUri,
      appUrl,
    );
  }

  const originHeader = request.headers.get("Origin") ?? "";
  let origin = "";
  try {
    origin = new URL(originHeader).origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", { status: 403, headers: noStoreHeaders() });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: noStoreHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "A solicitação excede o tamanho permitido." }, 413, origin);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "O corpo da solicitação é inválido." }, 400, origin);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "O corpo da solicitação é inválido." }, 400, origin);
  }

  try {
    const action = (body as Record<string, unknown>).action;
    if (action === "start") {
      return await startAuthorization(request, origin, supabaseUrl, anonKey, redirectUri);
    }
    if (action === "disconnect") {
      return await disconnectDrive(request, origin, supabaseUrl, anonKey, serviceRoleKey);
    }
    return jsonResponse({ error: "Ação não reconhecida." }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return jsonResponse(
      {
        error: message.startsWith("Sessão") ? message : "Não foi possível processar a conexão do Google Drive.",
      },
      message.startsWith("Sessão") ? 401 : 400,
      origin,
    );
  }
});
