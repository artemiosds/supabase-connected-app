import { expect, it } from "vitest";
import {
  buildPriceMatrix,
  prepareBatchApprovalPayload,
  type MatrixItem,
  type MatrixQuote,
} from "./price-matrix-helper";
const items: MatrixItem[] = [
  { id: "a", line_number: 1, description: "Seringa", unit: "UN", quantity: 10 },
  { id: "b", line_number: 2, description: "Gaze", unit: "UN", quantity: 5 },
];
const quote = (id: string, source: string, price: number, freight = 0): MatrixQuote => ({
  id,
  procurement_item_id: "a",
  source_name: source,
  supplier_id: source,
  quoted_at: "2026-11-22",
  quantity: 10,
  unit_price: price,
  delivery_cost: freight,
  total_price: price * 10 + freight,
  selected_for_estimate: false,
  is_active: true,
});
const quotes = [
  quote("1", "A", 10, 20),
  quote("2", "B", 11),
  quote("3", "A", 13),
  { ...quote("4", "C", 1), is_active: false },
];
it("groups distinct suppliers, preserves multiple quotes and highlights effective minimum", () => {
  const matrix = buildPriceMatrix(items, quotes);
  expect(matrix.columns.map((c) => c.label)).toEqual(["A", "B"]);
  expect(matrix.rows[0]?.cells["supplier:A"]?.map((c) => c.price)).toEqual([12, 13]);
  expect(matrix.rows[0]?.summary).toMatchObject({
    menor: 11,
    mediana: 12,
    media: 12,
    quantidade: 3,
  });
});
it("separates missing samples and approved items", () => {
  const result = prepareBatchApprovalPayload(items, quotes, [], "mediana", "Justificativa válida");
  expect(result.eligibleItems.map((i) => i.itemId)).toEqual(["a"]);
  expect(result.ineligibleItems[0]?.reason).toBe("Sem cotações válidas");
  expect(
    prepareBatchApprovalPayload(
      items,
      quotes,
      [{ procurement_item_id: "a", status: "approved" }],
      "media",
      "Justificativa válida",
    ).eligibleItems,
  ).toHaveLength(0);
});
it("blocks incomplete method justification and requires exception for two samples", () => {
  expect(prepareBatchApprovalPayload(items, quotes, [], "mediana", " ").eligibleItems).toHaveLength(
    0,
  );
  expect(
    prepareBatchApprovalPayload(items, quotes.slice(0, 2), [], "menor", "Justificativa válida")
      .eligibleItems,
  ).toHaveLength(0);
  expect(
    prepareBatchApprovalPayload(
      items,
      quotes.slice(0, 2),
      [],
      "menor",
      "Justificativa válida",
      "Exceção fundamentada",
    ).eligibleItems,
  ).toHaveLength(1);
});
it("excludes formal supplier proposals without evidence", () => {
  expect(
    prepareBatchApprovalPayload(
      items,
      [{ ...quotes[0]!, source_type: "fornecedor" }],
      [],
      "mediana",
      "Justificativa válida",
      "Exceção fundamentada",
    ).eligibleItems,
  ).toHaveLength(0);
});
