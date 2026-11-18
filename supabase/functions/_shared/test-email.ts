// Validação pura (sem APIs Deno) do teste individual de e-mail institucional.
// Usada pela Edge Function tenant-integration-settings e pela tela de Integrações.
export const TEST_EMAIL_MAX_LENGTH = 254;
export const TEST_EMAIL_COOLDOWN_MS = 60_000;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Retorna exatamente um endereço normalizado (trim + minúsculas) ou null se inválido. */
export function normalizeTestRecipient(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TEST_EMAIL_MAX_LENGTH) return null;
  // Rejeita espaços internos, quebras de linha e listas (vírgula/ponto e vírgula).
  if (/[\s,;<>"]/.test(trimmed)) return null;
  const normalized = trimmed.toLowerCase();
  if ((normalized.match(/@/g) ?? []).length !== 1) return null;
  const local = normalized.split("@")[0] ?? "";
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes(".."))
    return null;
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

/** Milissegundos restantes de espera entre testes; 0 quando liberado. */
export function testEmailCooldownRemaining(
  lastTestAt: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!lastTestAt) return 0;
  const last = Date.parse(lastTestAt);
  if (Number.isNaN(last)) return 0;
  const remaining = last + TEST_EMAIL_COOLDOWN_MS - now;
  return remaining > 0 ? Math.min(remaining, TEST_EMAIL_COOLDOWN_MS) : 0;
}

/** Mascara o destinatário para auditoria: ar***@gmail.com. */
export function maskRecipient(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Valida a combinação de porta e segurança suportada pelo transporte SMTP institucional. */
export function smtpPortSecurityError(
  port: number | string | null | undefined,
  security: string | null | undefined,
): string | null {
  const numericPort = Number(port);
  if (
    (numericPort === 465 && security === "tls") ||
    (numericPort === 2525 && security === "starttls")
  )
    return null;
  if (numericPort === 465)
    return "A porta SMTP 465 exige TLS, não STARTTLS. Selecione TLS e salve antes de testar.";
  if (numericPort === 2525)
    return "A porta SMTP 2525 exige STARTTLS. Selecione STARTTLS e salve antes de testar.";
  return "Use TLS na porta 465 ou STARTTLS na porta 2525, conforme o transporte autorizado.";
}
