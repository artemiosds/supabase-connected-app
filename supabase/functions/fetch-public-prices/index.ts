import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getAllowedOrigins } from "../_shared/origins.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_CODE = /^\d{1,12}$/;
const UF_CODE = /^[A-Z]{2}$/;
const COMPRAS_GOV_BASE = "https://dadosabertos.compras.gov.br";

type SearchMode = "catmat" | "pdm" | "catser";

function response(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "application/json",
    },
  });
}

function isoDateDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return value.trim();
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

function computeStats(prices: number[]) {
  if (prices.length === 0) {
    return { count: 0, min: null, median: null, average: null, max: null, cvPercent: null };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0]!;
  const max = sorted[count - 1]!;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const average = sum / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const variance =
    count > 1 ? sorted.reduce((acc, val) => acc + (val - average) ** 2, 0) / (count - 1) : 0;
  const stddev = Math.sqrt(variance);
  const cvPercent = average > 0 ? (stddev / average) * 100 : 0;
  return {
    count,
    min: Number(min.toFixed(4)),
    median: Number(median.toFixed(4)),
    average: Number(average.toFixed(4)),
    max: Number(max.toFixed(4)),
    cvPercent: Number(cvPercent.toFixed(2)),
  };
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try {
    origin = new URL(request.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", {
      status: 403,
      headers: { "X-Content-Type-Options": "nosniff" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (request.method !== "POST") {
    return response({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    return response({ error: "Serviço de consulta indisponível." }, 503, origin);
  }

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return response({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return response({ error: "Corpo da solicitação inválido." }, 400, origin);
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "";
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  const ufRaw = typeof body.uf === "string" ? body.uf.trim().toUpperCase() : "";
  const monthsRaw = typeof body.months === "number" ? body.months : 12;
  const pageRaw = typeof body.page === "number" ? Math.trunc(body.page) : 1;
  const pageSizeRaw = typeof body.page_size === "number" ? Math.trunc(body.page_size) : 20;

  if (!UUID.test(tenantId)) {
    return response({ error: "Secretaria inválida para consulta." }, 400, origin);
  }
  if (modeRaw !== "catmat" && modeRaw !== "pdm" && modeRaw !== "catser") {
    return response({ error: "Modo de busca inválido. Use catmat, pdm ou catser." }, 400, origin);
  }
  const mode: SearchMode = modeRaw;

  if (!NUMERIC_CODE.test(code)) {
    return response({ error: "Informe um código numérico CATMAT, PDM ou CATSER válido." }, 400, origin);
  }
  if (ufRaw && !UF_CODE.test(ufRaw)) {
    return response({ error: "UF inválida. Informe 2 letras (ex: PA, SP)." }, 400, origin);
  }

  const months = monthsRaw === 6 || monthsRaw === 24 ? monthsRaw : 12;
  const page = Math.min(Math.max(pageRaw, 1), 50);
  const pageSize = Math.min(Math.max(pageSizeRaw, 10), 50);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous || !auth.user.email_confirmed_at) {
    return response({ error: "Entre com uma conta confirmada para consultar preços públicos." }, 401, origin);
  }

  const { data: tenantRow, error: tenantError } = await userClient
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError || !tenantRow) {
    return response({ error: "Sem permissão para consultar preços nesta Secretaria." }, 403, origin);
  }

  const dataFim = new Date().toISOString().slice(0, 10);
  const dataInicio = isoDateDaysAgo(months * 30);

  const priceUrl =
    mode === "catser"
      ? new URL(`${COMPRAS_GOV_BASE}/modulo-pesquisa-preco/3_consultarServico`)
      : new URL(`${COMPRAS_GOV_BASE}/modulo-pesquisa-preco/1_consultarMaterial`);

  priceUrl.searchParams.set("pagina", String(page));
  priceUrl.searchParams.set("tamanhoPagina", String(pageSize));
  priceUrl.searchParams.set("dataCompraInicio", dataInicio);
  priceUrl.searchParams.set("dataCompraFim", dataFim);

  if (mode === "catser") {
    priceUrl.searchParams.set("codigoItemCatalogo", code);
  } else {
    priceUrl.searchParams.set("tipo", mode === "pdm" ? "codigoPdm" : "codigoItemCatalogo");
    priceUrl.searchParams.set("codigo", code);
  }
  if (ufRaw) {
    priceUrl.searchParams.set("estado", ufRaw);
  }

  const catalogUrl =
    mode === "catmat"
      ? new URL(
          `${COMPRAS_GOV_BASE}/modulo-material/4_consultarItemMaterial?pagina=1&tamanhoPagina=10&codigoItem=${encodeURIComponent(code)}`,
        )
      : null;

  let priceResp: Response;
  let catalogPayload: Record<string, unknown> | null = null;
  try {
    const [pResp, cResp] = await Promise.all([
      fetch(priceUrl.href, {
        headers: { Accept: "application/json", "User-Agent": "PrimusGestao/1.0" },
        signal: AbortSignal.timeout(15_000),
      }),
      catalogUrl
        ? fetch(catalogUrl.href, {
            headers: { Accept: "application/json", "User-Agent": "PrimusGestao/1.0" },
            signal: AbortSignal.timeout(10_000),
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    priceResp = pResp;
    if (cResp?.ok) {
      catalogPayload = (await cResp.json().catch(() => null)) as Record<string, unknown> | null;
    }
  } catch {
    return response(
      { error: "O portal Dados Abertos Compras.gov.br não respondeu a tempo. Tente novamente." },
      504,
      origin,
    );
  }

  if (priceResp.status === 204 || priceResp.status === 404) {
    return response(
      {
        queriedAt: new Date().toISOString(),
        sourceUrl: priceUrl.href,
        mode,
        code,
        catalogItem: null,
        records: [],
        stats: computeStats([]),
        totalRegistros: 0,
        totalPaginas: 0,
        pagina: page,
      },
      200,
      origin,
    );
  }

  if (priceResp.status === 429) {
    return response(
      { error: "Limite momentâneo de consultas no Compras.gov.br. Aguarde alguns segundos." },
      429,
      origin,
    );
  }

  if (!priceResp.ok) {
    return response(
      { error: `Falha ao consultar Compras.gov.br (HTTP ${priceResp.status}).` },
      502,
      origin,
    );
  }

  const rawData = (await priceResp.json().catch(() => null)) as Record<string, unknown> | null;
  const rows = Array.isArray(rawData?.resultado) ? rawData.resultado : [];
  const kindLabel = mode === "catser" ? "CATSER" : mode === "pdm" ? "PDM" : "CATMAT";

  const records = rows
    .map((entry: unknown) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const unitPrice = toFiniteNumber(item.precoUnitario);
      if (unitPrice === null || unitPrice <= 0) return null;

      const idCompra = normalizeText(item.idCompra) || String(item.idCompra ?? "");
      const idItemCompra = normalizeText(item.idItemCompra) || String(item.idItemCompra ?? "");
      const numeroItemCompra = toFiniteNumber(item.numeroItemCompra) ?? 1;
      const catalogCode = String(item.codigoItemCatalogo ?? code);
      const organName = normalizeText(item.nomeOrgao) || normalizeText(item.nomeUasg) || "Órgão Público";
      const uf = normalizeText(item.estado);
      const municipio = normalizeText(item.municipio);
      const supplierCnpjRaw = normalizeText(item.niFornecedor);
      const purchaseDate = normalizeText(item.dataResultado) || normalizeText(item.dataCompra) || dataFim;

      return {
        id: `${idCompra}-${idItemCompra || numeroItemCompra}`,
        idCompra,
        numeroItemCompra,
        codigoItemCatalogo: catalogCode,
        description: normalizeText(item.descricaoItem),
        unit:
          normalizeText(item.siglaUnidadeFornecimento) ||
          normalizeText(item.nomeUnidadeFornecimento) ||
          normalizeText(item.siglaUnidadeMedida) ||
          normalizeText(item.nomeUnidadeMedida) ||
          "UN",
        quantity: toFiniteNumber(item.quantidade) ?? 1,
        unitPrice,
        brand: normalizeText(item.marca) || null,
        supplierName: normalizeText(item.nomeFornecedor) || null,
        supplierCnpj: supplierCnpjRaw ? formatCnpj(supplierCnpjRaw) : null,
        organName,
        uasgCode: normalizeText(item.codigoUasg),
        uasgName: normalizeText(item.nomeUasg),
        uf,
        municipio,
        esfera: normalizeText(item.esfera),
        poder: normalizeText(item.poder),
        purchaseDate: purchaseDate.slice(0, 10),
        objectSummary: normalizeText(item.objetoCompra),
        referenceIdentifier: `Compras.gov.br #${idCompra} · ${kindLabel} ${catalogCode} · Item ${numeroItemCompra}`,
        referenceUrl: priceUrl.href,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const catalogRows = Array.isArray(catalogPayload?.resultado) ? catalogPayload.resultado : [];
  const firstCatalog =
    catalogRows[0] && typeof catalogRows[0] === "object"
      ? (catalogRows[0] as Record<string, unknown>)
      : null;

  const catalogItem = firstCatalog
    ? {
        code: String(firstCatalog.codigoItem ?? code),
        pdmCode: firstCatalog.codigoPdm ? String(firstCatalog.codigoPdm) : null,
        pdmName: normalizeText(firstCatalog.nomePdm) || null,
        description: normalizeText(firstCatalog.descricaoItem),
        className: normalizeText(firstCatalog.nomeClasse) || null,
        ncm: normalizeText(firstCatalog.codigo_ncm) || null,
      }
    : null;

  const stats = computeStats(records.map((r) => r.unitPrice));

  return response(
    {
      queriedAt: new Date().toISOString(),
      sourceUrl: priceUrl.href,
      mode,
      code,
      catalogItem,
      records,
      stats,
      totalRegistros: toFiniteNumber(rawData?.totalRegistros) ?? records.length,
      totalPaginas: toFiniteNumber(rawData?.totalPaginas) ?? 1,
      pagina: page,
    },
    200,
    origin,
  );
});
