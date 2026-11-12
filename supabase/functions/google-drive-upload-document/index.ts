import { getAllowedOrigins } from "../_shared/origins.ts";
import {
  sanitizeDriveFileName,
  expectedDriveMimeType,
  validateDriveFileContent,
  readRequestBodyBounded,
  isUuid,
} from "../_shared/google-drive.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

const DOCUMENT_TYPES = new Set([
  "contrato", "certidao_federal", "certidao_estadual", "certidao_municipal",
  "fgts", "trabalhista", "sanitaria", "alvara", "proposta", "outros",
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

function dateOnly(value: FormDataEntryValue | null): string | null | false {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? false : value;
}

async function getDriveAccessToken(admin: ReturnType<typeof createClient>, tenantId: string) {
  const { data, error } = await admin.rpc("get_tenant_google_drive_credentials", {
    p_tenant_id: tenantId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.refresh_token || !row?.root_folder_id) {
    return { accessToken: null, error: "DRIVE_NOT_CONNECTED" };
  }

  const expiresAt = Date.parse(row.access_token_expires_at);
  if (row.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 90_000) {
    return { accessToken: row.access_token as string, error: null };
  }

  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { accessToken: null, error: "DRIVE_NOT_CONFIGURED" };

  try {
    const refresh = await fetch("https://oauth2.googleapis.com/token", {
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
    const result = await refresh.json();
    if (!refresh.ok || !result.access_token || !Number.isInteger(result.expires_in)) {
      return { accessToken: null, error: "DRIVE_TOKEN_REFRESH_FAILED" };
    }
    const { error: saveError } = await admin.rpc("update_tenant_google_drive_access_token", {
      p_tenant_id: tenantId,
      p_access_token: result.access_token,
      p_access_token_expires_at: new Date(Date.now() + result.expires_in * 1000).toISOString(),
      p_refresh_token: typeof result.refresh_token === "string" ? result.refresh_token : null,
    });
    if (saveError) return { accessToken: null, error: "DRIVE_TOKEN_STORAGE_FAILED" };
    return { accessToken: result.access_token as string, error: null };
  } catch {
    return { accessToken: null, error: "DRIVE_TOKEN_REFRESH_FAILED" };
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

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && (!/^\\d+$/.test(declaredLength) || Number(declaredLength) > 21 * 1024 * 1024)) {
    return jsonResponse({ error: "A solicitação ultrapassa o limite de 20 MB." }, 413, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Serviço de documentos não configurado." }, 503, origin);
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);

  const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user || authData.user.is_anonymous || !authData.user.email_confirmed_at) {
    return jsonResponse({ error: "Sua sessão expirou ou não está confirmada." }, 401, origin);
  }

  let form: FormData;
  try {
    const boundedBody = await readRequestBodyBounded(request, 21 * 1024 * 1024);
    const boundedHeaders = new Headers(request.headers);
    boundedHeaders.delete("content-length");
    boundedHeaders.delete("transfer-encoding");
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: boundedHeaders,
      body: boundedBody,
    });
    form = await boundedRequest.formData();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const tooLarge = message.includes("limite permitido");
    return jsonResponse(
      { error: tooLarge ? "A solicitação ultrapassa o limite de 20 MB." : "Envie um formulário multipart válido." },
      tooLarge ? 413 : 400,
      origin,
    );
  }

  const tenantId = String(form.get("tenant_id") ?? "");
  const supplierId = String(form.get("supplier_id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const documentType = String(form.get("document_type") ?? "outros");
  const notes = String(form.get("notes") ?? "").trim();
  const issueDate = dateOnly(form.get("issue_date"));
  const expiresAt = dateOnly(form.get("expires_at"));
  const fileValue = form.get("file");

  if (!isUuid(tenantId) || !isUuid(supplierId)) {
    return jsonResponse({ error: "Secretaria ou fornecedor inválido." }, 400, origin);
  }
  if (title.length < 2 || title.length > 180 || !DOCUMENT_TYPES.has(documentType)) {
    return jsonResponse({ error: "Informe o título e o tipo de documento válidos." }, 400, origin);
  }
  if (notes.length > 5000 || issueDate === false || expiresAt === false) {
    return jsonResponse({ error: "Observação ou datas inválidas." }, 400, origin);
  }
  if (issueDate && expiresAt && expiresAt < issueDate) {
    return jsonResponse({ error: "O vencimento não pode ser anterior à emissão." }, 400, origin);
  }
  if (!(fileValue instanceof File)) {
    return jsonResponse({ error: "Selecione um arquivo para enviar ao Google Drive." }, 400, origin);
  }

  const contentError = await validateDriveFileContent(fileValue);
  if (contentError) return jsonResponse({ error: contentError }, 400, origin);

  const { data: capabilities, error: capabilityError } = await userClient.rpc(
    "get_document_capabilities",
    { p_tenant_id: tenantId },
  );
  if (capabilityError || capabilities?.[0]?.can_create !== true) {
    return jsonResponse({ error: "Seu perfil não pode enviar documentos nesta Secretaria." }, 403, origin);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: supplier, error: supplierError } = await admin
    .from("suppliers")
    .select("id,tenant_id,status")
    .eq("id", supplierId)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (supplierError || !supplier) {
    return jsonResponse({ error: "Fornecedor não encontrado ou inativo nesta Secretaria." }, 404, origin);
  }

  const credentials = await getDriveAccessToken(admin, tenantId);
  if (!credentials.accessToken) {
    const status = credentials.error === "DRIVE_NOT_CONNECTED" ? 409 : 503;
    return jsonResponse(
      { error: "O Google Drive desta Secretaria não está conectado ou precisa de reconexão." },
      status,
      origin,
    );
  }

  const safeName = sanitizeDriveFileName(fileValue.name);
  const mimeType = expectedDriveMimeType(fileValue.name);
  if (!mimeType) {
    return jsonResponse({ error: "O formato do arquivo não é permitido." }, 415, origin);
  }
  const { data: driveCredentials } = await admin.rpc("get_tenant_google_drive_credentials", {
    p_tenant_id: tenantId,
  });
  const driveRow = Array.isArray(driveCredentials) ? driveCredentials[0] : driveCredentials;
  if (!driveRow?.root_folder_id) {
    return jsonResponse({ error: "A pasta de documentos do Google Drive não está configurada." }, 503, origin);
  }

  const metadata = {
    name: safeName,
    parents: [driveRow.root_folder_id],
    appProperties: {
      tenant_id: tenantId,
      supplier_id: supplierId,
      application: "gestao-fornecedores-saude",
    },
  };
  const uploadBody = new FormData();
  uploadBody.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json; charset=UTF-8" }));
  uploadBody.append("file", fileValue, safeName);

  let driveFile: { id?: string; webViewLink?: string };
  try {
    const driveResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + credentials.accessToken },
        body: uploadBody,
        signal: AbortSignal.timeout(30000),
      },
    );
    driveFile = await driveResponse.json();
    if (!driveResponse.ok || !driveFile.id) {
      console.error("Google Drive upload failed:", driveResponse.status);
      return jsonResponse({ error: "O Google Drive não aceitou o arquivo. Tente novamente." }, 502, origin);
    }
  } catch {
    return jsonResponse({ error: "Falha de comunicação com o Google Drive." }, 502, origin);
  }

  const documentId = crypto.randomUUID();
  // The provider URL is deliberately never returned to tenant users.
  // All downloads are streamed through the authenticated backend endpoint.
  const { error: insertError } = await admin.from("supplier_documents").insert({
    id: documentId,
    tenant_id: tenantId,
    supplier_id: supplierId,
    title,
    document_type: documentType,
    issue_date: issueDate,
    expires_at: expiresAt,
    notes: notes || null,
    storage_provider: "google_drive",
    drive_file_id: driveFile.id,
    external_url: null,
    storage_path: null,
    file_name: safeName,
    mime_type: mimeType,
    file_size: fileValue.size,
    status: "active",
    created_by: authData.user.id,
    updated_by: authData.user.id,
  });

  if (insertError) {
    try {
      await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(driveFile.id), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + credentials.accessToken },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      console.error("Drive orphan cleanup failed after database insert failure.");
    }
    console.error("Google Drive metadata insert failed:", insertError.code);
    return jsonResponse({ error: "O arquivo foi enviado, mas o registro não foi salvo. Tente novamente ou solicite suporte." }, 502, origin);
  }

  return jsonResponse(
    {
      id: documentId,
      title,
      file_name: safeName,
      mime_type: mimeType,
      file_size: fileValue.size,
      status: "active",
      storage_provider: "google_drive",
    },
    201,
    origin,
  );
});
