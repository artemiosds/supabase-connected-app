import { getAllowedOrigins } from "../_shared/origins.ts";
import { isUuid, GOOGLE_DRIVE_SCOPES, sha256Hex } from "../_shared/google-drive.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

function response(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const originHeader = request.headers.get("Origin") ?? "";
  let origin = "";
  try {
    origin = new URL(originHeader).origin;
  } catch {
    origin = "";
  }

  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origin não autorizado.", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      },
    });
  }
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const redirectUri = Deno.env.get("GOOGLE_DRIVE_REDIRECT_URI");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clientId || !redirectUri) {
    return response(
      { error: "Integração Google Drive ainda não configurada no servidor." },
      503,
      origin,
    );
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return response({ error: "Sessão autenticada obrigatória." }, 401, origin);

  let body: { tenant_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return response({ error: "O corpo da solicitação não é JSON válido." }, 400, origin);
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
  if (!isUuid(tenantId)) return response({ error: "Secretaria inválida." }, 400, origin);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (
    authError ||
    !authData.user ||
    authData.user.is_anonymous ||
    !authData.user.email_confirmed_at
  ) {
    return response({ error: "Sua sessão expirou ou o e-mail não foi confirmado." }, 401, origin);
  }

  const { data: capabilities, error: capabilityError } = await userClient.rpc(
    "get_tenant_settings_capabilities",
    { p_tenant_id: tenantId },
  );
  if (capabilityError || capabilities?.[0]?.can_edit !== true) {
    return response(
      { error: "Somente o administrador municipal com permissão de editar a Secretaria pode conectar o Drive." },
      403,
      origin,
    );
  }

  let callback: URL;
  try {
    callback = new URL(redirectUri);
    if (callback.protocol !== "https:" || callback.username || callback.password) {
      throw new Error("Invalid redirect URI");
    }
  } catch {
    return response({ error: "A URL de retorno OAuth do Google não está configurada corretamente." }, 503, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const rawState = randomState();
  const stateHash = await sha256Hex(rawState);

  const { error: cleanupError } = await admin
    .from("tenant_google_drive_oauth_states")
    .delete()
    .lt("expires_at", now.toISOString());
  if (cleanupError) {
    console.error("Failed to remove expired Google Drive OAuth states.");
    return response({ error: "Não foi possível iniciar a conexão com o Drive." }, 503, origin);
  }

  const { error: insertError } = await admin.from("tenant_google_drive_oauth_states").insert({
    state_hash: stateHash,
    tenant_id: tenantId,
    actor_user_id: authData.user.id,
    expires_at: expiresAt.toISOString(),
  });
  if (insertError) {
    console.error("Failed to persist Google Drive OAuth state:", insertError.code);
    return response({ error: "Não foi possível iniciar a conexão com o Drive." }, 503, origin);
  }

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callback.toString());
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("state", rawState);

  return response(
    {
      authorize_url: authorizationUrl.toString(),
      expires_at: expiresAt.toISOString(),
      message: "A autorização é válida por dez minutos e pode ser usada uma única vez.",
    },
    200,
    origin,
  );
});
