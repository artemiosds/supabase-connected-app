import { describe, expect, it } from "vitest";
import { getAllowedOrigins, PREVIEW_ORIGIN } from "../../supabase/functions/_shared/origins";

describe("origens permitidas das Edge Functions", () => {
  it("mantém preview e localhost quando APP_URL ainda não foi configurada", () => {
    const allowed = getAllowedOrigins(() => undefined);
    expect(allowed.has(PREVIEW_ORIGIN)).toBe(true);
    expect(allowed.has("http://localhost:5173")).toBe(true);
    expect(allowed.has("https://origem-nao-cadastrada.example")).toBe(false);
  });

  it("em modo configurado aceita apenas a URL oficial e origens explicitamente listadas", () => {
    const env = (name: string) => {
      if (name === "APP_URL") return "https://app.exemplo.gov.br/";
      if (name === "INVITE_ALLOWED_ORIGINS") {
        return "https://homolog.exemplo.gov.br, https://app.exemplo.gov.br/path";
      }
      return undefined;
    };
    const allowed = getAllowedOrigins(env);
    expect(allowed.has("https://app.exemplo.gov.br")).toBe(true);
    expect(allowed.has("https://homolog.exemplo.gov.br")).toBe(true);
    expect(allowed.has(PREVIEW_ORIGIN)).toBe(false);
    expect(allowed.has("http://localhost:5173")).toBe(false);
  });

  it("falha fechada se APP_URL estiver inválida", () => {
    const allowed = getAllowedOrigins((name) =>
      name === "APP_URL" ? "javascript:alert(1)" : undefined,
    );
    expect(allowed.size).toBe(0);
  });

  it("ignora origens inseguras e entradas inválidas", () => {
    const env = (name: string) =>
      name === "INVITE_ALLOWED_ORIGINS"
        ? "http://site-externo.example, javascript:alert(1), https://usuario:senha@site.example, http://localhost:3000"
        : undefined;
    const allowed = getAllowedOrigins(env);
    expect(allowed.has("http://site-externo.example")).toBe(false);
    expect(allowed.has("http://localhost:3000")).toBe(true);
    expect(allowed.has("https://site.example")).toBe(false);
  });
});
