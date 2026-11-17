import { getAllowedOrigins } from "../_shared/origins.ts";

type JsonObject = Record<string, unknown>;

function json(payload: JsonObject, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function mapData(raw: JsonObject, source: string) {
  const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as JsonObject;
  const endereco = data.endereco && typeof data.endereco === "object" ? data.endereco as JsonObject : {};
  return {
    cnpj: first(data.cnpj, data.cnpj_basico),
    legal_name: first(data.razao_social, data.razaoSocial, data.nome, data.company_name),
    trade_name: first(data.nome_fantasia, data.nomeFantasia, data.fantasia, data.trade_name),
    street: first(data.logradouro, endereco.logradouro, data.street),
    street_number: first(data.numero, endereco.numero, data.number),
    complement: first(data.complemento, endereco.complemento, data.complement),
    neighborhood: first(data.bairro, endereco.bairro, data.neighborhood),
    postal_code: first(data.cep, endereco.cep, data.postal_code),
    city: first(data.municipio, data.municipio_nome, data.city, endereco.municipio),
    state: first(data.uf, data.estado, endereco.uf, data.state),
    contact_phone: first(data.ddd_1 && data.telefone_1 ? String(data.ddd_1) + String(data.telefone_1) : null, data.telefone, data.phone),
    contact_email: first(data.email, data.email_contato),
    website: first(data.website, data.site),
    registration_status: first(data.descricao_situacao_cadastral, data.situacao_cadastral, data.situacaoCadastral, data.status),
    source,
    consulted_at: new Date().toISOString(),
  };
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PRIMUSGESTAO/1.0 (CNPJ lookup)" },
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESPONSE");
  return value as JsonObject;
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try { origin = new URL(request.headers.get("Origin") ?? "").origin; } catch { origin = ""; }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
    }});
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  try {
    const body = await request.json() as JsonObject;
    const cnpj = typeof body.cnpj === "string" ? body.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) {
      return json({ error: "Informe um CNPJ válido com 14 caracteres." }, 400, origin);
    }

    const providers: Array<{ name: string; url: string; enabled: boolean }> = [
      { name: "Minha Receita", url: `https://minhareceita.org/${cnpj}`, enabled: true },
      { name: "OpenCNPJ", url: `https://kitana.opencnpj.com/cnpj/${cnpj}`, enabled: /^[0-9]{14}$/.test(cnpj) },
      { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, enabled: true },
    ];
    const failures: string[] = [];
    for (const provider of providers) {
      if (!provider.enabled) continue;
      try {
        const raw = await fetchJson(provider.url);
        if (raw.success === false) throw new Error("NOT_FOUND");
        const mapped = mapData(raw, provider.name);
        if (!mapped.legal_name) throw new Error("MISSING_COMPANY_NAME");
        return json({ data: mapped }, 200, origin);
      } catch (error) {
        failures.push(`${provider.name}:${error instanceof Error ? error.message : "ERROR"}`);
      }
    }
    return json({
      error: "Não foi possível consultar este CNPJ nas fontes disponíveis. Você pode preencher os campos manualmente.",
      providers_attempted: failures,
    }, 503, origin);
  } catch {
    return json({ error: "Não foi possível processar a consulta de CNPJ." }, 400, origin);
  }
});
