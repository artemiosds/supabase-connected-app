import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

function json(payload: Record<string, unknown>, status: number, origin: string) {
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
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function b64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function secretKey(): Promise<CryptoKey> {
  const raw = b64(Deno.env.get("INTEGRATION_SECRETS_KEY") ?? "");
  if (raw.length !== 32) throw new Error("INVALID_SECRET_KEY");
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["decrypt"]);
}
async function decrypt(value: string, key: CryptoKey): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("INVALID_CIPHERTEXT");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(b64(iv)) },
    key,
    asArrayBuffer(b64(ciphertext)),
  );
  return new TextDecoder().decode(plain);
}
async function idempotencyKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function googleRequest(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(30000) });
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try { origin = new URL(request.headers.get("Origin") ?? "").origin; } catch { origin = ""; }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", { status: 403 });
  }
  if (request.method === "OPTIONS") return new Response("ok", {
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Serviço indisponível." }, 503, origin);
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sessão autenticada obrigatória." }, 401, origin);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Corpo da solicitação inválido." }, 400, origin);
  }
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    return json({ error: "Secretaria inválida." }, 400, origin);
  }

  const user = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await user.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous || !auth.user.email_confirmed_at) {
    return json({ error: "Entre com uma conta confirmada." }, 401, origin);
  }
  const { data: caps, error: capError } = await user.rpc("get_tenant_settings_capabilities", { p_tenant_id: tenantId });
  const capability = Array.isArray(caps) ? caps[0] : null;
  if (capError || capability?.can_edit !== true) return json({ error: "Sem permissão para sincronizar documentos desta Secretaria." }, 403, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: settings, error: settingsError } = await admin
    .from("tenant_integration_settings")
    .select("drive_client_id,drive_client_secret_ciphertext,drive_refresh_token_ciphertext,drive_root_folder_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (settingsError || !settings?.drive_client_id || !settings.drive_client_secret_ciphertext || !settings.drive_refresh_token_ciphertext) {
    return json({ error: "Conecte o Google Drive da Secretaria antes de sincronizar." }, 409, origin);
  }

  try {
    const key = await secretKey();
    const clientSecret = await decrypt(settings.drive_client_secret_ciphertext, key);
    const refreshToken = await decrypt(settings.drive_refresh_token_ciphertext, key);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.drive_client_id,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenBody = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || typeof tokenBody?.access_token !== "string") {
      return json({ error: "O Google não renovou a autorização. Reconecte a conta Drive." }, 502, origin);
    }
    const accessToken = tokenBody.access_token as string;

    let rootFolderId = settings.drive_root_folder_id as string | null;
    if (rootFolderId) {
      const check = await googleRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootFolderId)}?fields=id,mimeType,trashed`,
        accessToken,
      );
      const folder = await check.json().catch(() => null);
      if (!check.ok || folder?.mimeType !== "application/vnd.google-apps.folder" || folder?.trashed) {
        return json({ error: "A pasta raiz informada não está acessível pela conta conectada." }, 409, origin);
      }
    } else {
      const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
      const createFolder = await googleRequest("https://www.googleapis.com/drive/v3/files?fields=id", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Gestão de Fornecedores - ${String(tenant?.name ?? "Secretaria").slice(0, 120)}`,
          mimeType: "application/vnd.google-apps.folder",
        }),
      });
      const folder = await createFolder.json().catch(() => null);
      if (!createFolder.ok || typeof folder?.id !== "string") {
        return json({ error: "Não foi possível criar a pasta raiz da Secretaria no Google Drive." }, 502, origin);
      }
      rootFolderId = folder.id;
      await admin.from("tenant_integration_settings").update({
        drive_root_folder_id: rootFolderId,
        updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
      }).eq("tenant_id", tenantId);
    }

    const [supplierDocs, templateSources] = await Promise.all([
      admin.from("supplier_documents")
        .select("id,title,file_name,storage_path,mime_type")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .not("storage_path", "is", null)
        .order("created_at", { ascending: true })
        .limit(1000),
      admin.from("document_template_sources")
        .select("template_id,version,storage_path,file_name")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true })
        .limit(1000),
    ]);
    if (supplierDocs.error || templateSources.error) {
      return json({ error: "Não foi possível listar os documentos privados da Secretaria." }, 500, origin);
    }

    const sources = [
      ...(supplierDocs.data ?? []).map((row) => ({
        sourceType: "supplier_document" as const,
        sourceId: row.id,
        version: 1,
        storagePath: row.storage_path as string,
        fileName: row.file_name || row.title || `documento-${row.id}`,
        mimeType: row.mime_type || "application/octet-stream",
      })),
      ...(templateSources.data ?? []).map((row) => ({
        sourceType: "document_template_source" as const,
        sourceId: row.template_id,
        version: row.version,
        storagePath: row.storage_path,
        fileName: row.file_name,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })),
    ].filter((source) => source.storagePath);

    const { data: existingJobs, error: jobsError } = await admin.from("tenant_drive_sync_jobs")
      .select("id,idempotency_key,status,attempts")
      .eq("tenant_id", tenantId)
      .limit(5000);
    if (jobsError) return json({ error: "Não foi possível consultar o histórico de sincronização." }, 500, origin);
    const jobsByKey = new Map((existingJobs ?? []).map((job) => [job.idempotency_key, job]));

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let uncertain = 0;
    let processed = 0;
    for (const source of sources) {
      if (processed >= 3) break;
      const keyValue = await idempotencyKey(`${tenantId}:${source.sourceType}:${source.sourceId}:v${source.version}:${source.storagePath}`);
      const existing = jobsByKey.get(keyValue);
      if (existing?.status === "synced" || existing?.status === "uncertain" ||
          existing?.status === "processing" || (existing && existing.attempts >= 3)) {
        skipped += 1;
        continue;
      }
      processed += 1;
      let jobId = existing?.id as string | undefined;
      if (jobId) {
        const { data: claimed, error: claimError } = await admin.from("tenant_drive_sync_jobs").update({
          status: "processing",
          attempts: existing.attempts + 1,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId).eq("status", "failed").select("id").maybeSingle();
        if (claimError || !claimed) { skipped += 1; continue; }
      } else {
        const { data: created, error: createError } = await admin.from("tenant_drive_sync_jobs").insert({
          tenant_id: tenantId,
          source_type: source.sourceType,
          source_id: source.sourceId,
          source_version: source.version,
          storage_path: source.storagePath,
          file_name: source.fileName.slice(0, 255),
          idempotency_key: keyValue,
          status: "processing",
          attempts: 1,
          created_by: auth.user.id,
        }).select("id").single();
        if (createError || !created) { skipped += 1; continue; }
        jobId = created.id;
      }

      const { data: file, error: downloadError } = await admin.storage
        .from("gfs-private-documents").download(source.storagePath);
      if (downloadError || !file) {
        await admin.from("tenant_drive_sync_jobs").update({
          status: "failed", last_error_code: "SOURCE_DOWNLOAD_FAILED", updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        failed += 1;
        continue;
      }

      const boundary = `gfs_${crypto.randomUUID().replace(/-/g, "")}`;
      const metadata = JSON.stringify({
        name: source.fileName.slice(0, 255),
        parents: [rootFolderId],
        appProperties: { gfsTenantId: tenantId, gfsSourceType: source.sourceType, gfsSourceId: source.sourceId },
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const multipart = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
        `--${boundary}\r\nContent-Type: ${source.mimeType}\r\n\r\n`,
        bytes,
        `\r\n--${boundary}--`,
      ]);
      let upload: Response;
      try {
        upload = await googleRequest(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name",
          accessToken,
          {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body: multipart,
          },
        );
      } catch {
        await admin.from("tenant_drive_sync_jobs").update({
          status: "uncertain", last_error_code: "DRIVE_UPLOAD_OUTCOME_UNCERTAIN", updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        uncertain += 1;
        continue;
      }
      const uploaded = await upload.json().catch(() => null);
      if (!upload.ok || typeof uploaded?.id !== "string") {
        const ambiguous = upload.status >= 500;
        await admin.from("tenant_drive_sync_jobs").update({
          status: ambiguous ? "uncertain" : "failed",
          last_error_code: `DRIVE_HTTP_${upload.status}`,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        if (ambiguous) uncertain += 1; else failed += 1;
        continue;
      }
      const { error: completeError } = await admin.from("tenant_drive_sync_jobs").update({
        status: "synced",
        drive_file_id: uploaded.id,
        last_error_code: null,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      if (completeError) {
        uncertain += 1;
        continue;
      }
      synced += 1;
    }

    await admin.from("tenant_integration_settings").update({
      drive_last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    }).eq("tenant_id", tenantId);
    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_id: auth.user.id,
      action: "SYNC",
      entity: "google_drive",
      entity_id: tenantId,
      details: { processed, total_candidates: sources.length, synced, skipped, failed, uncertain, originals_preserved: true },
    });
    return json({
      success: true,
      processed,
      total_candidates: sources.length,
      synced,
      skipped,
      failed,
      uncertain,
      limit: 3,
      originals_preserved: true,
      message: "Cópias enviadas ao Google Drive. Os arquivos originais privados continuam no sistema.",
    }, 200, origin);
  } catch {
    console.error("Google Drive synchronization failed.");
    return json({ error: "A sincronização encontrou uma falha. Os arquivos originais foram preservados." }, 500, origin);
  }
});
