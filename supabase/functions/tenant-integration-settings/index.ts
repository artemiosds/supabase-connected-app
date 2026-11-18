import { smtpSender } from "../_shared/tenant-smtp.ts";
import { renderInstitutionalEmail } from "../_shared/institutional-email.ts";
import {
  maskRecipient,
  normalizeTestRecipient,
  smtpPortSecurityError,
  testEmailCooldownRemaining,
} from "../_shared/test-email.ts";
import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type JsonObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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
  return await crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptSecret(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(iv) },
    key,
    new TextEncoder().encode(value),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
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

function publicSettings(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    email_provider: row.email_provider,
    email_from_name: row.email_from_name,
    email_from_address: row.email_from_address,
    email_reply_to: row.email_reply_to,
    email_domain: row.email_domain,
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

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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
  const canSubmitPrivacy = action === "submit_privacy_request";
  if (
    !capability ||
    (action === "get" || canSubmitPrivacy
      ? capability.can_view !== true
      : capability.can_edit !== true)
  ) {
    return response({ error: "Você não tem permissão para esta configuração." }, 403, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (action === "get") {
    const { data, error } = await admin
      .from("tenant_integration_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      console.error("Falha ao carregar configurações de integração:", error.message);
      return response({ error: "Não foi possível carregar as configurações." }, 500, origin);
    }
    return response(
      {
        configuration: publicSettings(data as Record<string, unknown> | null),
        can_edit: capability.can_edit === true,
      },
      200,
      origin,
    );
  }

  if (action === "start_drive_oauth") {
    const { data: row, error: rowError } = await admin
      .from("tenant_integration_settings")
      .select("drive_client_id,drive_client_secret_ciphertext")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const redirectUri = Deno.env.get("GOOGLE_DRIVE_REDIRECT_URI") ?? "";
    if (rowError || !row?.drive_client_id || !row.drive_client_secret_ciphertext || !redirectUri) {
      return response(
        {
          error:
            "Informe o OAuth Client ID/Secret e configure GOOGLE_DRIVE_REDIRECT_URI no servidor.",
        },
        409,
        origin,
      );
    }
    try {
      const stateBytes = crypto.getRandomValues(new Uint8Array(32));
      const state = toBase64(stateBytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
      const codeVerifier = toBase64(verifierBytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      const challengeDigest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier),
      );
      const codeChallenge = toBase64(new Uint8Array(challengeDigest))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
      const stateHash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const { error: stateError } = await admin.from("tenant_drive_oauth_states").insert({
        state_hash: stateHash,
        tenant_id: tenantId,
        actor_id: auth.user.id,
        code_verifier_ciphertext: await encryptSecret(codeVerifier, await encryptionKey()),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (stateError) throw new Error("OAUTH_STATE_STORE_FAILED");
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", row.drive_client_id);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return response({ authorization_url: url.toString() }, 200, origin);
    } catch {
      return response(
        { error: "Não foi possível iniciar a autorização do Google Drive." },
        500,
        origin,
      );
    }
  }

  if (action === "verify_email_domain") {
    const { data: row, error: rowError } = await admin
      .from("tenant_integration_settings")
      .select("email_provider,email_domain,email_api_secret_ciphertext")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (
      rowError ||
      row?.email_provider !== "resend" ||
      !row.email_domain ||
      !row.email_api_secret_ciphertext
    ) {
      return response(
        { error: "Configure domínio, provedor Resend e chave API antes da verificação." },
        409,
        origin,
      );
    }
    try {
      const apiKey = await decryptSecret(row.email_api_secret_ciphertext, await encryptionKey());
      const domainResponse = await fetch("https://api.resend.com/domains", {
        method: "GET",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const payload = await domainResponse.json().catch(() => null);
      if (!domainResponse.ok || !Array.isArray(payload?.data)) {
        return response(
          { error: "Não foi possível consultar o domínio no provedor." },
          502,
          origin,
        );
      }
      const domain = payload.data.find(
        (item: { name?: string }) =>
          typeof item.name === "string" &&
          item.name.toLowerCase() === String(row.email_domain).toLowerCase(),
      );
      const verified = domain?.status === "verified";
      const { error: updateError } = await admin
        .from("tenant_integration_settings")
        .update({
          email_domain_verified_at: verified ? new Date().toISOString() : null,
        })
        .eq("tenant_id", tenantId);
      if (updateError)
        return response({ error: "Não foi possível registrar o estado do domínio." }, 500, origin);
      return response(
        {
          verified,
          provider_status: typeof domain?.status === "string" ? domain.status : "not_found",
          message: verified
            ? "Domínio verificado pelo provedor."
            : "O domínio ainda não está verificado no provedor.",
        },
        200,
        origin,
      );
    } catch {
      return response(
        { error: "Não foi possível verificar o domínio com a credencial armazenada." },
        502,
        origin,
      );
    }
  }

  if (action === "test_email") {
    // Teste individual: um único destinatário, sem CC/BCC, sem tocar filas ou alertas automáticos.
    const recipient = normalizeTestRecipient(body.test_recipient_email);
    if (!recipient) {
      return response(
        { error: "Informe exatamente um endereço de e-mail válido (até 254 caracteres)." },
        400,
        origin,
      );
    }
    const { data: row, error: rowError } = await admin
      .from("tenant_integration_settings")
      .select(
        "email_provider,email_from_name,email_from_address,email_reply_to,email_api_secret_ciphertext,email_smtp_host,email_smtp_port,email_smtp_security,email_smtp_username,email_smtp_secret_ciphertext,email_last_test_at",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const waitMs = testEmailCooldownRemaining(row?.email_last_test_at as string | null);
    if (!rowError && row && waitMs > 0) {
      return response(
        {
          error: `Aguarde ${Math.ceil(waitMs / 1000)} s antes de enviar outro teste.`,
          outcome: "cooldown",
        },
        429,
        origin,
      );
    }
    const finish = async (outcome: "accepted" | "rejected" | "uncertain" | "configuration") => {
      await admin
        .from("tenant_integration_settings")
        .update({
          email_last_test_at: new Date().toISOString(),
          email_last_test_status: outcome === "accepted" ? "success" : "failed",
        })
        .eq("tenant_id", tenantId);
      const { error: auditError } = await admin.from("audit_events").insert({
        tenant_id: tenantId,
        actor_id: auth.user.id,
        action: "EMAIL_TEST",
        entity: "tenant_integration_settings",
        entity_id: tenantId,
        details: {
          provider: row?.email_provider ?? null,
          outcome,
          recipient: maskRecipient(recipient),
        },
      });
      if (auditError) {
        // Não alterar as permissões de auditoria nem registrar segredos nos logs.
        console.error("Auditoria do teste SMTP não gravada:", auditError.code);
      }
    };
    if (!rowError && row?.email_provider === "smtp_gateway") {
      const portError = smtpPortSecurityError(row.email_smtp_port, row.email_smtp_security);
      if (portError) {
        await finish("configuration");
        return response({ success: false, outcome: "configuration", message: portError }, 200, origin);
      }
      let outcome: "accepted" | "rejected" | "uncertain" | "configuration" = "configuration";
      let configurationMessage = "Confira o remetente e a credencial SMTP salva na Secretaria.";
      try {
        const send = await smtpSender(row, async (value) =>
          decryptSecret(value, await encryptionKey()),
        );
        const result = await send({
          to: recipient,
          subject: "Teste de e-mail institucional — Primus Gestão",
          html: renderInstitutionalEmail({
            issuer: row.email_from_name || "Secretaria de Saúde",
            category: "Validação de comunicação institucional",
            heading: "Teste de e-mail institucional realizado",
            preheader: "Mensagem de verificação do canal oficial de e-mail do Primus Gestão.",
            message: "Esta mensagem confirma a execução de um teste individual do canal de comunicação institucional configurado para a Secretaria. Não representa um aviso de vencimento nem uma solicitação de providência administrativa.",
            fields: [{ label: "Tipo de comunicação", value: "Teste de configuração SMTP" }],
            guidance: "Se você não solicitou este teste, entre em contato com a administração responsável pelo Primus Gestão.",
            tone: "success",
          }),
          idempotencyKey: crypto.randomUUID(),
        });
        outcome = result.status;
      } catch (error) {
        // Códigos estáveis, sem expor host não autorizado, credenciais ou erros brutos.
        if (error instanceof Error && error.message === "SMTP_ENDPOINT_NOT_ALLOWED") {
          configurationMessage =
            "O endpoint SMTP não está autorizado no ambiente SMS2. Inclua o host e a porta em SMTP_ALLOWED_ENDPOINTS.";
        } else if (error instanceof Error && error.message === "SMTP_CONFIGURATION") {
          configurationMessage = "Faltam dados da conta SMTP. Verifique usuário, remetente e credencial salva.";
        } else {
          configurationMessage =
            "Não foi possível preparar o envio SMTP. Verifique a credencial protegida e a configuração do servidor.";
        }
      }
      const accepted = outcome === "accepted";
      const message = accepted
        ? `Mensagem aceita pelo servidor SMTP para ${recipient}. Isso não confirma a entrega; confira a caixa de entrada e o spam.`
        : outcome === "uncertain"
          ? "Resultado incerto: o servidor não confirmou o aceite. Confira a caixa antes de repetir o teste."
          : outcome === "configuration"
            ? configurationMessage
            : "O servidor SMTP recusou o teste. Confira o remetente e as credenciais.";
      await finish(outcome);
      return response({ success: accepted, outcome, message }, 200, origin);
    }
    if (
      rowError ||
      !row ||
      row.email_provider !== "resend" ||
      !row.email_api_secret_ciphertext ||
      !row.email_from_address
    ) {
      return response(
        { error: "Salve o provedor (SMTP ou Resend), a credencial e o remetente antes do teste." },
        409,
        origin,
      );
    }
    let apiKey: string;
    try {
      apiKey = await decryptSecret(row.email_api_secret_ciphertext, await encryptionKey());
    } catch {
      console.error("Não foi possível descriptografar a credencial de e-mail da Secretaria.");
      return response(
        { error: "A credencial protegida não pôde ser lida. Verifique a chave do cofre." },
        503,
        origin,
      );
    }
    const from = row.email_from_name
      ? `${row.email_from_name.replace(/[<>\r\n]/g, "")} <${row.email_from_address}>`
      : row.email_from_address;
    let providerResponse: Response;
    try {
      providerResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `tenant-config-test-${tenantId}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          from,
          ...(row.email_reply_to ? { reply_to: row.email_reply_to } : {}),
          to: [recipient],
          subject: "Teste de configuração — Gestão de Fornecedores da Saúde",
          html: renderInstitutionalEmail({
            issuer: row.email_from_name || "Secretaria de Saúde",
            category: "Validação de comunicação institucional",
            heading: "Teste de e-mail institucional realizado",
            preheader: "Mensagem de verificação do canal oficial de e-mail do Primus Gestão.",
            message: "Esta mensagem confirma a execução de um teste individual do canal de comunicação institucional configurado para a Secretaria. Não representa um aviso de vencimento nem uma solicitação de providência administrativa.",
            fields: [{ label: "Tipo de comunicação", value: "Teste de configuração de e-mail" }],
            guidance: "Se você não solicitou este teste, entre em contato com a administração responsável pelo Primus Gestão.",
            tone: "success",
          }),
        }),
      });
    } catch {
      await finish("uncertain");
      return response(
        {
          success: false,
          outcome: "uncertain",
          message:
            "Resultado incerto: não foi possível confirmar o aceite pelo provedor. Confira a caixa antes de repetir.",
        },
        200,
        origin,
      );
    }
    const providerBody = await providerResponse.json().catch(() => null);
    const accepted = providerResponse.ok && typeof providerBody?.id === "string";
    await finish(accepted ? "accepted" : "rejected");
    if (!accepted) {
      console.error("Provedor rejeitou teste de e-mail:", providerResponse.status);
      return response(
        {
          success: false,
          outcome: "rejected",
          message:
            "O provedor rejeitou o teste. Confira domínio, remetente e credencial no painel do provedor.",
        },
        200,
        origin,
      );
    }
    return response(
      {
        success: true,
        outcome: "accepted",
        message: `E-mail de teste aceito pelo provedor para ${recipient}. Isso não confirma a entrega na caixa.`,
      },
      200,
      origin,
    );
  }

  if (action === "submit_privacy_request") {
    const requestType = textValue(body.request_type, 30);
    const description = textValue(body.subject_description, 4000);
    const requesterEmail = textValue(body.requester_email, 254) ?? auth.user.email ?? null;
    if (!["access", "correction", "export", "deletion", "objection"].includes(requestType ?? "")) {
      return response({ error: "Tipo de solicitação LGPD inválido." }, 400, origin);
    }
    if (!description || description.length < 10) {
      return response(
        { error: "Descreva a solicitação com pelo menos 10 caracteres." },
        400,
        origin,
      );
    }
    const { data: created, error: createError } = await admin
      .from("tenant_privacy_requests")
      .insert({
        tenant_id: tenantId,
        requester_user_id: auth.user.id,
        requester_email: requesterEmail,
        request_type: requestType,
        subject_description: description,
      })
      .select("id,status,created_at")
      .single();
    if (createError || !created) {
      console.error("Falha ao registrar solicitação LGPD:", createError?.message);
      return response({ error: "Não foi possível registrar a solicitação." }, 500, origin);
    }
    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_id: auth.user.id,
      action: "CREATE",
      entity: "tenant_privacy_requests",
      entity_id: created.id,
      details: { request_type: requestType, status: "received" },
    });
    return response({ request: created }, 201, origin);
  }

  if (action === "list_privacy_requests") {
    const { data: requests, error: requestsError } = await admin
      .from("tenant_privacy_requests")
      .select(
        "id,requester_email,request_type,subject_description,status,legal_basis_review,decision_notes,reviewed_at,completed_at,created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (requestsError)
      return response({ error: "Não foi possível carregar as solicitações LGPD." }, 500, origin);
    return response({ requests: requests ?? [] }, 200, origin);
  }

  if (action === "review_privacy_request") {
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    const decision = textValue(body.decision, 20);
    const legalBasis = textValue(body.legal_basis_review, 2000);
    const notes = textValue(body.decision_notes, 4000);
    if (
      !UUID.test(requestId) ||
      !["approved", "rejected"].includes(decision ?? "") ||
      !legalBasis ||
      !notes
    ) {
      return response(
        { error: "Informe solicitação, decisão, análise da base legal e justificativa." },
        400,
        origin,
      );
    }
    const { data: reviewed, error: reviewError } = await admin
      .from("tenant_privacy_requests")
      .update({
        status: decision,
        legal_basis_review: legalBasis,
        decision_notes: notes,
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("tenant_id", tenantId)
      .in("status", ["received", "under_review", "awaiting_identity"])
      .select("id,status,reviewed_at")
      .maybeSingle();
    if (reviewError || !reviewed)
      return response({ error: "Solicitação não encontrada ou já decidida." }, 409, origin);
    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_id: auth.user.id,
      action: "REVIEW",
      entity: "tenant_privacy_requests",
      entity_id: requestId,
      details: { decision, legal_basis_reviewed: true, no_data_deleted: true },
    });
    return response(
      { request: reviewed, message: "Decisão registrada. Nenhum dado foi excluído." },
      200,
      origin,
    );
  }

  if (action !== "save") return response({ error: "Ação não reconhecida." }, 400, origin);

  const provider = textValue(body.email_provider, 30) ?? "none";
  if (!["none", "resend", "smtp_gateway"].includes(provider)) {
    return response({ error: "Provedor de e-mail inválido." }, 400, origin);
  }
  const fromAddress = textValue(body.email_from_address, 254);
  const replyTo = textValue(body.email_reply_to, 254);
  if (fromAddress && !EMAIL.test(fromAddress))
    return response({ error: "Remetente inválido." }, 400, origin);
  if (replyTo && !EMAIL.test(replyTo))
    return response({ error: "E-mail de resposta inválido." }, 400, origin);
  const emailDomain = textValue(body.email_domain, 253);
  if (emailDomain && !/^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(emailDomain)) {
    return response({ error: "Informe um domínio válido." }, 400, origin);
  }
  if (
    fromAddress &&
    emailDomain &&
    fromAddress.split("@")[1]?.toLowerCase() !== emailDomain.toLowerCase()
  ) {
    return response(
      { error: "O domínio informado precisa corresponder ao endereço do remetente." },
      400,
      origin,
    );
  }

  const smtpHost = textValue(body.email_smtp_host, 253);
  const smtpPort =
    body.email_smtp_port === null || body.email_smtp_port === ""
      ? null
      : Number(body.email_smtp_port);
  const smtpSecurity = textValue(body.email_smtp_security, 10) ?? "tls";
  if (
    provider === "smtp_gateway" &&
    (!smtpHost || !Number.isInteger(smtpPort) || smtpPort! < 1 || smtpPort! > 65535)
  ) {
    return response({ error: "Informe servidor e porta SMTP válidos." }, 400, origin);
  }
  if (!["tls", "starttls"].includes(smtpSecurity)) {
    return response({ error: "Selecione TLS ou STARTTLS." }, 400, origin);
  }
  if (provider === "smtp_gateway") {
    const portError = smtpPortSecurityError(smtpPort, smtpSecurity);
    if (portError) return response({ error: portError }, 400, origin);
  }

  const { data: existing, error: readError } = await admin
    .from("tenant_integration_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError)
    return response({ error: "Não foi possível preparar a atualização." }, 500, origin);

  let key: CryptoKey;
  try {
    key = await encryptionKey();
  } catch {
    console.error("INTEGRATION_SECRETS_KEY ausente ou inválida.");
    return response(
      { error: "O cofre de credenciais ainda não foi configurado no servidor." },
      503,
      origin,
    );
  }

  const next: Record<string, unknown> = {
    tenant_id: tenantId,
    email_provider: provider,
    email_from_name: textValue(body.email_from_name, 160),
    email_from_address: fromAddress,
    email_reply_to: replyTo,
    email_domain: textValue(body.email_domain, 253)?.toLowerCase() ?? null,
    email_smtp_host: smtpHost,
    email_smtp_port: smtpPort,
    email_smtp_security: smtpSecurity,
    email_smtp_username: textValue(body.email_smtp_username, 254),
    drive_enabled: body.drive_enabled === true,
    drive_client_id: textValue(body.drive_client_id, 512),
    drive_root_folder_id: textValue(body.drive_root_folder_id, 512),
    retention_days:
      body.retention_days === null || body.retention_days === ""
        ? (existing?.retention_days ?? null)
        : Number(body.retention_days),
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };

  if ((existing?.email_domain ?? null) !== (next.email_domain ?? null)) {
    next.email_domain_verified_at = null;
  } else if (existing?.email_domain_verified_at) {
    next.email_domain_verified_at = existing.email_domain_verified_at;
  }

  if (
    next.retention_days !== null &&
    (!Number.isInteger(next.retention_days) ||
      Number(next.retention_days) < 30 ||
      Number(next.retention_days) > 36500)
  ) {
    return response(
      { error: "O prazo de retenção deve ficar entre 30 e 36.500 dias." },
      400,
      origin,
    );
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
        if (value.length > 8192)
          return response({ error: "Uma credencial excede o tamanho permitido." }, 400, origin);
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

  const emailCredentialChanged =
    (typeof body.email_api_secret === "string" && body.email_api_secret.length > 0) ||
    existing?.email_provider !== provider ||
    existing?.email_from_address !== fromAddress;
  if (emailCredentialChanged) {
    next.email_domain_verified_at = null;
    next.email_last_test_at = null;
    next.email_last_test_status = null;
  }

  const policyText = textValue(body.retention_policy_text, 8000);
  const policyVersion = textValue(body.retention_policy_version, 40);
  if (body.approve_retention_policy === true) {
    if (!policyText || !policyVersion || next.retention_days === null) {
      return response(
        { error: "Informe o prazo, o texto e a versão da política antes de aprovar." },
        400,
        origin,
      );
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

  const approvedPolicyChanged =
    Boolean(existing?.retention_approved_at) &&
    (Number(next.retention_days) !== Number(existing?.retention_days) ||
      next.retention_policy_text !== existing?.retention_policy_text ||
      next.retention_policy_version !== existing?.retention_policy_version);
  if (approvedPolicyChanged && body.approve_retention_policy !== true) {
    return response(
      {
        error: "A política aprovada foi alterada. Revise e aprove uma nova versão antes de salvar.",
      },
      409,
      origin,
    );
  }
  if (
    approvedPolicyChanged &&
    next.retention_policy_version === existing?.retention_policy_version
  ) {
    return response(
      { error: "Uma alteração na política exige um novo número de versão." },
      409,
      origin,
    );
  }

  const { data: saved, error: saveError } = await admin
    .from("tenant_integration_settings")
    .upsert(next, { onConflict: "tenant_id" })
    .select("*")
    .single();
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
      retention_policy_version: next.retention_policy_version ?? null,
      retention_policy_approved: Boolean(next.retention_approved_at),
    },
  });

  return response({ configuration: publicSettings(saved as Record<string, unknown>) }, 200, origin);
});
