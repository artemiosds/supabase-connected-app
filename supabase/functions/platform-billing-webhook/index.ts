import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseSignatureParts(header: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const segment of header.split(",")) {
    const [k, ...rest] = segment.split("=");
    if (k && rest.length > 0) parts[k.trim()] = rest.join("=").trim();
  }
  return parts;
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
    const webhookSecret = gw.credentials.webhook_secret;
    if (!webhookSecret || !stripeSigHeader) {
      return jsonResponse({ error: "Missing Stripe signature or webhook secret" }, 401);
    }

    const parts = parseSignatureParts(stripeSigHeader);
    const timestamp = parts["t"];
    const expectedV1 = parts["v1"];
    if (!timestamp || !expectedV1) {
      return jsonResponse({ error: "Malformed Stripe signature" }, 401);
    }

    const computed = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
    if (!constantTimeEqual(computed.toLowerCase(), expectedV1.toLowerCase())) {
      return jsonResponse({ error: "Invalid Stripe signature" }, 401);
    }

    const event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
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
    const bodyJson = JSON.parse(rawBody) as {
      type?: string;
      action?: string;
      data?: { id?: string | number };
      id?: string | number;
    };

    const paymentId =
      bodyJson.data?.id !== undefined
        ? String(bodyJson.data.id)
        : url.searchParams.get("data.id") || url.searchParams.get("id");

    const webhookSecret = gw.credentials.webhook_secret;
    if (webhookSecret && mpSigHeader) {
      const parts = parseSignatureParts(mpSigHeader);
      const ts = parts["ts"];
      const v1 = parts["v1"];
      const requestId = request.headers.get("x-request-id") ?? "";
      if (!ts || !v1 || !paymentId) {
        return jsonResponse({ error: "Invalid Mercado Pago signature" }, 401);
      }
      const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
      const computed = await hmacSha256Hex(webhookSecret, manifest);
      if (!constantTimeEqual(computed.toLowerCase(), v1.toLowerCase())) {
        return jsonResponse({ error: "Signature mismatch" }, 401);
      }
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
        p_event_id: paymentId,
      },
    );
    if (confirmError) {
      console.error("Falha ao confirmar webhook Mercado Pago:", confirmError.message);
      return jsonResponse({ error: "Confirmation failed" }, 500);
    }

    return jsonResponse({ received: true, result: confirmResult }, 200);
  }

  return jsonResponse({ received: true, ignored: true }, 200);
});
