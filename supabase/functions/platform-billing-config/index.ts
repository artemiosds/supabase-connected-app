import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

function jsonResponse(payload: Record<string, unknown>, status: number, origin: string) {
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

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
}

function safeConfiguration(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    provider: row.provider,
    provider_other_name: row.provider_other_name,
    environment: row.environment,
    account_name: row.account_name,
    account_reference: row.account_reference,
    account_email: row.account_email,
    client_id: row.client_id,
    public_key: row.public_key,
    status: row.status,
    payments_enabled: Boolean(row.payments_enabled),
    has_credentials: Boolean(row.vault_secret_id),
    updated_at: row.updated_at,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SELECT_COLUMNS =
  "provider, provider_other_name, environment, account_name, account_reference, account_email, client_id, public_key, status, payments_enabled, updated_at, vault_secret_id";

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

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { error: "A configuração do serviço administrativo está incompleta." },
      503,
      origin,
    );
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  if (
    authError ||
    !authData.user ||
    authData.user.is_anonymous ||
    !authData.user.email_confirmed_at
  ) {
    return jsonResponse(
      { error: "Entre com uma conta confirmada do Administrador Master." },
      401,
      origin,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data: master, error: masterError } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (masterError || !master) {
    return jsonResponse({ error: "Acesso restrito ao Administrador Master ativo." }, 403, origin);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 20_000) {
    return jsonResponse({ error: "A solicitação excede o tamanho permitido." }, 413, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "O corpo da solicitação é inválido." }, 400, origin);
  }

  const action = body.action;
  if (action === "get") {
    const { data, error } = await adminClient
      .from("platform_payment_integrations")
      .select(SAFE_SELECT_COLUMNS)
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error("Falha ao carregar metadados da conta de cobrança:", error.message);
      return jsonResponse(
        { error: "Não foi possível carregar a configuração de cobrança." },
        500,
        origin,
      );
    }
    return jsonResponse(
      { configuration: safeConfiguration(data as Record<string, unknown> | null) },
      200,
      origin,
    );
  }

  if (action === "set_payments_enabled") {
    if (typeof body.enabled !== "boolean") {
      return jsonResponse({ error: "Informe o estado de ativação do gateway." }, 400, origin);
    }
    const { data: toggleData, error: toggleError } = await adminClient.rpc(
      "platform_billing_set_payments_enabled",
      { p_actor_id: authData.user.id, p_enabled: body.enabled },
    );
    if (toggleError) {
      return jsonResponse({ error: toggleError.message }, 400, origin);
    }
    const { data: row } = await adminClient
      .from("platform_payment_integrations")
      .select(SAFE_SELECT_COLUMNS)
      .eq("id", 1)
      .maybeSingle();
    return jsonResponse(
      {
        result: toggleData,
        configuration: safeConfiguration(row as Record<string, unknown> | null),
      },
      200,
      origin,
    );
  }

  if (action === "create_payment_link") {
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
    if (!UUID_REGEX.test(invoiceId)) {
      return jsonResponse({ error: "Fatura inválida." }, 400, origin);
    }

    const { data: gwData, error: gwError } = await adminClient.rpc(
      "platform_billing_get_credentials",
    );
    if (gwError || !gwData || typeof gwData !== "object") {
      return jsonResponse(
        { error: "Configure e salve as credenciais do gateway antes de gerar links." },
        400,
        origin,
      );
    }

    const gw = gwData as {
      provider: string;
      environment: string;
      payments_enabled: boolean;
      credentials: Record<string, string>;
    };
    if (!gw.payments_enabled) {
      return jsonResponse(
        { error: "Ative o processamento do gateway na aba de credenciais antes de gerar links." },
        400,
        origin,
      );
    }

    const { data: invoice, error: invError } = await adminClient
      .from("platform_invoices")
      .select("id, tenant_id, reference_month, amount, status, due_date")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invError || !invoice) {
      return jsonResponse({ error: "Fatura não encontrada." }, 404, origin);
    }
    if (!["pending", "overdue"].includes(invoice.status)) {
      return jsonResponse(
        { error: "Somente faturas pendentes ou em atraso podem gerar link de pagamento." },
        400,
        origin,
      );
    }

    const { data: tenant } = await adminClient
      .from("tenants")
      .select("name, trade_name, billing_email, contact_email")
      .eq("id", invoice.tenant_id)
      .maybeSingle();

    const tenantLabel = tenant?.trade_name || tenant?.name || "Secretaria";
    const payerEmail = tenant?.billing_email || tenant?.contact_email || undefined;
    const amountNum = Number(invoice.amount ?? 0);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return jsonResponse({ error: "A fatura precisa ter valor maior que zero." }, 400, origin);
    }

    const webhookUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/platform-billing-webhook?provider=${gw.provider}`;
    let paymentUrl = "";
    let externalReference = invoice.id;

    if (gw.provider === "mercado_pago") {
      const accessToken = gw.credentials.access_token;
      if (!accessToken) {
        return jsonResponse(
          { error: "Access Token do Mercado Pago não encontrado no cofre." },
          400,
          origin,
        );
      }
      const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              title: `Primus Gestão · ${tenantLabel} (${invoice.reference_month})`,
              quantity: 1,
              currency_id: "BRL",
              unit_price: Number(amountNum.toFixed(2)),
            },
          ],
          external_reference: invoice.id,
          notification_url: webhookUrl,
          ...(payerEmail ? { payer: { email: payerEmail } } : {}),
        }),
      });
      const mpBody = (await mpResponse.json().catch(() => ({}))) as Record<string, unknown>;
      if (!mpResponse.ok) {
        console.error("Erro Mercado Pago preference:", mpBody);
        return jsonResponse(
          {
            error:
              typeof mpBody.message === "string"
                ? `Mercado Pago: ${mpBody.message}`
                : "Não foi possível gerar o link no Mercado Pago.",
          },
          502,
          origin,
        );
      }
      paymentUrl = String(
        gw.environment === "sandbox"
          ? mpBody.sandbox_init_point || mpBody.init_point || ""
          : mpBody.init_point || mpBody.sandbox_init_point || "",
      );
      externalReference = invoice.id;
    } else if (gw.provider === "stripe") {
      const secretKey = gw.credentials.secret_key || gw.credentials.access_token;
      if (!secretKey) {
        return jsonResponse(
          { error: "Secret Key da Stripe não encontrada no cofre." },
          400,
          origin,
        );
      }
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", `${origin}/admin-master?billing=paid`);
      params.set("cancel_url", `${origin}/admin-master?billing=cancelled`);
      params.set("client_reference_id", invoice.id);
      params.set("metadata[invoice_id]", invoice.id);
      params.set("line_items[0][quantity]", "1");
      params.set("line_items[0][price_data][currency]", "brl");
      params.set("line_items[0][price_data][unit_amount]", String(Math.round(amountNum * 100)));
      params.set(
        "line_items[0][price_data][product_data][name]",
        `Primus Gestão · ${tenantLabel} (${invoice.reference_month})`,
      );
      if (payerEmail) params.set("customer_email", payerEmail);

      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      const stripeBody = (await stripeRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!stripeRes.ok || typeof stripeBody.url !== "string") {
        console.error("Erro Stripe checkout:", stripeBody);
        return jsonResponse(
          { error: "Não foi possível criar a sessão de pagamento na Stripe." },
          502,
          origin,
        );
      }
      paymentUrl = stripeBody.url;
      externalReference = typeof stripeBody.id === "string" ? stripeBody.id : invoice.id;
    } else {
      return jsonResponse(
        { error: "Geração automática de link suportada para Mercado Pago e Stripe." },
        400,
        origin,
      );
    }

    if (!paymentUrl) {
      return jsonResponse({ error: "O gateway não retornou uma URL de pagamento." }, 502, origin);
    }

    const { data: updatedInvoice, error: attachError } = await adminClient.rpc(
      "platform_billing_attach_payment_link",
      {
        p_actor_id: authData.user.id,
        p_invoice_id: invoice.id,
        p_payment_url: paymentUrl,
        p_external_reference: externalReference,
      },
    );
    if (attachError) {
      return jsonResponse({ error: attachError.message }, 400, origin);
    }

    return jsonResponse(
      { payment_url: paymentUrl, external_reference: externalReference, invoice: updatedInvoice },
      200,
      origin,
    );
  }

  if (action === "disconnect") {
    const { data, error } = await adminClient.rpc("platform_billing_disconnect", {
      p_actor_id: authData.user.id,
    });
    if (error) {
      console.error("Falha ao desconectar conta de cobrança:", error.message);
      return jsonResponse(
        { error: "Não foi possível desconectar a conta de cobrança." },
        400,
        origin,
      );
    }
    const { data: row } = await adminClient
      .from("platform_payment_integrations")
      .select(SAFE_SELECT_COLUMNS)
      .eq("id", 1)
      .maybeSingle();
    return jsonResponse(
      {
        result: data,
        configuration: safeConfiguration(row as Record<string, unknown> | null),
      },
      200,
      origin,
    );
  }

  if (action !== "save") {
    return jsonResponse({ error: "Ação não reconhecida." }, 400, origin);
  }

  const provider = cleanText(body.provider, 30);
  const environment = cleanText(body.environment, 20);
  const accountName = cleanText(body.account_name, 160);
  const providerOtherName = cleanText(body.provider_other_name, 100);
  const accountReference = cleanText(body.account_reference, 160);
  const accountEmail = cleanText(body.account_email, 254);
  const clientId = cleanText(body.client_id, 512);
  const publicKey = cleanText(body.public_key, 1024);

  if (!provider || !["mercado_pago", "stripe", "other"].includes(provider)) {
    return jsonResponse({ error: "Selecione um provedor válido." }, 400, origin);
  }
  if (!environment || !["sandbox", "production"].includes(environment)) {
    return jsonResponse({ error: "Selecione um ambiente válido." }, 400, origin);
  }
  if (!accountName) {
    return jsonResponse({ error: "Informe o nome da conta de cobrança." }, 400, origin);
  }
  if (provider === "other" && !providerOtherName) {
    return jsonResponse({ error: "Informe o nome do provedor." }, 400, origin);
  }

  const secretInput = body.credentials;
  if (
    secretInput !== undefined &&
    (typeof secretInput !== "object" || secretInput === null || Array.isArray(secretInput))
  ) {
    return jsonResponse({ error: "O conjunto de credenciais privadas é inválido." }, 400, origin);
  }

  const credentials = (secretInput ?? {}) as Record<string, unknown>;
  const secretBundle: Record<string, string> = {};
  for (const key of ["access_token", "secret_key", "client_secret", "webhook_secret"]) {
    const value = cleanText(credentials[key], 4096);
    if (value) secretBundle[key] = value;
  }

  if (Object.keys(secretBundle).length > 4) {
    return jsonResponse({ error: "Quantidade de credenciais inválida." }, 400, origin);
  }

  const { data, error } = await adminClient.rpc("platform_billing_save_credentials", {
    p_actor_id: authData.user.id,
    p_provider: provider,
    p_provider_other_name: providerOtherName,
    p_environment: environment,
    p_account_name: accountName,
    p_account_reference: accountReference,
    p_account_email: accountEmail,
    p_client_id: clientId,
    p_public_key: publicKey,
    p_secret_bundle: Object.keys(secretBundle).length ? secretBundle : null,
  });

  if (error) {
    console.error("Falha ao salvar configuração de cobrança:", error.message);
    return jsonResponse(
      {
        error:
          error.message.includes("Informe") ||
          error.message.includes("Cadastre") ||
          error.message.includes("trocar")
            ? error.message
            : "Não foi possível salvar as credenciais de cobrança. Revise os campos e tente novamente.",
      },
      400,
      origin,
    );
  }

  const { data: row, error: readError } = await adminClient
    .from("platform_payment_integrations")
    .select(SAFE_SELECT_COLUMNS)
    .eq("id", 1)
    .single();

  if (readError) {
    console.error(
      "Credenciais salvas, mas metadados não puderam ser recarregados:",
      readError.message,
    );
    return jsonResponse({ saved: true, result: data, configuration: null }, 200, origin);
  }

  return jsonResponse(
    {
      saved: true,
      result: data,
      configuration: safeConfiguration(row as Record<string, unknown>),
    },
    200,
    origin,
  );
});
