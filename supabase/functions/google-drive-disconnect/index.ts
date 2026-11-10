import { getAllowedOrigins } from "../_shared/origins.ts";
import { isUuid } from "../_shared/google-drive.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

function jsonResponse(payload: Record<string, unknown>, status: number, origin: string) {
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

Deno.serve(async (request: Request) => {
  const originHeader = request.headers.get("Origin") ?? "";
  let origin = "";
  try { origin = new URL(originHeader).origin; } catch { origin = ""; }
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
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Serviço de desconexão não configurado." }, 503, origin);
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);

  let body: { tenant_id?: unknown };
  try { body = await request.json(); } catch {
    return jsonResponse({ error: "Corpo JSON inválido." }, 400, origin);
  }
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  if (!isUuid(tenantId)) return jsonResponse({ error: "Secretaria inválida." }, 400, origin);

  const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (
    authError || !authData.user || authData.user.is_anonymous ||
    !authData.user.email_confirmed_at
  ) {
    return jsonResponse({ error: "Sessão expirada ou e-mail não confirmado." }, 401, origin);
  }

  const { data: capabilities, error: capabilityError } = await userClient.rpc(
    "get_tenant_settings_capabilities",
    { p_tenant_id: tenantId },
  );
  if (capabilityError || capabilities?.[0]?.can_edit !== true) {
    return jsonResponse({ error: "Somente o administrador municipal pode desconectar o Drive." }, 403, origin);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: connectionData, error: connectionError } = await admin.rpc(
    "get_tenant_google_drive_credentials",
    { p_tenant_id: tenantId },
  );
  if (connectionError) {
    console.error("Google Drive credential lookup failed:", connectionError.code);
    return jsonResponse({ error: "Não foi possível consultar a conexão Google Drive." }, 503, origin);
  }
  const connection = Array.isArray(connectionData) ? connectionData[0] : connectionData;
  if (!connection?.refresh_token) {
    return jsonResponse({ status: "disconnected", message: "O Google Drive já estava desconectado." }, 200, origin);
  }

  let revocation: Response;
  try {
    revocation = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: connection.refresh_token }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return jsonResponse(
      { error: "O Google não respondeu à solicitação de revogação. A conexão local foi mantida para uma nova tentativa." },
      502,
      origin,
    );
  }

  if (!revocation.ok) {
    let providerError = "";
    try {
      const payload = await revocation.json();
      providerError = typeof payload?.error === "string" ? payload.error : "";
    } catch {
      providerError = "";
    }
    // An already revoked token is safe to remove locally. Other errors keep
    // the connection metadata so the owner can retry rather than orphaning access.
    if (!(revocation.status === 400 && providerError === "invalid_token")) {
      return jsonResponse(
        { error: "O Google não confirmou a revogação. A conexão foi mantida para uma nova tentativa." },
        502,
        origin,
      );
    }
  }

  const { error: disconnectError } = await admin.rpc("disconnect_tenant_google_drive", {
    p_tenant_id: tenantId,
    p_actor_user_id: authData.user.id,
  });
  if (disconnectError) {
    console.error("Drive connection cleanup failed after provider revocation:", disconnectError.code);
    return jsonResponse(
      { error: "O acesso foi revogado no Google, mas a limpeza local não foi concluída. Solicite revisão ao suporte." },
      503,
      origin,
    );
  }

  return jsonResponse(
    { status: "disconnected", message: "A autorização foi revogada no Google e os tokens foram removidos do Vault." },
    200,
    origin,
  );
});
