import { parseBrazilianNumber, calculateItemTotal } from "./procurement-items-parser";

export type BatchQuoteItemRow = {
  itemId: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPriceText: string;
  brandModel: string;
  deliveryCostText: string;
};

export type BatchQuoteHeader = {
  supplierId?: string;
  sourceName: string;
  sourceType: string;
  sourceTaxId?: string;
  quotedAt: string;
  referenceIdentifier?: string;
};

export function parseBatchQuoteRows(rows: BatchQuoteItemRow[], header: BatchQuoteHeader) {
  const errorsByItem: Record<string, string> = {};
  const validInserts = [];
  const seen = new Set<string>();
  let totalCents = 0;
  for (const row of rows) {
    const price = parseBrazilianNumber(row.unitPriceText);
    if (!row.unitPriceText.trim() || price === 0) continue;
    const freight = row.deliveryCostText.trim() ? parseBrazilianNumber(row.deliveryCostText) : 0;
    const total = calculateItemTotal(row.quantity, price) + freight;
    if (
      seen.has(row.itemId) ||
      !Number.isFinite(price) ||
      price < 0 ||
      price >= 1e12 ||
      Number(price.toFixed(4)) !== price ||
      !Number.isFinite(freight) ||
      freight < 0 ||
      Number(freight.toFixed(2)) !== freight ||
      !Number.isFinite(total) ||
      total >= 1e14 ||
      row.quantity <= 0
    ) {
      errorsByItem[row.itemId] = `Item ${row.lineNumber}: confira quantidade, preço e frete.`;
      continue;
    }
    seen.add(row.itemId);
    totalCents += Math.round(total * 100);
    validInserts.push({
      procurement_item_id: row.itemId,
      supplier_id: header.supplierId || null,
      source_name: header.sourceName.trim(),
      source_type: header.sourceType,
      source_tax_id: header.sourceTaxId?.trim() || null,
      quoted_at: header.quotedAt,
      reference_identifier: header.referenceIdentifier?.trim() || null,
      quantity: row.quantity,
      unit_price: price,
      delivery_cost: freight,
      brand_model: row.brandModel.trim() || null,
    });
  }
  return { validInserts, errorsByItem, totalProposta: totalCents / 100 };
}
