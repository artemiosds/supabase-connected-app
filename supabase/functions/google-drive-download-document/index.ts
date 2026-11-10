import { getAllowedOrigins } from "../_shared/origins.ts";
import { sanitizeDriveFileName, isUuid } from "../_shared/google-drive.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
]);

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

async function getDriveAccessToken(admin: ReturnType<typeof createClient>, tenantId: string) {
  const { data, error } = await admin.rpc("get_tenant_google_drive_credentials", {
    p_tenant_id: tenantId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.refresh_token) return null;
  const expiresAt = Date.parse(row.access_token_expires_at);
  if (row.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 90_000) {
    return row.access_token as string;
  }

  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token || !Number.isInteger(tokens.expires_in)) return null;
    const { error: saveError } = await admin.rpc("update_tenant_google_drive_access_token", {
      p_tenant_id: tenantId,
      p_access_token: tokens.access_token,
      p_access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      p_refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    });
    return saveError ? null : tokens.access_token as string;
  } catch {
    return null;
  }
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
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Serviço não configurado." }, 503, origin);

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);
  const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user || authData.user.is_anonymous || !authData.user.email_confirmed_at) {
    return jsonResponse({ error: "Sessão expirada ou não confirmada." }, 401, origin);
  }

  let body: { document_id?: unknown };
  try { body = await request.json(); } catch {
    return jsonResponse({ error: "Corpo JSON inválido." }, 400, origin);
  }
  const documentId = typeof body.document_id === "string" ? body.document_id : "";
  if (!isUuid(documentId)) return jsonResponse({ error: "Documento inválido." }, 400, origin);

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: document, error: documentError } = await admin
    .from("supplier_documents")
    .select("id,tenant_id,supplier_id,title,status,storage_provider,drive_file_id")
    .eq("id", documentId)
    .eq("status", "active")
    .maybeSingle();
  if (documentError || !document || document.storage_provider !== "google_drive" || !document.drive_file_id) {
    return jsonResponse({ error: "Arquivo não disponível." }, 404, origin);
  }

  const { data: capabilities, error: capabilityError } = await userClient.rpc(
    "get_document_capabilities",
    { p_tenant_id: document.tenant_id },
  );
  if (capabilityError || capabilities?.[0]?.can_view !== true) {
    return jsonResponse({ error: "Você não tem permissão para consultar este documento." }, 403, origin);
  }

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("status,commercial_status,enabled_modules")
    .eq("id", document.tenant_id)
    .maybeSingle();
  const modules = tenant?.enabled_modules as Record<string, unknown> | null;
  if (
    tenantError || !tenant || tenant.status !== "active" ||
    !["active", "trial"].includes(tenant.commercial_status) ||
    modules?.fornecedores !== true || modules?.documentos !== true
  ) {
    return jsonResponse({ error: "O acesso a documentos desta Secretaria está suspenso." }, 403, origin);
  }

  const accessToken = await getDriveAccessToken(admin, document.tenant_id);
  if (!accessToken) {
    return jsonResponse({ error: "A conexão com Google Drive expirou. O administrador da Secretaria precisa reconectar." }, 409, origin);
  }

  let fileMetadata: { name?: string; mimeType?: string };
  try {
    const metadataResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(document.drive_file_id) + "?fields=name,mimeType&supportsAllDrives=true",
      {
        headers: { Authorization: "Bearer " + accessToken },
        signal: AbortSignal.timeout(15000),
      },
    );
    fileMetadata = await metadataResponse.json();
    if (!metadataResponse.ok || !fileMetadata.name || !fileMetadata.mimeType) {
      return jsonResponse({ error: "O arquivo não está mais disponível no Google Drive." }, 404, origin);
    }
  } catch {
    return jsonResponse({ error: "Falha ao consultar o arquivo no Google Drive." }, 502, origin);
  }

  const mimeType = ALLOWED_MIME_TYPES.has(fileMetadata.mimeType)
    ? fileMetadata.mimeType
    : "application/octet-stream";
  if (mimeType === "application/octet-stream") {
    return jsonResponse({ error: "O formato deste arquivo não é permitido para download." }, 415, origin);
  }

  let driveResponse: Response;
  try {
    driveResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(document.drive_file_id) + "?alt=media&supportsAllDrives=true",
      {
        headers: { Authorization: "Bearer " + accessToken },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!driveResponse.ok || !driveResponse.body) {
      return jsonResponse({ error: "O Google Drive não conseguiu entregar o arquivo." }, 502, origin);
    }
  } catch {
    return jsonResponse({ error: "Falha ao baixar o arquivo do Google Drive." }, 502, origin);
  }

  const safeName = sanitizeDriveFileName(fileMetadata.name);
  return new Response(driveResponse.body, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": "attachment; filename=\"documento\"; filename*=UTF-8''" + encodeURIComponent(safeName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
      Vary: "Origin",
    },
  });
});
