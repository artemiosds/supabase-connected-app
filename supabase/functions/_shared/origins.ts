export type EnvironmentReader = (name: string) => string | null | undefined;

export const PREVIEW_ORIGIN =
  "https://id-preview--0f44b9ce-9cdb-4fc9-892b-0bd2cf70b798.lovable.app";

function normalizeWebOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (
      url.protocol === "http:" &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1"
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Development defaults are available only while APP_URL is unset.
 * Once APP_URL is configured, only the canonical application origin and
 * explicitly listed origins are accepted. An invalid APP_URL fails closed.
 */
export function getAllowedOrigins(readEnv: EnvironmentReader): Set<string> {
  const appUrl = readEnv("APP_URL")?.trim() ?? "";
  const configuredOrigins = (readEnv("INVITE_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (appUrl) {
    const appOrigin = normalizeWebOrigin(appUrl);
    if (!appOrigin) return new Set();
    return new Set(
      [appOrigin, ...configuredOrigins]
        .map(normalizeWebOrigin)
        .filter((origin): origin is string => Boolean(origin)),
    );
  }

  return new Set(
    [PREVIEW_ORIGIN, "http://localhost:5173", ...configuredOrigins]
      .map(normalizeWebOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );
}
