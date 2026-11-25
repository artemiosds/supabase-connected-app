import { describe, expect, it } from "vitest";
import {
  hmacSha256Hex,
  safeParseJsonObject,
  verifyMercadoPagoWebhookSignature,
  verifyStripeWebhookSignature,
} from "../../supabase/functions/_shared/billing-webhook";

describe("billing-webhook security", () => {
  const nowMs = 1_760_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  it("recusa Mercado Pago sem webhook_secret configurado (fail-closed)", async () => {
    const result = await verifyMercadoPagoWebhookSignature({
      webhookSecret: "",
      signatureHeader: `ts=${nowSec},v1=deadbeef`,
      requestId: "req-1",
      paymentId: "12345",
      nowMs,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.status).toBe(503);
  });

  it("recusa Mercado Pago sem header x-signature mesmo com secret configurado", async () => {
    const result = await verifyMercadoPagoWebhookSignature({
      webhookSecret: "mp-secret-123",
      signatureHeader: null,
      requestId: "req-1",
      paymentId: "12345",
      nowMs,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.status).toBe(401);
  });

  it("aceita Mercado Pago com HMAC válido dentro da janela de tolerância", async () => {
    const secret = "mp-secret-123";
    const manifest = `id:987654;request-id:req-abc;ts:${nowSec};`;
    const v1 = await hmacSha256Hex(secret, manifest);

    const result = await verifyMercadoPagoWebhookSignature({
      webhookSecret: secret,
      signatureHeader: `ts=${nowSec},v1=${v1}`,
      requestId: "req-abc",
      paymentId: "987654",
      nowMs,
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejeita replay antigo no Mercado Pago e na Stripe", async () => {
    const expiredTs = nowSec - 601;
    const mpSig = await hmacSha256Hex("mp-secret", `id:100;request-id:req-1;ts:${expiredTs};`);
    const mpRes = await verifyMercadoPagoWebhookSignature({
      webhookSecret: "mp-secret",
      signatureHeader: `ts=${expiredTs},v1=${mpSig}`,
      requestId: "req-1",
      paymentId: "100",
      nowMs,
    });
    expect(mpRes.valid).toBe(false);

    const rawBody = JSON.stringify({ id: "evt_1" });
    const stripeSig = await hmacSha256Hex("whsec_test", `${expiredTs}.${rawBody}`);
    const stripeRes = await verifyStripeWebhookSignature({
      webhookSecret: "whsec_test",
      signatureHeader: `t=${expiredTs},v1=${stripeSig}`,
      rawBody,
      nowMs,
    });
    expect(stripeRes.valid).toBe(false);
  });

  it("aceita Stripe com rotação de múltiplas assinaturas v1 válidas na janela", async () => {
    const rawBody = JSON.stringify({ id: "evt_2", type: "checkout.session.completed" });
    const v1Valid = await hmacSha256Hex("whsec_new", `${nowSec}.${rawBody}`);
    const stripeRes = await verifyStripeWebhookSignature({
      webhookSecret: "whsec_new",
      signatureHeader: `t=${nowSec},v1=000000,v1=${v1Valid}`,
      rawBody,
      nowMs,
    });
    expect(stripeRes).toEqual({ valid: true });
  });

  it("parseia JSON com segurança sem lançar exceção em payload corrompido", () => {
    expect(safeParseJsonObject("{invalid")).toBeNull();
    expect(safeParseJsonObject("[1,2,3]")).toBeNull();
    expect(safeParseJsonObject('{"ok":true}')).toEqual({ ok: true });
  });
});
