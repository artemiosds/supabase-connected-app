import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  combineCnpjResults,
  mapCnpjProvider,
  providerFailed,
  type CnpjLookupData,
} from "../_shared/cnpj-mapping.ts";

type JsonObject = Record<string, unknown>;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const userLookupHits = new Map<string, number[]>();

function isRateLimited(userId: string, nowMs: number = Date.now()): boolean {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const recent = (userLookupHits.get(userId) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    userLookupHits.set(userId, recent);
    return true;
  }
  recent.push(nowMs);
  userLookupHits.set(userId, recent);
  if (userLookupHits.size > 1000) {
    for (const [key, timestamps] of userLookupHits.entries()) {
      if (timestamps.every((ts) => ts <= cutoff)) {
        userLookupHits.delete(key);
      }
    }
  }
  return false;
}

function json(
  payload: JsonObject,
  status: number,
  origin: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
      ...extraHeaders,
    },
  });
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PRIMUSGESTAO/1.1 (CNPJ lookup)" },
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_RESPONSE");
  }
  return value as JsonObject;
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try {
    origin = new URL(request.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }

  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Serviço de consulta indisponível." }, 503, origin);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return json({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (
    authError ||
    !authData.user ||
    authData.user.is_anonymous ||
    !authData.user.email_confirmed_at
  ) {
    return json({ error: "Sessão autenticada e e-mail confirmado são obrigatórios." }, 401, origin);
  }

  if (isRateLimited(authData.user.id)) {
    return json(
      {
        error: "Limite temporário de consultas CNPJ atingido. Aguarde um minuto e tente novamente.",
      },
      429,
      origin,
      { "Retry-After": "60" },
    );
  }

  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Corpo da solicitação inválido." }, 400, origin);
    }
    const body = parsed as JsonObject;
    const cnpj =
      typeof body.cnpj === "string" ? body.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";

    if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) {
      return json({ error: "Informe um CNPJ válido com 14 caracteres." }, 400, origin);
    }

    const numeric = /^[0-9]{14}$/.test(cnpj);
    const providers: Array<{ name: string; url: string; enabled: boolean }> = [
      { name: "Minha Receita", url: `https://minhareceita.org/${cnpj}`, enabled: true },
      { name: "OpenCNPJ", url: `https://kitana.opencnpj.com/cnpj/${cnpj}`, enabled: numeric },
      { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, enabled: true },
      { name: "ReceitaWS", url: `https://receitaws.com.br/v1/cnpj/${cnpj}`, enabled: numeric },
    ].filter((provider) => provider.enabled);

    // All providers run in parallel with individual timeouts; one failure never blocks the others.
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const raw = await fetchJson(provider.url);
        if (providerFailed(raw)) throw new Error("NOT_FOUND");
        const mapped = mapCnpjProvider(raw, provider.name);
        if (!mapped.legal_name) throw new Error("MISSING_COMPANY_NAME");
        return mapped;
      }),
    );
    const failures: string[] = [];
    const results: CnpjLookupData[] = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") results.push(outcome.value);
      else
        failures.push(
          `${providers[index].name}:${outcome.reason instanceof Error ? outcome.reason.message : "ERROR"}`,
        );
    });

    const combined = combineCnpjResults(results, cnpj);
    if (combined) return json({ data: combined, providers_failed: failures }, 200, origin);
    if (results.length) failures.push("CNPJ_DIVERGENTE");

    // Keep diagnostics useful without logging the full CNPJ or any returned personal data.
    console.warn("lookup-cnpj: all providers failed", {
      cnpj_suffix: cnpj.slice(-4),
      providers_attempted: failures,
    });

    return json(
      {
        error:
          "Não foi possível consultar este CNPJ nas fontes disponíveis. Você pode preencher os campos manualmente ou tentar novamente.",
        providers_attempted: failures,
        retryable: true,
      },
      503,
      origin,
    );
  } catch (error) {
    console.error("lookup-cnpj: invalid request", {
      reason: error instanceof Error ? error.message : "ERROR",
    });
    return json({ error: "Não foi possível processar a consulta de CNPJ." }, 400, origin);
  }
});
