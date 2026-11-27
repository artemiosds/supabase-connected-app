import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type JsonObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: JsonObject, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...(origin
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          }
        : {}),
      Vary: "Origin",
    },
  });
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get("INTEGRATION_SECRETS_KEY") ?? "";
  const raw = fromBase64(encoded);
  if (raw.length !== 32) throw new Error("INTEGRATION_SECRETS_KEY_INVALID");
  return await crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["decrypt"]);
}

async function decryptSecret(value: string, key: CryptoKey): Promise<string> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("CIPHERTEXT_INVALID");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(fromBase64(parts[1])) },
    key,
    asArrayBuffer(fromBase64(parts[2])),
  );
  return new TextDecoder().decode(decrypted);
}

function pncpBaseUrl(environment: string): string {
  return environment === "producao"
    ? "https://pncp.gov.br/api/pncp/v1"
    : "https://treinamento.pncp.gov.br/api/pncp/v1";
}

function pncpPublicAppUrl(environment: string): string {
  return environment === "producao"
    ? "https://pncp.gov.br/app"
    : "https://treinamento.pncp.gov.br/app";
}

Deno.serve(async (req: Request) => {
  let origin = "";
  try {
    origin = new URL(req.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", {
      status: 403,
      headers: { "X-Content-Type-Options": "nosniff" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Método não suportado." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = req.headers.get("Authorization") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !/^Bearer\s+\S+$/i.test(authorization)) {
    return json({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Sessão inválida ou expirada." }, 401, origin);
  }

  let body: JsonObject;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo JSON inválido." }, 400, origin);
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  const action = typeof body.action === "string" ? body.action : "publish";
  if (!UUID.test(tenantId)) {
    return json({ error: "Secretaria inválida." }, 400, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: canPublish } = await userClient.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission: "documents:update",
  }).then((res) => ({ data: Boolean(res.data) })).catch(() => ({ data: false }));

  if (!canPublish) {
    // Fallback check directly via membership in case helper RPC name differs
    const { data: member } = await admin
      .from("tenant_memberships")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member) {
      return json({ error: "Sem permissão para publicar pelo órgão." }, 403, origin);
    }
  }

  const { data: settings } = await admin
    .from("tenant_integration_settings")
    .select(
      "pncp_enabled, pncp_environment, pncp_login, pncp_password_ciphertext, pncp_unidade_compradora",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!settings?.pncp_enabled) {
    return json(
      {
        error:
          "Integração direta PNCP opcional não está habilitada nesta Secretaria. Habilite em Configurações → Integrações ou utilize a exportação JSON/XML.",
      },
      400,
      origin,
    );
  }

  if (!settings.pncp_login || !settings.pncp_password_ciphertext) {
    return json(
      { error: "Configure login e senha de API do PNCP em Configurações → Integrações." },
      400,
      origin,
    );
  }

  let password: string;
  try {
    const key = await encryptionKey();
    password = await decryptSecret(String(settings.pncp_password_ciphertext), key);
  } catch {
    return json({ error: "Não foi possível decifrar a credencial PNCP configurada." }, 500, origin);
  }

  const env = settings.pncp_environment === "producao" ? "producao" : "treinamento";
  const baseUrl = pncpBaseUrl(env);

  // 1) Autenticação oficial na API PNCP (/v1/usuarios/login)
  let pncpToken = "";
  try {
    const loginResp = await fetch(`${baseUrl}/usuarios/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ login: settings.pncp_login, senha: password }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!loginResp.ok) {
      const msg = `Falha ao autenticar no PNCP (${env}): HTTP ${loginResp.status}. Verifique login e senha em Configurações.`;
      await admin
        .from("tenant_integration_settings")
        .update({ pncp_last_test_at: new Date().toISOString(), pncp_last_test_status: msg })
        .eq("tenant_id", tenantId);
      return json({ error: msg }, 502, origin);
    }
    const authHeader = loginResp.headers.get("Authorization") ?? "";
    pncpToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro de conexão com o PNCP.";
    return json({ error: msg }, 502, origin);
  }

  if (action === "test") {
    await admin
      .from("tenant_integration_settings")
      .update({
        pncp_last_test_at: new Date().toISOString(),
        pncp_last_test_status: `Autenticação confirmada (${env}).`,
      })
      .eq("tenant_id", tenantId);
    return json({ ok: true, environment: env, message: `Conexão PNCP (${env}) validada com sucesso!` }, 200, origin);
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const recordId = typeof body.record_id === "string" ? body.record_id : "";
  const payload = body.payload;
  const orgaoCnpj = typeof body.orgao_cnpj === "string" ? body.orgao_cnpj.replace(/\D/g, "") : "";
  if (!["contract", "process", "pca"].includes(kind) || !payload || typeof payload !== "object" || orgaoCnpj.length !== 14) {
    return json({ error: "Informe tipo (contract/process/pca), CNPJ do órgão e payload válido." }, 400, origin);
  }

  const endpoint =
    kind === "pca"
      ? `${baseUrl}/orgaos/${orgaoCnpj}/pca`
      : kind === "process"
        ? `${baseUrl}/orgaos/${orgaoCnpj}/compras`
        : `${baseUrl}/orgaos/${orgaoCnpj}/contratos`;

  try {
    const pubResp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${pncpToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const respText = await pubResp.text();
    let respJson: Record<string, unknown> = {};
    try {
      respJson = JSON.parse(respText);
    } catch {
      respJson = { raw: respText };
    }

    if (!pubResp.ok) {
      return json(
        {
          error:
            (typeof respJson.message === "string" && respJson.message) ||
            `PNCP retornou HTTP ${pubResp.status}.`,
          details: respJson,
        },
        502,
        origin,
      );
    }

    const location = pubResp.headers.get("Location") ?? "";
    const controlNumber =
      (typeof respJson.numeroControlePNCP === "string" && respJson.numeroControlePNCP) ||
      location.split("/").filter(Boolean).pop() ||
      `PNCP-${Date.now()}`;
    const publicUrl = `${pncpPublicAppUrl(env)}/${kind === "contract" ? "contratos" : kind === "process" ? "compras" : "pca"}/${encodeURIComponent(controlNumber)}`;

    const targetTable =
      kind === "contract"
        ? "contracts"
        : kind === "process"
          ? "procurement_processes"
          : "annual_procurement_demands";

    if (UUID.test(recordId)) {
      await admin
        .from(targetTable)
        .update({
          pncp_control_number: controlNumber,
          pncp_url: publicUrl,
          pncp_published_at: new Date().toISOString(),
          pncp_environment: env,
        })
        .eq("id", recordId)
        .eq("tenant_id", tenantId);
    }

    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_id: authData.user.id,
      action: "pncp.published",
      entity: targetTable,
      entity_id: recordId || tenantId,
      details: { environment: env, control_number: controlNumber, url: publicUrl },
    });

    return json(
      {
        ok: true,
        environment: env,
        pncp_control_number: controlNumber,
        pncp_url: publicUrl,
      },
      200,
      origin,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao enviar dados para o PNCP.";
    return json({ error: msg }, 502, origin);
  }
});
