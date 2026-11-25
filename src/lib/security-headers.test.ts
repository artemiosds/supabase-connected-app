import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "./security-headers";

describe("security-headers", () => {
  it("aplica anti-clickjacking estrito e HSTS em produção HTTPS", () => {
    const request = new Request("https://app.saude.gov.br/painel", {
      headers: { host: "app.saude.gov.br" },
    });
    const headers = buildSecurityHeaders(request);

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("unsafe-eval");
  });

  it("permite preview em iframe do editor Lovable sem bloquear a plataforma", () => {
    const request = new Request("https://meu-projeto.lovable.app/", {
      headers: { "x-forwarded-host": "meu-projeto.lovable.app", "x-forwarded-proto": "https" },
    });
    const headers = buildSecurityHeaders(request);

    expect(headers["X-Frame-Options"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'self' https://lovable.dev",
    );
  });

  it("não envia HSTS em HTTP local de desenvolvimento", () => {
    const request = new Request("http://localhost:3000/entrar");
    const headers = buildSecurityHeaders(request);

    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(buildContentSecurityPolicy("localhost")).toContain(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://brasilapi.com.br https://minhareceita.org",
    );
  });

  it("preserva body, status e content-type da resposta original", async () => {
    const request = new Request("https://app.saude.gov.br/");
    const original = new Response("<h1>Olá</h1>", {
      status: 201,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const secured = applySecurityHeaders(original, request);
    expect(secured.status).toBe(201);
    expect(secured.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(secured.headers.get("X-Frame-Options")).toBe("DENY");
    expect(await secured.text()).toBe("<h1>Olá</h1>");
  });
});
