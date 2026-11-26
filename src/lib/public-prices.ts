import type { TablesInsert } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export type PublicPriceSearchMode = "catmat" | "pdm" | "catser";

export type PublicPriceRecord = {
  id: string;
  idCompra: string;
  numeroItemCompra: number;
  codigoItemCatalogo: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  brand: string | null;
  supplierName: string | null;
  supplierCnpj: string | null;
  organName: string;
  uasgCode: string;
  uasgName: string;
  uf: string;
  municipio: string;
  esfera: string;
  poder: string;
  purchaseDate: string;
  objectSummary: string;
  referenceIdentifier: string;
  referenceUrl: string;
};

export type PublicPriceStats = {
  count: number;
  min: number | null;
  median: number | null;
  average: number | null;
  max: number | null;
  cvPercent: number | null;
};

export type PublicPriceCatalogItem = {
  code: string;
  pdmCode: string | null;
  pdmName: string | null;
  description: string;
  className: string | null;
  ncm: string | null;
};

export type PublicPriceSearchResult = {
  queriedAt: string;
  sourceUrl: string;
  mode: PublicPriceSearchMode;
  code: string;
  catalogItem: PublicPriceCatalogItem | null;
  records: PublicPriceRecord[];
  stats: PublicPriceStats;
  totalRegistros: number;
  totalPaginas: number;
  pagina: number;
};

export function calcularEstatisticasPrecosPublicos(prices: number[]): PublicPriceStats {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length === 0) {
    return { count: 0, min: null, median: null, average: null, max: null, cvPercent: null };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0]!;
  const max = sorted[count - 1]!;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const average = sum / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const variance =
    count > 1 ? sorted.reduce((acc, v) => acc + (v - average) ** 2, 0) / (count - 1) : 0;
  const cvPercent = average > 0 ? (Math.sqrt(variance) / average) * 100 : 0;

  return {
    count,
    min: Number(min.toFixed(4)),
    median: Number(median.toFixed(4)),
    average: Number(average.toFixed(4)),
    max: Number(max.toFixed(4)),
    cvPercent: Number(cvPercent.toFixed(2)),
  };
}

export function montarPayloadCotacaoPublica(params: {
  tenantId: string;
  procurementItemId: string;
  itemQuantity: number;
  userId: string;
  queriedAt: string;
  record: PublicPriceRecord;
}): TablesInsert<"procurement_price_quotes"> {
  const { record } = params;
  const localidade = [record.municipio, record.uf].filter(Boolean).join("/");
  const sourceName = record.uf ? `${record.organName} (${record.uf})` : record.organName;
  const noteParts = [
    `Consulta oficial Dados Abertos Compras.gov.br (${record.codigoItemCatalogo})`,
    localidade ? `Localidade: ${localidade}` : null,
    record.unit ? `Unidade na compra: ${record.unit}` : null,
    record.supplierName ? `Fornecedor vencedor: ${record.supplierName}` : null,
    record.objectSummary ? record.objectSummary.slice(0, 220) : null,
  ].filter(Boolean);

  return {
    tenant_id: params.tenantId,
    procurement_item_id: params.procurementItemId,
    source_type: "painel_precos",
    source_name: sourceName.slice(0, 200),
    source_tax_id: record.supplierCnpj,
    reference_identifier: record.referenceIdentifier,
    reference_url: record.referenceUrl,
    accessed_at: params.queriedAt,
    quoted_at: record.purchaseDate,
    quantity: params.itemQuantity > 0 ? params.itemQuantity : 1,
    unit_price: record.unitPrice,
    delivery_cost: 0,
    brand_model: record.brand,
    notes: noteParts.join(" · "),
    created_by: params.userId,
    updated_by: params.userId,
  };
}

export async function consultarPrecosPublicos(params: {
  tenantId: string;
  mode: PublicPriceSearchMode;
  code: string;
  uf?: string;
  months?: 6 | 12 | 24;
  page?: number;
  pageSize?: number;
}): Promise<PublicPriceSearchResult> {
  const { data, error } = await supabase.functions.invoke<
    PublicPriceSearchResult & { error?: string }
  >("fetch-public-prices", {
    body: {
      tenant_id: params.tenantId,
      mode: params.mode,
      code: params.code.replace(/\D/g, ""),
      ...(params.uf?.trim() ? { uf: params.uf.trim().toUpperCase() } : {}),
      months: params.months ?? 12,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  });

  if (error) {
    let message = error.message || "Falha ao consultar o banco de preços públicos.";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const errBody = (await ctx.json().catch(() => null)) as Record<string, unknown> | null;
      if (errBody && typeof errBody["error"] === "string") {
        message = errBody["error"];
      }
    }
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida do serviço de preços públicos.");
  }
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
