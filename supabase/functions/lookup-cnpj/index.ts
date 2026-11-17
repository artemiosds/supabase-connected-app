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

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function mapData(raw: JsonObject, source: string) {
  const data = object(raw.data ?? raw);
  const estabelecimento = object(data.estabelecimento);
  const endereco = object(data.endereco ?? estabelecimento.endereco);
  const address = object(data.address);
  const ddd = first(data.ddd_1, estabelecimento.ddd1, estabelecimento.ddd_1);
  const telefone = first(data.telefone_1, data.telefone, estabelecimento.telefone1, estabelecimento.telefone_1);

  return {
    cnpj: first(data.cnpj, data.cnpj_basico, estabelecimento.cnpj),
    legal_name: first(
      data.razao_social, data.razaoSocial, data.nome_empresarial,
      data.nome, data.company_name, data.legal_name,
    ),
    trade_name: first(
      data.nome_fantasia, data.nomeFantasia, data.fantasia,
      estabelecimento.nome_fantasia, data.trade_name,
    ),
    street: first(
      data.logradouro, endereco.logradouro, address.street,
      estabelecimento.logradouro, data.street,
    ),
    street_number: first(
      data.numero, endereco.numero, address.number,
      estabelecimento.numero, data.number,
    ),
    complement: first(
      data.complemento, endereco.complemento, address.complement,
      estabelecimento.complemento, data.complement,
    ),
    neighborhood: first(
      data.bairro, endereco.bairro, address.neighborhood,
      estabelecimento.bairro, data.neighborhood,
    ),
    postal_code: first(
      data.cep, endereco.cep, address.postal_code,
      estabelecimento.cep, data.postal_code,
    ),
    city: first(
      data.municipio, data.municipio_nome, data.city,
      endereco.municipio, address.city, estabelecimento.municipio,
    ),
    state: first(
      data.uf, data.estado, endereco.uf, address.state,
      estabelecimento.uf, data.state,
    ),
    contact_phone: first(
      ddd && telefone ? ddd + telefone : null,
      data.ddd_2 && data.telefone_2 ? String(data.ddd_2) + String(data.telefone_2) : null,
      estabelecimento.ddd_2 && estabelecimento.telefone_2
        ? String(estabelecimento.ddd_2) + String(estabelecimento.telefone_2)
        : null,
      data.phone, estabelecimento.telefone,
    ),
    contact_email: first(data.email, data.email_contato, estabelecimento.email),
    website: first(data.website, data.site, data.url, estabelecimento.website),
    registration_status: first(
      data.descricao_situacao_cadastral, data.situacao_cadastral,
      data.situacaoCadastral, estabelecimento.descricao_situacao_cadastral,
      estabelecimento.situacao_cadastral, data.status,
    ),
    source,
    consulted_at: new Date().toISOString(),
  };
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

  try {
    const body = await request.json() as JsonObject;
    const cnpj = typeof body.cnpj === "string"
      ? body.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "")
      : "";

    if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) {
      return json({ error: "Informe um CNPJ válido com 14 caracteres." }, 400, origin);
    }

    const providers: Array<{ name: string; url: string; enabled: boolean }> = [
      { name: "Minha Receita", url: `https://minhareceita.org/${cnpj}`, enabled: true },
      {
        name: "OpenCNPJ",
        url: `https://kitana.opencnpj.com/cnpj/${cnpj}`,
        enabled: /^[0-9]{14}$/.test(cnpj),
      },
      { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, enabled: true },
    ];

    const failures: string[] = [];
    for (const provider of providers) {
      if (!provider.enabled) continue;
      try {
        const raw = await fetchJson(provider.url);
        if (raw.success === false || raw.status === "ERROR") {
          throw new Error("NOT_FOUND");
        }
        const mapped = mapData(raw, provider.name);
        if (!mapped.legal_name) throw new Error("MISSING_COMPANY_NAME");
        return json({ data: mapped }, 200, origin);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "ERROR";
        failures.push(`${provider.name}:${reason}`);
      }
    }

    // Keep diagnostics useful without logging the full CNPJ or any returned personal data.
    console.warn("lookup-cnpj: all providers failed", {
      cnpj_suffix: cnpj.slice(-4),
      providers_attempted: failures,
    });

    return json({
      error: "Não foi possível consultar este CNPJ nas fontes disponíveis. Você pode preencher os campos manualmente ou tentar novamente.",
      providers_attempted: failures,
      retryable: true,
    }, 503, origin);
  } catch (error) {
    console.error("lookup-cnpj: invalid request", {
      reason: error instanceof Error ? error.message : "ERROR",
    });
    return json({ error: "Não foi possível processar a consulta de CNPJ." }, 400, origin);
  }
});
