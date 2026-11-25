const PREVIEW_HOST_SUFFIXES = [
  ".lovable.app",
  ".lovable.dev",
  ".lovableproject.com",
  ".gptengineer.app",
] as const;

function normalizeHostname(rawHost: string | null): string {
  if (!rawHost) return "";
  const first = rawHost.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.replace(/:\d+$/, "");
}

export function extractRequestHostname(request: Request): string {
  const forwardedHost = normalizeHostname(request.headers.get("x-forwarded-host"));
  if (forwardedHost) return forwardedHost;
  const host = normalizeHostname(request.headers.get("host"));
  if (host) return host;
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLovablePreviewHost(hostname: string): boolean {
  if (!hostname) return false;
  return PREVIEW_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedProto) {
    return forwardedProto.toLowerCase() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildContentSecurityPolicy(hostname: string): string {
  const frameAncestors = isLovablePreviewHost(hostname)
    ? "'self' https://lovable.dev https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com https://*.gptengineer.app"
    : "'none'";

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://brasilapi.com.br https://minhareceita.org",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

export function buildSecurityHeaders(request: Request): Record<string, string> {
  const hostname = extractRequestHostname(request);
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(hostname),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };

  if (!isLovablePreviewHost(hostname)) {
    headers["X-Frame-Options"] = "DENY";
  }

  if (isHttpsRequest(request)) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

export function applySecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const securityHeaders = buildSecurityHeaders(request);

  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
