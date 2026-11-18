/**
 * Pure CNPJ provider normalisation shared by the lookup-cnpj Edge Function and
 * the browser fallback. No Deno/Node APIs. Personal documents of partners
 * (CPF) are never copied into the normalised result.
 */
export interface JsonObject {
  [key: string]: unknown;
  cnpj?: unknown;
  razao_social?: unknown;
  razaoSocial?: unknown;
  nome_empresarial?: unknown;
  nome?: unknown;
  company_name?: unknown;
  legal_name?: unknown;
  nome_fantasia?: unknown;
  nomeFantasia?: unknown;
  fantasia?: unknown;
  trade_name?: unknown;
  descricao_tipo_de_logradouro?: unknown;
  logradouro?: unknown;
  street?: unknown;
  numero?: unknown;
  number?: unknown;
  complemento?: unknown;
  complement?: unknown;
  bairro?: unknown;
  neighborhood?: unknown;
  cep?: unknown;
  postal_code?: unknown;
  municipio?: unknown;
  municipio_nome?: unknown;
  city?: unknown;
  uf?: unknown;
  estado?: unknown;
  state?: unknown;
  ddd_telefone_1?: unknown;
  ddd_1?: unknown;
  telefone_1?: unknown;
  telefones?: unknown;
  ddd?: unknown;
  ddd_2?: unknown;
  telefone_2?: unknown;
  telefone?: unknown;
  phone?: unknown;
  email?: unknown;
  email_contato?: unknown;
  website?: unknown;
  site?: unknown;
  descricao_situacao_cadastral?: unknown;
  situacao?: unknown;
  situacaoCadastral?: unknown;
  situacao_cadastral?: unknown;
  data_situacao_cadastral?: unknown;
  data_situacao?: unknown;
  descricao_motivo_situacao_cadastral?: unknown;
  motivo_situacao_cadastral?: unknown;
  motivo_situacao?: unknown;
  data_inicio_atividade?: unknown;
  abertura?: unknown;
  data_abertura?: unknown;
  natureza_juridica?: unknown;
  descricao?: unknown;
  porte?: unknown;
  descricao_porte?: unknown;
  capital_social?: unknown;
  cnaes_secundarios?: unknown;
  atividades_secundarias?: unknown;
  qsa?: unknown;
  QSA?: unknown;
  socios?: unknown;
  success?: unknown;
  status?: unknown;
  message?: unknown;
  data?: unknown;
  estabelecimento?: unknown;
  endereco?: unknown;
  address?: unknown;
  atividade_principal?: unknown;
  cnae_fiscal?: unknown;
  cnae_fiscal_descricao?: unknown;
  cnae_principal?: unknown;
  codigo?: unknown;
  code?: unknown;
  id?: unknown;
  subclasse?: unknown;
  text?: unknown;
  description?: unknown;
  nome_socio?: unknown;
  name?: unknown;
  nome_socio_razao_social?: unknown;
  qualificacao_socio?: unknown;
  qual?: unknown;
  qualificacao?: unknown;
  cargo?: unknown;
  faixa_etaria?: unknown;
  faixaEtaria?: unknown;
  ddd1?: unknown;
  telefone1?: unknown;
}

export interface CnpjPartner {
  name: string;
  qualification: string | null;
  age_range: string | null;
}

export interface CnpjActivity {
  code: string | null;
  description: string | null;
}

export interface CnpjLookupData {
  cnpj: string | null;
  legal_name: string | null;
  trade_name: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  postal_code: string | null;
  city: string | null;
  state: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  registration_status: string | null;
  registration_status_date: string | null;
  registration_status_reason: string | null;
  opening_date: string | null;
  legal_nature: string | null;
  company_size: string | null;
  share_capital: number | null;
  main_activity: CnpjActivity | null;
  secondary_activities: CnpjActivity[];
  partners: CnpjPartner[];
  source: string;
  sources: string[];
  consulted_at: string;
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function onlyCnpjChars(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
    : "";
}

const STATUS_CODES: Record<string, string> = {
  "1": "NULA",
  "2": "ATIVA",
  "3": "SUSPENSA",
  "4": "INAPTA",
  "8": "BAIXADA",
};

function statusText(...values: unknown[]): string | null {
  const value = first(...values);
  if (!value) return null;
  return STATUS_CODES[value] ?? value.toUpperCase();
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.replace(/[^0-9.,-]/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function activity(code: unknown, description: unknown): CnpjActivity | null {
  const c = first(code);
  const d = first(description);
  if (!c && !d) return null;
  return { code: c, description: d };
}

function activityFrom(value: unknown): CnpjActivity | null {
  if (typeof value === "string" || typeof value === "number") return activity(value, null);
  const item = object(value);
  return activity(
    item.codigo ?? item.code ?? item.id ?? item.subclasse,
    item.descricao ?? item.text ?? item.description,
  );
}

function activities(value: unknown): CnpjActivity[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(activityFrom)
    .filter((item): item is CnpjActivity => Boolean(item && (item.code || item.description)))
    .filter((item) => item.code !== "0" && item.code !== "00.00-0-00");
}

function partners(value: unknown): CnpjPartner[] {
  if (!Array.isArray(value)) return [];
  const result: CnpjPartner[] = [];
  for (const entry of value) {
    const item = object(entry);
    const name = first(item.nome_socio, item.nome, item.name, item.nome_socio_razao_social);
    if (!name) continue;
    result.push({
      name,
      qualification: first(
        item.qualificacao_socio,
        item.qual,
        item.qualificacao,
        item.cargo,
        object(item.qualificacao_socio).descricao,
      ),
      age_range: first(item.faixa_etaria, item.faixaEtaria),
    });
  }
  return result;
}

function phone(...pairs: Array<[unknown, unknown]>): string | null {
  for (const [ddd, number] of pairs) {
    const d = first(ddd);
    const n = first(number);
    if (n) return d && !n.replace(/\D/g, "").startsWith(d) ? d + n : n;
  }
  return null;
}

export function mapCnpjProvider(raw: JsonObject, source: string, now = new Date()): CnpjLookupData {
  const data = object(raw.data ?? raw);
  const est = object(data.estabelecimento);
  const endereco = object(data.endereco ?? est.endereco);
  const address = object(data.address);
  const telefones = Array.isArray(data.telefones) ? object(data.telefones[0]) : {};

  const mainActivity =
    activity(data.cnae_fiscal, data.cnae_fiscal_descricao) ??
    (Array.isArray(data.atividade_principal) ? activityFrom(data.atividade_principal[0]) : null) ??
    activityFrom(data.cnae_principal ?? est.atividade_principal);

  return {
    cnpj: onlyCnpjChars(first(data.cnpj, est.cnpj)) || null,
    legal_name: first(
      data.razao_social,
      data.razaoSocial,
      data.nome_empresarial,
      data.nome,
      data.company_name,
      data.legal_name,
    ),
    trade_name: first(
      data.nome_fantasia,
      data.nomeFantasia,
      data.fantasia,
      est.nome_fantasia,
      data.trade_name,
    ),
    street: first(
      data.descricao_tipo_de_logradouro && data.logradouro
        ? `${String(data.descricao_tipo_de_logradouro)} ${String(data.logradouro)}`
        : null,
      data.logradouro,
      endereco.logradouro,
      address.street,
      est.logradouro,
      data.street,
    ),
    street_number: first(data.numero, endereco.numero, address.number, est.numero, data.number),
    complement: first(
      data.complemento,
      endereco.complemento,
      address.complement,
      est.complemento,
      data.complement,
    ),
    neighborhood: first(
      data.bairro,
      endereco.bairro,
      address.neighborhood,
      est.bairro,
      data.neighborhood,
    ),
    postal_code:
      first(data.cep, endereco.cep, address.postal_code, est.cep, data.postal_code)?.replace(
        /\D/g,
        "",
      ) || null,
    city: first(
      data.municipio,
      data.municipio_nome,
      data.city,
      endereco.municipio,
      address.city,
      est.municipio,
    ),
    state: first(data.uf, data.estado, endereco.uf, address.state, est.uf, data.state),
    contact_phone: phone(
      [data.ddd_telefone_1, null],
      [data.ddd_1, data.telefone_1],
      [telefones.ddd, telefones.numero],
      [est.ddd1, est.telefone1],
      [data.ddd_2, data.telefone_2],
      [null, data.telefone],
      [null, data.phone],
    ),
    contact_email: first(data.email, data.email_contato, est.email)?.toLowerCase() ?? null,
    website: first(data.website, data.site, est.website),
    registration_status: statusText(
      data.descricao_situacao_cadastral,
      data.situacao,
      data.situacaoCadastral,
      est.descricao_situacao_cadastral,
      data.situacao_cadastral,
      est.situacao_cadastral,
    ),
    registration_status_date: first(
      data.data_situacao_cadastral,
      data.data_situacao,
      est.data_situacao_cadastral,
    ),
    registration_status_reason: first(
      data.descricao_motivo_situacao_cadastral,
      data.motivo_situacao_cadastral,
      data.motivo_situacao,
    ),
    opening_date: first(data.data_inicio_atividade, data.abertura, data.data_abertura),
    legal_nature: first(data.natureza_juridica, object(data.natureza_juridica).descricao),
    company_size: first(data.porte, data.descricao_porte),
    share_capital: money(data.capital_social),
    main_activity: mainActivity,
    secondary_activities: activities(data.cnaes_secundarios ?? data.atividades_secundarias),
    partners: partners(data.qsa ?? data.QSA ?? data.socios),
    source,
    sources: [source],
    consulted_at: now.toISOString(),
  };
}

/** True when the provider explicitly returned a different CNPJ than requested. */
export function cnpjDivergente(result: CnpjLookupData, requested: string): boolean {
  return Boolean(result.cnpj && result.cnpj !== onlyCnpjChars(requested));
}

/**
 * Merges results in priority order: the first non-empty value wins per field.
 * Results with a divergent CNPJ or without a legal name are discarded.
 */
export function combineCnpjResults(
  results: CnpjLookupData[],
  requested: string,
): CnpjLookupData | null {
  const valid = results.filter((item) => item.legal_name && !cnpjDivergente(item, requested));
  const primary = valid[0];
  if (!primary) return null;
  const merged: CnpjLookupData = { ...primary, cnpj: onlyCnpjChars(requested), sources: [] };
  for (const item of valid) {
    merged.sources.push(item.source);
    for (const key of Object.keys(item) as Array<keyof CnpjLookupData>) {
      if (key === "source" || key === "sources" || key === "consulted_at" || key === "cnpj") continue;
      const current = merged[key];
      const empty =
        current === null || current === "" || (Array.isArray(current) && current.length === 0);
      const value = item[key];
      const hasValue =
        value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
      if (empty && hasValue) Object.assign(merged, { [key]: value });
    }
  }
  merged.source = merged.sources.join(", ");
  return merged;
}

export function providerFailed(raw: JsonObject): boolean {
  return (
    raw.success === false ||
    raw.status === "ERROR" ||
    (typeof raw.message === "string" && !raw.cnpj && !raw.razao_social)
  );
}

export type CnpjTone = "success" | "warning" | "destructive" | "neutral";

export function situacaoTone(status: string | null | undefined): CnpjTone {
  const value = (status ?? "").toUpperCase();
  if (!value) return "neutral";
  if (value.includes("ATIVA") && !value.includes("INATIVA")) return "success";
  if (value.includes("SUSPENSA")) return "warning";
  if (
    value.includes("INAPTA") ||
    value.includes("BAIXADA") ||
    value.includes("NULA")
  )
    return "destructive";
  return "neutral";
}
