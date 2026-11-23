import { describe, expect, it } from "vitest";
import {
  maskRecipient,
  normalizeTestRecipient,
  smtpPortSecurityError,
  testEmailCooldownRemaining,
  TEST_EMAIL_COOLDOWN_MS,
} from "../../supabase/functions/_shared/test-email.ts";

describe("normalizeTestRecipient", () => {
  it("normaliza trim e minúsculas", () => {
    expect(normalizeTestRecipient("  Artemiosouza99@Gmail.com ")).toBe("artemiosouza99@gmail.com");
  });
  it("rejeita listas, espaços e quebras de linha", () => {
    expect(normalizeTestRecipient("a@x.com,b@x.com")).toBeNull();
    expect(normalizeTestRecipient("a@x.com;b@x.com")).toBeNull();
    expect(normalizeTestRecipient("a @x.com")).toBeNull();
    expect(normalizeTestRecipient("a@x.com\nbcc:b@x.com")).toBeNull();
    expect(normalizeTestRecipient("Nome <a@x.com>")).toBeNull();
  });
  it("rejeita vazio, sem domínio, não-string e acima de 254", () => {
    expect(normalizeTestRecipient("")).toBeNull();
    expect(normalizeTestRecipient("a@x")).toBeNull();
    expect(normalizeTestRecipient(undefined)).toBeNull();
    expect(normalizeTestRecipient(`${"a".repeat(60)}@${"b".repeat(190)}.com`)).toBeNull();
  });
});

describe("testEmailCooldownRemaining", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  it("bloqueia novo teste antes de 60 s", () => {
    expect(testEmailCooldownRemaining("2026-11-18T11:59:30Z", now)).toBe(30_000);
  });
  it("libera após 60 s ou sem teste anterior", () => {
    expect(
      testEmailCooldownRemaining(new Date(now - TEST_EMAIL_COOLDOWN_MS).toISOString(), now),
    ).toBe(0);
    expect(testEmailCooldownRemaining(null, now)).toBe(0);
  });
});

it("mascara destinatário na auditoria", () => {
  expect(maskRecipient("artemiosouza99@gmail.com")).toBe("ar***@gmail.com");
});

describe("smtpPortSecurityError", () => {
  it("aceita somente pares aprovados pelo transporte", () => {
    expect(smtpPortSecurityError("465", "tls")).toBeNull();
    expect(smtpPortSecurityError(2525, "starttls")).toBeNull();
  });
  it("rejeita STARTTLS na porta 465 antes do envio", () => {
    expect(smtpPortSecurityError(465, "starttls")).toContain("465 exige TLS");
  });
  it("rejeita TLS na 2525 e outras portas", () => {
    expect(smtpPortSecurityError(2525, "tls")).toContain("2525 exige STARTTLS");
    expect(smtpPortSecurityError(587, "starttls")).toContain("porta 465");
  });
});
