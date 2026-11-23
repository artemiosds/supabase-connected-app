import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MAX_PDF_SIZE = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try {
    origin = new URL(request.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", { status: 403 });
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
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Serviço de assinatura indisponível." }, 503, origin);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return json({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user)
    return json({ error: "Sessão inválida ou expirada." }, 401, origin);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Solicitação inválida." }, 400, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Corpo da solicitação inválido." }, 400, origin);
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
  if (!UUID.test(tenantId) || !UUID.test(documentId)) {
    return json({ error: "Identificadores de Secretaria ou documento inválidos." }, 400, origin);
  }
  const expectedPath = new RegExp(
    "^" + tenantId + "/generated-documents/" + documentId + "/[0-9a-f-]{36}\\.pdf$",
    "i",
  );
  if (!expectedPath.test(storagePath)) {
    return json({ error: "O caminho do PDF não corresponde ao documento." }, 400, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: document, error: documentError }, { data: workflow, error: workflowError }] =
    await Promise.all([
      admin
        .from("generated_documents")
        .select("id,tenant_id,status,content_snapshot")
        .eq("id", documentId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("generated_document_workflows")
        .select("status")
        .eq("document_id", documentId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

  if (documentError || workflowError) {
    return json(
      { error: "Não foi possível conferir o documento e o fluxo de aprovação." },
      500,
      origin,
    );
  }
  if (!document || document.status !== "draft" || workflow?.status !== "approved") {
    return json(
      { error: "O documento precisa estar aprovado e disponível para assinatura." },
      409,
      origin,
    );
  }

  const { data: pdf, error: downloadError } = await admin.storage
    .from("gfs-private-documents")
    .download(storagePath);
  if (downloadError || !pdf)
    return json({ error: "Não foi possível recuperar o PDF final." }, 422, origin);
  if (pdf.size < 1 || pdf.size > MAX_PDF_SIZE) {
    return json({ error: "O PDF final deve ter até 20 MB." }, 413, origin);
  }

  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (header !== "%PDF-")
    return json({ error: "O arquivo enviado não é um PDF válido." }, 415, origin);

  const fileSha256 = await sha256Hex(bytes);
  const contentSha256 = await sha256Hex(new TextEncoder().encode(document.content_snapshot));
  const { data: finalized, error: finalizeError } = await admin.rpc(
    "finalize_generated_document_signature",
    {
      p_actor_id: authData.user.id,
      p_tenant_id: tenantId,
      p_document_id: documentId,
      p_storage_path: storagePath,
      p_file_sha256: fileSha256,
      p_file_size: bytes.byteLength,
      p_content_sha256: contentSha256,
    },
  );
  if (finalizeError) {
    return json(
      { error: finalizeError.message || "Não foi possível finalizar a assinatura." },
      409,
      origin,
    );
  }

  return json(
    {
      success: true,
      documentId,
      signedAt: finalized?.signed_at ?? null,
      sha256: fileSha256,
      contentSha256,
      fileSize: bytes.byteLength,
      signatureLevel: "simple",
    },
    200,
    origin,
  );
});
