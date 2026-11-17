/* eslint-disable prettier/prettier -- Edge Function formatting is validated by Deno and behavior tests. */
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
    if (typeof value === "boolean") return value ? "Sim" : "Não";
  }
  return null;
}

function list(...values: unknown[]): unknown[] {
  for (const value of values) if (Array.isArray(value)) return value;
  return [];
}

function mapQsa(raw: JsonObject): JsonObject[] {
  const data = object(raw.data ?? raw);
  const company = object(data.empresa ?? data.company);
  const entries = list(
    data.socios, data.qsa, data.quadro_societario, data.quadroSocietario,
    data.administradores, company.socios, company.qsa,
  );
  return entries.slice(0, 300).flatMap((entry) => {
    const person = object(entry);
    const name = first(
      person.nomeSocio, person.nome_socio, person.nome, person.name,
      person.razao_social, person.nome_empresarial,
    );
    if (!name) return [];
    const qualification = first(
      person.qualificacao, person.qualificacao_socio, person.descricao,
      person.qualificacao_representante_legal, person.qualification,
    );
    const entryDate = first(
      person.data_entrada, person.dataEntrada, person.data_inicio,
      person.entry_date, person.data_inclusao,
    );
    const country = first(person.pais, person.pais_origem, person.country);
    const ageRange = first(person.faixaEtaria, person.faixa_etaria, person.age_range);
    // Não persistir CPF ou outros identificadores pessoais dos participantes.
    return [{
      name,
      qualification,
      entry_date: entryDate,
      country,
      age_range: ageRange,
    }];
  });
}

function mapData(raw: JsonObject, source: string) {
  const data = object(raw.data ?? raw);
  const company = object(data.empresa ?? data.company);
  const estabelecimento = object(data.estabelecimento ?? company.estabelecimento);
  const endereco = object(data.endereco ?? estabelecimento.endereco ?? company.endereco);
  const address = object(data.address);
  const activity = object(data.atividade_principal ?? data.cnae_fiscal ?? data.primary_activity);
  const allCnaes = list(data.cnaes, data.atividades_economicas);
  const cnaePrimary = first(
    data.cnae_fiscal, data.cnae_principal, data.cnaePrincipal,
    activity.codigo, activity.code, activity.cnae,
    object(allCnaes[0]).cnae, object(allCnaes[0]).codigo, object(allCnaes[0]).code,
  );
  const cnaePrimaryDescription = first(
    data.cnae_fiscal_descricao, data.cnae_principal_descricao,
    data.cnaePrincipalDescricao, activity.descricao, activity.description,
    object(allCnaes[0]).descricao, object(allCnaes[0]).description,
  );
  const secondaryInput = list(
    data.cnaes_secundarios, data.cnaesSecundarios,
    data.atividades_secundarias, data.secondary_activities,
  );
  const secondary = (secondaryInput.length ? secondaryInput : allCnaes.slice(1)).map((item) => {
    if (typeof item === "string") return { code: item, description: null };
    const row = object(item);
    return {
      code: first(row.codigo, row.code, row.cnae, row.subclasse),
      description: first(row.descricao, row.description, row.texto),
    };
  }).filter((item) => item.code || item.description);

  const ddd = first(data.ddd_1, estabelecimento.ddd1, estabelecimento.ddd_1);
  const telefone = first(data.telefone_1, data.telefone, estabelecimento.telefone1, estabelecimento.telefone_1);
  const legalName = first(
    data.razao_social, data.razaoSocial, data.nome_empresarial,
    data.nome, data.company_name, data.legal_name, company.razao_social,
    company.nome_empresarial, company.legal_name,
  );

  return {
    cnpj: first(data.cnpj, data.numero_inscricao, data.numero_inscricao_cnpj, estabelecimento.cnpj, company.cnpj),
    legal_name: legalName,
    trade_name: first(
      data.nome_fantasia, data.nomeFantasia, data.fantasia,
      estabelecimento.nome_fantasia, company.nome_fantasia, data.trade_name,
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
    contact_email: first(data.email, data.email_contato, estabelecimento.email, company.email),
    website: first(data.website, data.site, data.url, estabelecimento.website),
    registration_status: first(
      data.descricao_situacao_cadastral, data.situacao_cadastral,
      data.situacaoCadastral, estabelecimento.descricao_situacao_cadastral,
      estabelecimento.situacao_cadastral, data.status,
    ),
    registration_status_date: first(
      data.data_situacao_cadastral, data.dataSituacaoCadastral,
      data.data_situacao, data.registration_status_date,
    ),
    registration_status_reason: first(
      data.motivo_situacao_cadastral, data.motivoSituacaoCadastral,
      data.descricao_motivo_situacao_cadastral, data.registration_status_reason,
    ),
    opening_date: first(
      data.data_inicio_atividade, data.dataInicioAtividades,
      data.data_abertura, data.abertura, data.opening_date,
    ),
    legal_nature: first(
      data.natureza_juridica, data.naturezaJuridica, data.legal_nature,
    ),
    company_size: first(
      data.porte, data.descricao_porte, data.company_size,
    ),
    capital_social: first(data.capital_social, data.capitalSocial, data.share_capital),
    is_headquarters: first(data.matriz, data.descricao_identificador_matriz_filial, data.is_headquarters),
    simples_option: first(
      data.opcao_pelo_simples, data.opcaoSimples, data.simples,
      data.simples_nacional, data.simples_option,
    ),
    mei_option: first(
      data.opcao_pelo_mei, data.opcaoMei, data.mei, data.mei_option,
    ),
    primary_cnae: cnaePrimary,
    primary_cnae_description: cnaePrimaryDescription,
    secondary_cnaes: secondary,
    special_status: first(data.situacao_especial, data.situacaoEspecial, data.special_status),
    special_status_date: first(data.data_situacao_especial, data.dataSituacaoEspecial),
    qsa: mapQsa(raw),
    source,
  };
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PRIMUSGESTAO/1.2 (CNPJ lookup)" },
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_RESPONSE");
  }
  return value as JsonObject;
}

function mergeSources(rows: Array<{ source: string; data: ReturnType<typeof mapData> }>, cnpj: string) {
  const merged: Record<string, unknown> = {};
  const sources: string[] = [];
  const qsa = new Map<string, JsonObject>();
  for (const row of rows) {
    const data = row.data as Record<string, unknown>;
    let contributed = false;
    for (const [key, value] of Object.entries(data)) {
      if (key === "source" || key === "qsa") continue;
      const empty = value === null || value === undefined || value === "";
      const emptyArray = Array.isArray(value) && value.length === 0;
      if ((merged[key] === undefined || merged[key] === null || merged[key] === "" ||
        (Array.isArray(merged[key]) && (merged[key] as unknown[]).length === 0)) && !empty && !emptyArray) {
        merged[key] = value;
        contributed = true;
      }
    }
    if (row.data.qsa.length) contributed = true;
    for (const person of row.data.qsa) {
      const key = String(person.name ?? "").normalize("NFKC").toLocaleLowerCase("pt-BR") +
        "|" + String(person.qualification ?? "").toLocaleLowerCase("pt-BR");
      if (key !== "|") qsa.set(key, person);
    }
    if (contributed) sources.push(row.source);
  }
  if (qsa.size) merged.qsa = [...qsa.values()].slice(0, 300);
  else merged.qsa = [];
  merged.cnpj = cnpj;
  merged.source = sources.join(" + ") || rows.map((row) => row.source).join(" + ");
  merged.sources = sources.length ? sources : rows.map((row) => row.source);
  merged.consulted_at = new Date().toISOString();
  return merged;
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

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  try {
    const body = await request.json() as JsonObject;
    const cnpj = typeof body.cnpj === "string"
      ? body.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "")
      : "";

    if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) {
      return json({ error: "Informe um CNPJ válido com 14 caracteres." }, 400, origin);
    }

    const providers = [
      { name: "Minha Receita", url: `https://minhareceita.org/${cnpj}`, enabled: true },
      { name: "OpenCNPJ", url: `https://kitana.opencnpj.com/cnpj/${cnpj}`, enabled: /^[0-9]{14}$/.test(cnpj) },
      { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, enabled: true },
    ].filter((provider) => provider.enabled);

    const settled = await Promise.all(providers.map(async (provider) => {
      try {
        const raw = await fetchJson(provider.url);
        if (raw.success === false || raw.status === "ERROR" || raw.message === "CNPJ não encontrado") {
          throw new Error("NOT_FOUND");
        }
        const mapped = mapData(raw, provider.name);
        const returnedCnpj = String(mapped.cnpj ?? "").replace(/[^A-Z0-9]/g, "").toUpperCase();
        if (returnedCnpj && returnedCnpj !== cnpj) throw new Error("CNPJ_MISMATCH");
        if (!mapped.legal_name) throw new Error("MISSING_COMPANY_NAME");
        return { ok: true as const, source: provider.name, data: mapped };
      } catch (error) {
        return {
          ok: false as const,
          source: provider.name,
          reason: error instanceof Error ? error.message : "ERROR",
        };
      }
    }));

    const successes = settled.filter((item): item is Extract<typeof item, { ok: true }> => item.ok);
    const failures = settled.filter((item): item is Extract<typeof item, { ok: false }> => !item.ok);
    if (!successes.length) {
      console.warn("lookup-cnpj: all providers failed", {
        cnpj_suffix: cnpj.slice(-4),
        providers_attempted: failures.map((item) => `${item.source}:${item.reason}`),
      });
      return json({
        error: "Não foi possível consultar este CNPJ nas fontes públicas disponíveis. Você pode preencher os campos manualmente ou tentar novamente.",
        providers_attempted: failures.map((item) => `${item.source}:${item.reason}`),
        retryable: failures.some((item) => !item.reason.includes("NOT_FOUND") && !item.reason.includes("MISSING_COMPANY_NAME")),
      }, 503, origin);
    }

    const data = mergeSources(successes, cnpj);
    return json({
      data: {
        ...data,
        registration_data: {
          registration_status: data.registration_status ?? null,
          registration_status_date: data.registration_status_date ?? null,
          registration_status_reason: data.registration_status_reason ?? null,
          opening_date: data.opening_date ?? null,
          legal_nature: data.legal_nature ?? null,
          company_size: data.company_size ?? null,
          capital_social: data.capital_social ?? null,
          is_headquarters: data.is_headquarters ?? null,
          simples_option: data.simples_option ?? null,
          mei_option: data.mei_option ?? null,
          primary_cnae: data.primary_cnae ?? null,
          primary_cnae_description: data.primary_cnae_description ?? null,
          secondary_cnaes: data.secondary_cnaes ?? [],
          special_status: data.special_status ?? null,
          special_status_date: data.special_status_date ?? null,
        },
      },
    }, 200, origin);
  } catch (error) {
    console.error("lookup-cnpj: invalid request", {
      reason: error instanceof Error ? error.message : "ERROR",
    });
    return json({ error: "Não foi possível processar a consulta de CNPJ." }, 400, origin);
  }
});
