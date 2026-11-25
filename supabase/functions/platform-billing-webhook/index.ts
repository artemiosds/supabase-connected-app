import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";
import {
  safeParseJsonObject,
  verifyMercadoPagoWebhookSignature,
  verifyStripeWebhookSignature,
} from "../_shared/billing-webhook.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 100_000) {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data: gwData, error: gwError } = await adminClient.rpc(
    "platform_billing_get_credentials",
  );
  if (gwError || !gwData || typeof gwData !== "object") {
    return jsonResponse({ ignored: true, reason: "gateway_not_configured" }, 200);
  }

  const gw = gwData as {
    provider: string;
    payments_enabled: boolean;
    credentials: Record<string, string>;
  };
  if (!gw.payments_enabled) {
    return jsonResponse({ ignored: true, reason: "payments_disabled" }, 200);
  }

  const url = new URL(request.url);
  const providerHint = url.searchParams.get("provider");
  const stripeSigHeader = request.headers.get("stripe-signature");
  const mpSigHeader = request.headers.get("x-signature");

  if (gw.provider === "stripe" || providerHint === "stripe" || stripeSigHeader) {
    const signatureCheck = await verifyStripeWebhookSignature({
      webhookSecret: gw.credentials.webhook_secret,
      signatureHeader: stripeSigHeader,
      rawBody,
    });
    if (!signatureCheck.valid) {
      return jsonResponse({ error: signatureCheck.error }, signatureCheck.status);
    }

    const event = safeParseJsonObject(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    } | null;
    if (!event) {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    const obj = event.data?.object ?? {};
    const eventType = event.type ?? "";
    const isPaidCheckout =
      eventType === "checkout.session.completed" && obj["payment_status"] === "paid";
    const isAsyncPaid = eventType === "checkout.session.async_payment_succeeded";

    if (!isPaidCheckout && !isAsyncPaid) {
      return jsonResponse({ received: true, ignored: true, type: eventType }, 200);
    }

    const metadata = (obj["metadata"] ?? {}) as Record<string, unknown>;
    const rawInvoiceId =
      typeof metadata["invoice_id"] === "string"
        ? metadata["invoice_id"]
        : typeof obj["client_reference_id"] === "string"
          ? obj["client_reference_id"]
          : null;
    const externalRef = typeof obj["id"] === "string" ? obj["id"] : rawInvoiceId;

    const { data: confirmResult, error: confirmError } = await adminClient.rpc(
      "platform_billing_confirm_webhook_payment",
      {
        p_external_reference: externalRef,
        p_invoice_id: rawInvoiceId && UUID_REGEX.test(rawInvoiceId) ? rawInvoiceId : null,
        p_provider: "stripe",
        p_event_id: event.id ?? null,
      },
    );
    if (confirmError) {
      console.error("Falha ao confirmar webhook Stripe:", confirmError.message);
      return jsonResponse({ error: "Confirmation failed" }, 500);
    }

    return jsonResponse({ received: true, result: confirmResult }, 200);
  }

  if (gw.provider === "mercado_pago" || providerHint === "mercado_pago") {
    const bodyJson = safeParseJsonObject(rawBody) as {
      type?: string;
      action?: string;
      data?: { id?: string | number };
      id?: string | number;
    } | null;
    if (!bodyJson) {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    const paymentId =
      bodyJson.data?.id !== undefined
        ? String(bodyJson.data.id)
        : url.searchParams.get("data.id") || url.searchParams.get("id");

    const signatureCheck = await verifyMercadoPagoWebhookSignature({
      webhookSecret: gw.credentials.webhook_secret,
      signatureHeader: mpSigHeader,
      requestId: request.headers.get("x-request-id"),
      paymentId,
    });
    if (!signatureCheck.valid) {
      return jsonResponse({ error: signatureCheck.error }, signatureCheck.status);
    }

    if (!paymentId || (bodyJson.type && bodyJson.type !== "payment")) {
      return jsonResponse({ received: true, ignored: true }, 200);
    }

    const accessToken = gw.credentials.access_token;
    if (!accessToken) {
      return jsonResponse({ error: "Missing Mercado Pago access token" }, 500);
    }

    const mpPaymentRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!mpPaymentRes.ok) {
      return jsonResponse({ error: "Failed to verify Mercado Pago payment" }, 502);
    }
    const mpPayment = (await mpPaymentRes.json()) as {
      id?: string | number;
      status?: string;
      external_reference?: string;
    };

    if (mpPayment.status !== "approved") {
      return jsonResponse({ received: true, status: mpPayment.status ?? "unknown" }, 200);
    }

    const extRef = mpPayment.external_reference ?? null;
    const { data: confirmResult, error: confirmError } = await adminClient.rpc(
      "platform_billing_confirm_webhook_payment",
      {
        p_external_reference: extRef ?? paymentId,
        p_invoice_id: extRef && UUID_REGEX.test(extRef) ? extRef : null,
        p_provider: "mercado_pago",
        p_event_id: String(mpPayment.id ?? paymentId),
      },
    );
    if (confirmError) {
      console.error("Falha ao confirmar webhook Mercado Pago:", confirmError.message);
      return jsonResponse({ error: "Confirmation failed" }, 500);
    }

    return jsonResponse({ received: true, result: confirmResult }, 200);
  }

  return jsonResponse({ ignored: true, reason: "unsupported_provider" }, 200);
});
