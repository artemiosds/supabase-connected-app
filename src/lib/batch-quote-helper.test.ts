import { expect, it } from "vitest";
import { parseBatchQuoteRows, type BatchQuoteItemRow } from "./batch-quote-helper";
const header = {
  supplierId: "supplier",
  sourceName: "Distribuidora",
  sourceType: "fornecedor",
  quotedAt: "2026-11-22",
};
const row = (id: string, price: string, freight = ""): BatchQuoteItemRow => ({
  itemId: id,
  lineNumber: Number(id),
  description: "Material",
  quantity: 2,
  unit: "UNIDADE",
  unitPriceText: price,
  brandModel: "Marca",
  deliveryCostText: freight,
});
it("records three quoted items out of five and sums freight", () => {
  const result = parseBatchQuoteRows(
    [
      row("1", "15,80", "2,00"),
      row("2", ""),
      row("3", "1.250,00"),
      row("4", "0"),
      row("5", "3,50", "1,00"),
    ],
    header,
  );
  expect(result.validInserts.map((v) => v.procurement_item_id)).toEqual(["1", "3", "5"]);
  expect(result.totalProposta).toBe(2541.6);
  expect(result.errorsByItem).toEqual({});
});
it("reports negative and malformed numbers per item", () => {
  const result = parseBatchQuoteRows(
    [row("1", "-1"), row("2", "abc"), row("3", "12,50", "-2")],
    header,
  );
  expect(Object.keys(result.errorsByItem)).toEqual(["1", "2", "3"]);
  expect(result.validInserts).toHaveLength(0);
});
