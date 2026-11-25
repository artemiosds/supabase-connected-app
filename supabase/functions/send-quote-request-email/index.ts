import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { renderInstitutionalEmail } from "../_shared/institutional-email.ts";
import { getAllowedOrigins } from "../_shared/origins.ts";
import {
  injectTenantLogoHtml,
  resolveTenantEmailSender,
  resolveTenantLogoAttachment,
} from "../_shared/tenant-email-sender.ts";
import { maskRecipient, normalizeTestRecipient } from "../_shared/test-email.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESEND_COOLDOWN_MS = 30_000;

function sanitizeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 180);
}

function formatDatePtBr(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return "Não informado";
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function response(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try {
    origin = new URL(request.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", {
      status: 403,
      headers: { "X-Content-Type-Options": "nosniff" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (request.method !== "POST") {
    return response({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: "Serviço de envio indisponível." }, 503, origin);
  }

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return response({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return response({ error: "Corpo da solicitação inválido." }, 400, origin);
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  const quoteRequestId = typeof body.quote_request_id === "string" ? body.quote_request_id : "";
  const recipientEmail = normalizeTestRecipient(body.recipient_email);

  if (!UUID.test(tenantId) || !UUID.test(quoteRequestId)) {
    return response({ error: "Identificadores da solicitação de cotação inválidos." }, 400, origin);
  }
  if (!recipientEmail) {
    return response({ error: "Informe um único endereço de e-mail válido do fornecedor." }, 400, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous || !auth.user.email_confirmed_at) {
    return response({ error: "Entre com uma conta confirmada para disparar cotações." }, 401, origin);
  }

  const { data: canDispatch, error: permissionError } = await userClient.rpc(
    "can_dispatch_procurement_quote_email",
    { p_tenant_id: tenantId },
  );
  if (permissionError || canDispatch !== true) {
    return response(
      { error: "Sem permissão para enviar convites de cotação nesta Secretaria." },
      403,
      origin,
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data: quoteRequest, error: requestError } = await admin
    .from("procurement_quote_requests")
    .select(
      "id,tenant_id,process_id,supplier_id,token,status,response_deadline,expires_at,notes,email_sent_at",
    )
    .eq("id", quoteRequestId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (requestError || !quoteRequest) {
    return response({ error: "Solicitação de cotação não encontrada." }, 404, origin);
  }

  if (quoteRequest.status !== "pending") {
    return response(
      { error: "Apenas solicitações pendentes podem receber novo convite por e-mail." },
      409,
      origin,
    );
  }

  if (Date.parse(quoteRequest.expires_at) <= Date.now()) {
    return response(
      { error: "O link desta solicitação expirou. Gere uma nova solicitação formal." },
      409,
      origin,
    );
  }

  if (quoteRequest.email_sent_at) {
    const elapsedMs = Date.now() - Date.parse(quoteRequest.email_sent_at);
    if (!Number.isNaN(elapsedMs) && elapsedMs < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000));
      return response(
        { error: `Aguarde ${waitSeconds}s antes de reenviar este convite por e-mail.` },
        429,
        origin,
      );
    }
  }

  const [{ data: tenantRow }, { data: brandingRow }, { data: processRow }, { data: supplierRow }, { count: itemsCount }] =
    await Promise.all([
      admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
      admin
        .from("tenant_document_branding")
        .select("header_title")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("procurement_processes")
        .select("number,title")
        .eq("id", quoteRequest.process_id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("suppliers")
        .select("legal_name,trade_name,cnpj,contact_name")
        .eq("id", quoteRequest.supplier_id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("procurement_items")
        .select("id", { count: "exact", head: true })
        .eq("process_id", quoteRequest.process_id)
        .eq("tenant_id", tenantId),
    ]);

  if (!processRow || !supplierRow) {
    return response({ error: "Dados do processo ou do fornecedor indisponíveis." }, 404, origin);
  }

  let sender;
  try {
    sender = await resolveTenantEmailSender(admin, tenantId, {
      apiKey: Deno.env.get("RESEND_API_KEY"),
      from: Deno.env.get("EXPIRY_ALERTS_FROM"),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SMTP_ENDPOINT_NOT_ALLOWED") {
      return response(
        {
          error:
            "O servidor SMTP configurado não está autorizado no ambiente. Revise Configurações > E-mail.",
        },
        409,
        origin,
      );
    }
    if (code === "SMTP_CONFIGURATION" || code === "EMAIL_PROVIDER_NOT_CONFIGURED") {
      return response(
        {
          error:
            "Canal de e-mail institucional não configurado. Cadastre SMTP ou Resend em Configurações > E-mail.",
        },
        409,
        origin,
      );
    }
    if (code === "INTEGRATION_SECRETS_KEY_INVALID" || code === "EMAIL_SECRET_INVALID") {
      return response(
        { error: "Não foi possível abrir as credenciais protegidas de e-mail da Secretaria." },
        503,
        origin,
      );
    }
    return response({ error: "Não foi possível preparar o canal de envio institucional." }, 500, origin);
  }

  const issuerName =
    brandingRow?.header_title?.trim() || tenantRow?.name?.trim() || "Secretaria de Saúde";
  const supplierName =
    supplierRow.trade_name?.trim() || supplierRow.legal_name?.trim() || "Fornecedor";
  const contactGreeting = supplierRow.contact_name?.trim()
    ? `Prezado(a) ${supplierRow.contact_name.trim()} (${supplierName}),`
    : `Prezada equipe da empresa ${supplierName},`;

  const portalUrl = new URL("/portal-fornecedor", origin);
  portalUrl.searchParams.set("token", quoteRequest.token);

  const attachments = await resolveTenantLogoAttachment(admin, tenantId);
  const rawHtml = renderInstitutionalEmail({
    issuer: issuerName,
    category: "Pesquisa de Preços — Lei nº 14.133/2021",
    heading: `Solicitação formal de cotação nº ${processRow.number}`,
    preheader: `Envio de proposta eletrônica até ${formatDatePtBr(quoteRequest.response_deadline)} — Processo ${processRow.number}.`,
    greeting: contactGreeting,
    message:
      "Convidamos sua empresa a apresentar proposta formal de preços unitários e condições comerciais através do Portal Eletrônico de Cotação, vinculado ao processo administrativo identificado abaixo.",
    fields: [
      { label: "Órgão solicitante", value: issuerName },
      { label: "Processo administrativo", value: `Nº ${processRow.number} — ${processRow.title}` },
      { label: "Fornecedor convidado", value: `${supplierName}${supplierRow.cnpj ? ` (${supplierRow.cnpj})` : ""}` },
      { label: "Quantidade de itens", value: `${itemsCount ?? 0} item(ns) especificados` },
      { label: "Prazo limite de resposta", value: formatDatePtBr(quoteRequest.response_deadline) },
      ...(quoteRequest.notes?.trim()
        ? [{ label: "Observações do órgão", value: quoteRequest.notes.trim() }]
        : []),
    ],
    guidance:
      "O link exclusivo abaixo dá acesso direto ao formulário eletrônico com os itens do processo e emite comprovante de protocolo automático após o envio.",
    action: {
      label: "Responder Cotação Eletrônica",
      url: portalUrl.href,
    },
    tone: "standard",
  });

  const subject = sanitizeSubject(
    `Solicitação de Cotação Eletrônica — Processo nº ${processRow.number} (${issuerName})`,
  );

  const delivery = await sender.send({
    attachments,
    to: recipientEmail,
    subject,
    html: injectTenantLogoHtml(rawHtml, Boolean(attachments?.length)),
    idempotencyKey: `quote-invite-${quoteRequest.id}-${Date.now()}`,
  });

  if (delivery.status === "accepted") {
    const sentAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("procurement_quote_requests")
      .update({
        email_sent_at: sentAt,
        email_sent_to: recipientEmail,
        email_provider: sender.channel,
        updated_by: auth.user.id,
        updated_at: sentAt,
      })
      .eq("id", quoteRequest.id)
      .eq("tenant_id", tenantId);

    if (updateError) {
      console.error("E-mail enviado, mas falhou ao registrar rastreio:", updateError.message);
    }

    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_id: auth.user.id,
      action: "SEND_EMAIL",
      entity: "procurement_quote_requests",
      entity_id: quoteRequest.id,
      details: {
        process_id: quoteRequest.process_id,
        process_number: processRow.number,
        provider: sender.channel,
        recipient_masked: maskRecipient(recipientEmail),
        outcome: "accepted",
      },
    });

    return response(
      {
        success: true,
        outcome: "accepted",
        email_sent_at: sentAt,
        email_sent_to: recipientEmail,
        email_provider: sender.channel,
        message: `Convite aceito pelo servidor de e-mail para ${recipientEmail}.`,
      },
      200,
      origin,
    );
  }

  await admin.from("audit_events").insert({
    tenant_id: tenantId,
    actor_id: auth.user.id,
    action: "SEND_EMAIL_FAILED",
    entity: "procurement_quote_requests",
    entity_id: quoteRequest.id,
    details: {
      process_id: quoteRequest.process_id,
      provider: sender.channel,
      recipient_masked: maskRecipient(recipientEmail),
      outcome: delivery.status,
      error_code: delivery.status === "rejected" ? delivery.errorCode : "UNCERTAIN",
    },
  });

  return response(
    {
      success: false,
      outcome: delivery.status,
      message:
        delivery.status === "uncertain"
          ? "Resultado incerto: não foi possível confirmar o aceite pelo provedor. Verifique antes de reenviar."
          : "O provedor recusou o envio do convite. Confira remetente, domínio e credenciais em Configurações > E-mail.",
    },
    200,
    origin,
  );
});
