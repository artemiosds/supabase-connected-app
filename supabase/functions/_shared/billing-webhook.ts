export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
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

export function parseSignatureHeaderMulti(header: string): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  for (const segment of header.split(",")) {
    const [rawKey, ...rest] = segment.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (!key || !value) continue;
    if (!parts[key]) parts[key] = [];
    parts[key].push(value);
  }
  return parts;
}

export function isTimestampWithinWindow(
  rawTimestamp: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  if (!/^\d{10,13}$/.test(rawTimestamp)) return false;
  const parsed = Number(rawTimestamp);
  if (!Number.isFinite(parsed)) return false;
  const tsSeconds = rawTimestamp.length >= 13 ? Math.floor(parsed / 1000) : parsed;
  const nowSeconds = Math.floor(nowMs / 1000);
  return Math.abs(nowSeconds - tsSeconds) <= toleranceSeconds;
}

export function safeParseJsonObject(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type SignatureCheckResult =
  { valid: true } | { valid: false; status: number; error: string };

export async function verifyStripeWebhookSignature(params: {
  webhookSecret?: string | null;
  signatureHeader?: string | null;
  rawBody: string;
  nowMs?: number;
}): Promise<SignatureCheckResult> {
  const { webhookSecret, signatureHeader, rawBody, nowMs = Date.now() } = params;
  if (!webhookSecret) {
    return { valid: false, status: 503, error: "Stripe webhook secret is not configured" };
  }
  if (!signatureHeader) {
    return { valid: false, status: 401, error: "Missing Stripe signature" };
  }

  const parts = parseSignatureHeaderMulti(signatureHeader);
  const timestamp = parts["t"]?.[0];
  const signatures = parts["v1"] ?? [];
  if (!timestamp || signatures.length === 0) {
    return { valid: false, status: 401, error: "Malformed Stripe signature" };
  }

  if (!isTimestampWithinWindow(timestamp, nowMs)) {
    return { valid: false, status: 401, error: "Expired or invalid Stripe signature timestamp" };
  }

  const computed = (await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`)).toLowerCase();
  const matchesAny = signatures.some((sig) => constantTimeEqual(computed, sig.toLowerCase()));
  if (!matchesAny) {
    return { valid: false, status: 401, error: "Invalid Stripe signature" };
  }

  return { valid: true };
}

export async function verifyMercadoPagoWebhookSignature(params: {
  webhookSecret?: string | null;
  signatureHeader?: string | null;
  requestId?: string | null;
  paymentId?: string | null;
  nowMs?: number;
}): Promise<SignatureCheckResult> {
  const { webhookSecret, signatureHeader, requestId = "", paymentId, nowMs = Date.now() } = params;

  if (!webhookSecret) {
    return {
      valid: false,
      status: 503,
      error: "Mercado Pago webhook secret is not configured",
    };
  }
  if (!signatureHeader) {
    return { valid: false, status: 401, error: "Missing Mercado Pago signature" };
  }
  if (!paymentId) {
    return { valid: false, status: 401, error: "Missing payment identifier for signature check" };
  }

  const parts = parseSignatureHeaderMulti(signatureHeader);
  const ts = parts["ts"]?.[0];
  const v1 = parts["v1"]?.[0];
  if (!ts || !v1) {
    return { valid: false, status: 401, error: "Invalid Mercado Pago signature" };
  }

  if (!isTimestampWithinWindow(ts, nowMs)) {
    return {
      valid: false,
      status: 401,
      error: "Expired or invalid Mercado Pago signature timestamp",
    };
  }

  const normalizedId = paymentId.toLowerCase();
  const manifest = `id:${normalizedId};request-id:${requestId ?? ""};ts:${ts};`;
  const computed = (await hmacSha256Hex(webhookSecret, manifest)).toLowerCase();
  if (!constantTimeEqual(computed, v1.toLowerCase())) {
    return { valid: false, status: 401, error: "Signature mismatch" };
  }

  return { valid: true };
}
