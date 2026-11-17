import { getAllowedOrigins } from "../_shared/origins.ts";

type JsonObject = Record<string, unknown>;
type Cnae = { code: string; description: string };
type QsaMember = { name: string; qualification: string | null; entry_date: string | null; country: string | null };

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
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function first(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
function truthyBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["sim", "s", "true", "1"].includes(normalized)) return true;
      if (["não", "nao", "n", "false", "0"].includes(normalized)) return false;
    }
  }
  return null;
}
function mapCnaes(value: unknown): Cnae[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = object(item);
    const code = first(row.codigo, row.code, row.subclasse, row.cnae, row.id);
    const description = first(row.descricao, row.description, row.nome);
    return code || description ? [{ code: code ?? "", description: description ?? "" }] : [];
  }).slice(0, 100);
}
function mapQsa(value: unknown): QsaMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = object(item);
    const name = first(row.nome_socio, row.nome, row.name, row.razao_social, row.nome_empresarial);
    if (!name) return [];
    return [{
      name,
      qualification: first(row.qualificacao_socio, row.qualificacao, row.qualification, row.qualificacao_representante_legal),
      entry_date: first(row.data_entrada_sociedade, row.data_entrada, row.entry_date),
      country: first(row.pais, row.country),
    }];
  }).slice(0, 300);
}

function mapData(raw: JsonObject, source: string) {
  const data = object(raw.data ?? raw);
  const estabelecimento = object(data.estabelecimento ?? data.establishment);
  const endereco = object(data.endereco ?? estabelecimento.endereco);
  const address = object(data.address);
  const atividadePrincipal = object(data.atividade_principal ?? data.cnae_fiscal);
  const primaryCode = first(data.cnae_fiscal, data.cnae_principal?.codigo, atividadePrincipal.codigo, data.primary_cnae?.code);
  const primaryDescription = first(data.cnae_fiscal_descricao, data.cnae_principal?.descricao, atividadePrincipal.descricao, data.primary_cnae?.description);
  const secondary = mapCnaes(data.cnaes_secundarios ?? data.atividades_secundarias ?? data.secondary_cnaes);
  const qsa = mapQsa(data.qsa ?? data.quadro_societario ?? data.socios ?? data.shareholders);
  const ddd = first(data.ddd_1, estabelecimento.ddd1, estabelecimento.ddd_1);
  const telefone = first(data.telefone_1, data.telefone, estabelecimento.telefone1, estabelecimento.telefone_1);
  const simples = object(data.simples);
  const mei = object(data.mei);

  return {
    cnpj: first(data.cnpj, estabelecimento.cnpj),
    legal_name: first(data.razao_social, data.razaoSocial, data.nome_empresarial, data.company_name, data.legal_name),
    trade_name: first(data.nome_fantasia, data.nomeFantasia, data.fantasia, estabelecimento.nome_fantasia, data.trade_name),
    street: first(data.logradouro, endereco.logradouro, address.street, estabelecimento.logradouro, data.street),
    street_number: first(data.numero, endereco.numero, address.number, estabelecimento.numero, data.number),
    complement: first(data.complemento, endereco.complemento, address.complement, estabelecimento.complemento, data.complement),
    neighborhood: first(data.bairro, endereco.bairro, address.neighborhood, estabelecimento.bairro, data.neighborhood),
    postal_code: first(data.cep, endereco.cep, address.postal_code, estabelecimento.cep, data.postal_code),
    city: first(data.municipio, data.municipio_nome, data.city, endereco.municipio, address.city, estabelecimento.municipio),
    state: first(data.uf, data.estado, endereco.uf, address.state, estabelecimento.uf, data.state),
    contact_phone: first(
      ddd && telefone ? ddd + telefone : null,
      data.ddd_2 && data.telefone_2 ? String(data.ddd_2) + String(data.telefone_2) : null,
      data.ddd && data.phone ? String(data.ddd) + String(data.phone) : null,
      estabelecimento.ddd_2 && estabelecimento.telefone_2 ? String(estabelecimento.ddd_2) + String(estabelecimento.telefone_2) : null,
      data.phone,
    ),
    contact_email: first(data.email, data.email_contato, estabelecimento.email),
    website: first(data.website, data.site, data.url, estabelecimento.website),
    registration_status: first(data.descricao_situacao_cadastral, data.situacao_cadastral, data.situacaoCadastral, estabelecimento.descricao_situacao_cadastral, estabelecimento.situacao_cadastral, data.status),
    registration_status_date: first(data.data_situacao_cadastral, data.dataSituacaoCadastral, estabelecimento.data_situacao_cadastral),
    registration_status_reason: first(data.motivo_situacao_cadastral, data.descricao_motivo_situacao_cadastral, estabelecimento.motivo_situacao_cadastral),
    opening_date: first(data.data_inicio_atividade, data.data_abertura, data.dataAbertura, estabelecimento.data_inicio_atividade),
    legal_nature: first(data.natureza_juridica, data.naturezaJuridica, data.legal_nature),
    company_size: first(data.porte, data.descricao_porte, data.company_size),
    primary_cnae: primaryCode || primaryDescription ? { code: primaryCode ?? "", description: primaryDescription ?? "" } : null,
    secondary_cnaes: secondary,
    share_capital: first(data.capital_social, data.capitalSocial, data.share_capital),
    is_mei: truthyBoolean(mei.optante, data.opcao_mei, data.is_mei),
    is_simples: truthyBoolean(simples.optante, data.opcao_simples, data.is_simples),
    qsa,
    source,
  };
}

function mergeNonEmpty(target: JsonObject, source: JsonObject) {
  for (const [key, value] of Object.entries(source)) {
    const empty = value === null || value === undefined || value === "" ||
      (Array.isArray(value) && value.length === 0);
    const current = target[key];
    const currentEmpty = current === null || current === undefined || current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (!empty && currentEmpty) target[key] = value;
    else if (Array.isArray(value) && value.length && Array.isArray(current) && current.length === 0) target[key] = value;
  }
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PRIMUSGESTAO/1.2 (CNPJ lookup)" },
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    }});
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  try {
    const body = await request.json() as JsonObject;
    const cnpj = typeof body.cnpj === "string" ? body.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) {
      return json({ error: "Informe um CNPJ válido com 14 caracteres." }, 400, origin);
    }

    const providers = [
      { name: "Minha Receita", url: `https://minhareceita.org/${cnpj}`, enabled: true },
      { name: "OpenCNPJ", url: `https://kitana.opencnpj.com/cnpj/${cnpj}`, enabled: /^[0-9]{14}$/.test(cnpj) },
      { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, enabled: /^[0-9]{14}$/.test(cnpj) },
    ];
    const failures: string[] = [];
    const merged: JsonObject = {};
    const successfulSources: string[] = [];

    const results = await Promise.all(providers.filter((p) => p.enabled).map(async (provider) => {
      try {
        const raw = await fetchJson(provider.url);
        if (raw.success === false || raw.status === "ERROR" || raw.message === "CNPJ não encontrado") {
          throw new Error("NOT_FOUND");
        }
        const mapped = mapData(raw, provider.name);
        if (!mapped.legal_name) throw new Error("MISSING_COMPANY_NAME");
        return { provider: provider.name, mapped, error: null as string | null };
      } catch (error) {
        return { provider: provider.name, mapped: null, error: error instanceof Error ? error.message : "ERROR" };
      }
    }));

    for (const result of results) {
      if (result.error) failures.push(`${result.provider}:${result.error}`);
      else if (result.mapped) {
        successfulSources.push(result.provider);
        mergeNonEmpty(merged, result.mapped as unknown as JsonObject);
      }
    }

    if (!merged.legal_name) {
      console.warn("lookup-cnpj: no provider returned a company", {
        cnpj_suffix: cnpj.slice(-4), providers_attempted: failures,
      });
      return json({
        error: "Não foi possível localizar este CNPJ nas fontes públicas consultadas. Verifique o número ou tente novamente mais tarde.",
        providers_attempted: failures,
        retryable: true,
      }, 503, origin);
    }

    merged.cnpj = cnpj;
    merged.source = successfulSources.join(" + ");
    merged.consulted_at = new Date().toISOString();
    return json({ data: merged, providers_attempted: failures }, 200, origin);
  } catch (error) {
    console.error("lookup-cnpj: invalid request", { reason: error instanceof Error ? error.message : "ERROR" });
    return json({ error: "Não foi possível processar a consulta de CNPJ." }, 400, origin);
  }
});
