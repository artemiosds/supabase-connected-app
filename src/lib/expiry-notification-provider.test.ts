import { describe, expect, it } from "vitest";
import { sendResendEmail } from "./expiry-notification-provider";

const input = {
  apiKey: "resend_synthetic_key_never_sent",
  from: "Gestão de Fornecedores <avisos@example.invalid>",
  to: "gestor@example.invalid",
  subject: "[Gestão de Fornecedores] Contrato — 123/2026",
  html: "<p>Mensagem sintética de teste.</p>",
  idempotencyKey: "gfs-expiry:synthetic:contract:123:user:30:2026-12-13",
};

describe("transporte de e-mail Resend", () => {
  it("envia o payload autenticado com chave de idempotência e aceita o ID do provedor", async () => {
    let requestedUrl: RequestInfo | URL | undefined;
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      return new Response(JSON.stringify({ id: "resend-synthetic-message-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(sendResendEmail(input, fetcher)).resolves.toEqual({
      status: "accepted",
      providerMessageId: "resend-synthetic-message-001",
    });
    expect(String(requestedUrl)).toBe("https://api.resend.com/emails");
    expect(requestedInit?.method).toBe("POST");
    const headers = new Headers(requestedInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer resend_synthetic_key_never_sent");
    expect(headers.get("Idempotency-Key")).toBe(input.idempotencyKey);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    });
  });

  it("classifica rejeição HTTP 4xx como falha conhecida e recuperável", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "synthetic invalid recipient" }), { status: 422 });
    await expect(sendResendEmail(input, fetcher)).resolves.toEqual({
      status: "rejected",
      errorCode: "RESEND_HTTP_422",
    });
  });

  it("mantém HTTP 5xx como incerto para evitar possível envio duplicado", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "synthetic upstream error" }), { status: 503 });
    await expect(sendResendEmail(input, fetcher)).resolves.toEqual({ status: "uncertain" });
  });

  it("mantém uma resposta 2xx sem ID do provedor como incerta", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ accepted: true }), { status: 200 });
    await expect(sendResendEmail(input, fetcher)).resolves.toEqual({ status: "uncertain" });
  });

  it("mantém falha de rede como incerta porque o provedor pode ter aceitado a mensagem", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("synthetic network interruption");
    };
    await expect(sendResendEmail(input, fetcher)).resolves.toEqual({ status: "uncertain" });
  });
});
