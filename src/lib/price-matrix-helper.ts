import {
  calcularResumoDePrecos,
  contarFontesDistintas,
  precoUnitarioComFrete,
  type ItemMapa,
  type CotacaoMapa,
} from "./pesquisa-precos";

export type MatrixItem = ItemMapa & { is_active?: boolean; estimated_price_source?: string };
export type MatrixQuote = CotacaoMapa & {
  supplier_id?: string | null;
  evidence_storage_path?: string | null;
};
export type MatrixApproval = { procurement_item_id: string; status: string };
export type BatchMethod = "mediana" | "menor" | "media";

function sourceKey(q: MatrixQuote) {
  return q.supplier_id
    ? "supplier:" + q.supplier_id
    : q.source_tax_id?.trim()
      ? "tax:" + q.source_tax_id.replace(/[^a-z0-9]/gi, "").toUpperCase()
      : "source:" + (q.source_type ?? "") + ":" + q.source_name.trim().toLocaleLowerCase("pt-BR");
}

export function buildPriceMatrix(items: MatrixItem[], quotes: MatrixQuote[]) {
  const active = items.filter((i) => i.is_active !== false);
  const ids = new Set(active.map((i) => i.id));
  const valid = quotes.filter(
    (q) =>
      q.is_active !== false && ids.has(q.procurement_item_id) && precoUnitarioComFrete(q) !== null,
  );
  const sources = new Map<string, string>();
  for (const quote of valid) sources.set(sourceKey(quote), quote.source_name);
  const columns = [...sources]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || a.id.localeCompare(b.id));
  const rows = [...active]
    .sort((a, b) => a.line_number - b.line_number)
    .map((item) => {
      const itemQuotes = valid.filter((q) => q.procurement_item_id === item.id);
      const cells: Record<string, { id: string; price: number }[]> = {};
      for (const q of itemQuotes)
        (cells[sourceKey(q)] ??= []).push({ id: q.id, price: precoUnitarioComFrete(q)! });
      return { item, cells, summary: calcularResumoDePrecos(itemQuotes) };
    });
  return { columns, rows };
}

export function isApproved(item: MatrixItem, approvals: MatrixApproval[]) {
  return (
    (item.estimated_price_source === undefined || item.estimated_price_source === "approved") &&
    approvals.some((a) => a.procurement_item_id === item.id && a.status === "approved")
  );
}
export function prepareBatchApprovalPayload(
  items: MatrixItem[],
  quotes: MatrixQuote[],
  approvals: MatrixApproval[],
  method: BatchMethod,
  standardJustification: string,
  exceptionalJustification = "",
) {
  const eligibleItems: { itemId: string; description: string; samplesCount: number }[] = [];
  const ineligibleItems: { itemId: string; description: string; reason: string }[] = [];
  for (const { item, summary } of buildPriceMatrix(items, quotes).rows) {
    const active = quotes.filter((q) => q.procurement_item_id === item.id && q.is_active !== false);
    let reason = "";
    if (isApproved(item, approvals)) reason = "Já aprovado";
    else if (
      !["mediana", "menor", "media"].includes(method) ||
      standardJustification.trim().length < 10
    )
      reason = "Justificativa do método: mínimo de 10 caracteres.";
    else if (!summary.quantidade) reason = "Sem cotações válidas";
    else if (active.some((q) => precoUnitarioComFrete(q) === null || q.total_price === null))
      reason = "Revise as cotações com valores incompletos.";
    else if (
      active.some(
        (q) =>
          q.source_type === "fornecedor" &&
          (!q.evidence_storage_path ||
            !q.evidence_file_name ||
            !q.evidence_mime_type ||
            !q.supplier_selection_justification ||
            !q.supplier_consultation_sent_at ||
            !q.supplier_consultation_response_deadline ||
            !q.source_tax_id ||
            !q.source_contact_name ||
            !q.source_contact_email ||
            !q.source_contact_phone ||
            !q.source_address),
      )
    )
      reason = "Proposta formal incompleta";
    else if (
      (summary.quantidade < 3 || contarFontesDistintas(active) < 3) &&
      exceptionalJustification.trim().length < 10
    )
      reason = "Exige justificativa excepcional (mínimo de 10 caracteres).";
    if (reason) ineligibleItems.push({ itemId: item.id, description: item.description, reason });
    else
      eligibleItems.push({
        itemId: item.id,
        description: item.description,
        samplesCount: summary.quantidade,
      });
  }
  return { eligibleItems, ineligibleItems };
}
