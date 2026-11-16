import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

type JsonObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

function response(payload: JsonObject, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

function textValue(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const valueTrimmed = value.trim();
  return valueTrimmed.length > 0 && valueTrimmed.length <= max ? valueTrimmed : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get("INTEGRATION_SECRETS_KEY") ?? "";
  let raw: Uint8Array;
  try {
    raw = fromBase64(encoded);
  } catch {
    throw new Error("INTEGRATION_SECRETS_KEY_INVALID");
  }
  if (raw.length !== 32) throw new Error("INTEGRATION_SECRETS_KEY_INVALID");
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

function publicSettings(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    email_provider: row.email_provider,
    email_from_name: row.email_from_name,
    email_from_address: row.email_from_address,
    email_reply_to: row.email_reply_to,
    email_smtp_host: row.email_smtp_host,
    email_smtp_port: row.email_smtp_port,
    email_smtp_security: row.email_smtp_security,
    email_smtp_username: row.email_smtp_username,
    has_smtp_secret: Boolean(row.email_smtp_secret_ciphertext),
    has_email_api_secret: Boolean(row.email_api_secret_ciphertext),
    email_domain_verified_at: row.email_domain_verified_at,
    email_last_test_at: row.email_last_test_at,
    email_last_test_status: row.email_last_test_status,
    drive_enabled: row.drive_enabled,
    drive_client_id: row.drive_client_id,
    has_drive_client_secret: Boolean(row.drive_client_secret_ciphertext),
    has_drive_refresh_token: Boolean(row.drive_refresh_token_ciphertext),
    drive_root_folder_id: row.drive_root_folder_id,
    drive_connected_at: row.drive_connected_at,
    drive_last_sync_at: row.drive_last_sync_at,
    retention_days: row.retention_days,
    retention_policy_version: row.retention_policy_version,
    retention_policy_text: row.retention_policy_text,
    retention_approved_at: row.retention_approved_at,
    updated_at: row.updated_at,
  };
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
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: "Serviço de configurações indisponível." }, 503, origin);
  }

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\\s+/i, "").trim();
  if (!token) return response({ error: "Sessão autenticada obrigatória." }, 401, origin);

  let body: JsonObject;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as JsonObject;
  } catch {
    return response({ error: "Corpo da solicitação inválido." }, 400, origin);
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  if (!UUID.test(tenantId)) return response({ error: "Secretaria inválida." }, 400, origin);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous || !auth.user.email_confirmed_at) {
    return response({ error: "Entre com uma conta confirmada." }, 401, origin);
  }

  const action = body.action;
  const { data: capabilities, error: capabilityError } = await userClient.rpc(
    "get_tenant_settings_capabilities",
    { p_tenant_id: tenantId },
  );
  if (capabilityError) {
    console.error("Não foi possível validar permissões da Secretaria:", capabilityError.message);
    return response({ error: "Não foi possível validar suas permissões." }, 403, origin);
  }
  const capability = Array.isArray(capabilities) ? capabilities[0] : null;
  if (!capability || (action === "get" ? capability.can_view !== true : capability.can_edit !== true)) {
    return response({ error: "Você não tem permissão para esta configuração." }, 403, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (action === "get") {
    const { data, error } = await admin.from("tenant_integration_settings")
      .select("*").eq("tenant_id", tenantId).maybeSingle();
    if (error) {
      console.error("Falha ao carregar configurações de integração:", error.message);
      return response({ error: "Não foi possível carregar as configurações." }, 500, origin);
    }
    return response({ configuration: publicSettings(data as Record<string, unknown> | null) }, 200, origin);
  }

  if (action !== "save") return response({ error: "Ação não reconhecida." }, 400, origin);

  const provider = textValue(body.email_provider, 30) ?? "none";
  if (!["none", "resend", "smtp_gateway"].includes(provider)) {
    return response({ error: "Provedor de e-mail inválido." }, 400, origin);
  }
  const fromAddress = textValue(body.email_from_address, 254);
  const replyTo = textValue(body.email_reply_to, 254);
  if (fromAddress && !EMAIL.test(fromAddress)) return response({ error: "Remetente inválido." }, 400, origin);
  if (replyTo && !EMAIL.test(replyTo)) return response({ error: "E-mail de resposta inválido." }, 400, origin);

  const smtpHost = textValue(body.email_smtp_host, 253);
  const smtpPort = body.email_smtp_port === null || body.email_smtp_port === ""
    ? null : Number(body.email_smtp_port);
  const smtpSecurity = textValue(body.email_smtp_security, 10) ?? "tls";
  if (provider === "smtp_gateway" && (!smtpHost || !Number.isInteger(smtpPort) || smtpPort! < 1 || smtpPort! > 65535)) {
    return response({ error: "Informe servidor e porta SMTP válidos." }, 400, origin);
  }
  if (!["tls", "starttls"].includes(smtpSecurity)) {
    return response({ error: "Selecione TLS ou STARTTLS." }, 400, origin);
  }

  const { data: existing, error: readError } = await admin
    .from("tenant_integration_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (readError) return response({ error: "Não foi possível preparar a atualização." }, 500, origin);

  let key: CryptoKey;
  try {
    key = await encryptionKey();
  } catch {
    console.error("INTEGRATION_SECRETS_KEY ausente ou inválida.");
    return response({ error: "O cofre de credenciais ainda não foi configurado no servidor." }, 503, origin);
  }

  const next: Record<string, unknown> = {
    tenant_id: tenantId,
    email_provider: provider,
    email_from_name: textValue(body.email_from_name, 160),
    email_from_address: fromAddress,
    email_reply_to: replyTo,
    email_smtp_host: smtpHost,
    email_smtp_port: smtpPort,
    email_smtp_security: smtpSecurity,
    email_smtp_username: textValue(body.email_smtp_username, 254),
    drive_enabled: body.drive_enabled === true,
    drive_client_id: textValue(body.drive_client_id, 512),
    drive_root_folder_id: textValue(body.drive_root_folder_id, 512),
    retention_days: Number(body.retention_days ?? existing?.retention_days ?? 2555),
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };

  if (!Number.isInteger(next.retention_days) || Number(next.retention_days) < 30 || Number(next.retention_days) > 36500) {
    return response({ error: "O prazo de retenção deve ficar entre 30 e 36.500 dias." }, 400, origin);
  }

  const secrets = [
    ["email_smtp_password", "email_smtp_secret_ciphertext"],
    ["email_api_secret", "email_api_secret_ciphertext"],
    ["drive_client_secret", "drive_client_secret_ciphertext"],
  ] as const;
  try {
    for (const [inputName, columnName] of secrets) {
      const value = body[inputName];
      if (typeof value === "string" && value.length > 0) {
        if (value.length > 8192) return response({ error: "Uma credencial excede o tamanho permitido." }, 400, origin);
        next[columnName] = await encryptSecret(value, key);
      } else if (body[`clear_${inputName}`] === true) {
        next[columnName] = null;
      } else if (existing?.[columnName]) {
        next[columnName] = existing[columnName];
      }
    }
  } catch {
    return response({ error: "Não foi possível proteger as credenciais." }, 500, origin);
  }

  const policyText = textValue(body.retention_policy_text, 8000);
  const policyVersion = textValue(body.retention_policy_version, 40);
  if (body.approve_retention_policy === true) {
    if (!policyText || !policyVersion) {
      return response({ error: "Informe o texto e a versão da política antes de aprovar." }, 400, origin);
    }
    next.retention_policy_text = policyText;
    next.retention_policy_version = policyVersion;
    next.retention_approved_at = new Date().toISOString();
    next.retention_approved_by = auth.user.id;
  } else if (existing?.retention_policy_text) {
    next.retention_policy_text = existing.retention_policy_text;
    next.retention_policy_version = existing.retention_policy_version;
    next.retention_approved_at = existing.retention_approved_at;
    next.retention_approved_by = existing.retention_approved_by;
  }

  const { data: saved, error: saveError } = await admin
    .from("tenant_integration_settings")
    .upsert(next, { onConflict: "tenant_id" })
    .select("*").single();
  if (saveError || !saved) {
    console.error("Falha ao salvar configurações da Secretaria:", saveError?.message);
    return response({ error: "Não foi possível salvar as configurações." }, 500, origin);
  }

  await admin.from("audit_events").insert({
    tenant_id: tenantId,
    actor_id: auth.user.id,
    action: "UPDATE",
    entity: "tenant_integration_settings",
    entity_id: tenantId,
    details: {
      email_provider: provider,
      smtp_configured: Boolean(smtpHost && smtpPort && next.email_smtp_secret_ciphertext),
      drive_enabled: next.drive_enabled,
      retention_days: next.retention_days,
      retention_policy_approved: Boolean(next.retention_approved_at),
    },
  });

  return response({ configuration: publicSettings(saved as Record<string, unknown>) }, 200, origin);
});
