import { expect, it } from "vitest";
import { validateSupplyOrder, type SupplyOrderItemCandidate } from "./supply-order-helper";
const header = { referenceNumber: "OF nº 001/2026", reason: "Abastecimento da farmácia central" };
const row = (
  id: string,
  amount: number,
  available = 10,
  price = 2.55,
): SupplyOrderItemCandidate => ({
  itemId: id,
  description: "Item " + id,
  unit: "UNIDADE",
  unitValue: price,
  availableQuantity: available,
  requestedQuantity: amount,
});
it("calculates subtotals and total with currency rounding", () => {
  const result = validateSupplyOrder(header, [row("1", 2), row("2", 3, 10, 0.335)]);
  expect(result.isValid).toBe(true);
  expect(result.itemsToConsume.map((i) => i.subtotal)).toEqual([5.1, 1.01]);
  expect(result.totalValue).toBe(6.11);
});
it("rejects overdraw with item context", () => {
  const result = validateSupplyOrder(header, [row("1", 11)]);
  expect(result.isValid).toBe(false);
  expect(result.errors).toContain("Item 1: quantidade solicitada supera o saldo disponível.");
});
it("omits zero quantities", () => {
  const result = validateSupplyOrder(header, [row("1", 0), row("2", 1)]);
  expect(result.isValid).toBe(true);
  expect(result.itemsToConsume.map((i) => i.itemId)).toEqual(["2"]);
});
it("validates required header and at least one item", () => {
  expect(validateSupplyOrder({ referenceNumber: "", reason: "Curto" }, [row("1", 1)]).isValid).toBe(
    false,
  );
  expect(validateSupplyOrder(header, [row("1", 0)]).isValid).toBe(false);
});
it.each([-1, NaN, Infinity, 0.00001])("rejects invalid amount %s", (value) =>
  expect(validateSupplyOrder(header, [row("1", value)]).isValid).toBe(false),
);
it("rejects repeated item IDs", () =>
  expect(validateSupplyOrder(header, [row("1", 1), row("1", 1)]).isValid).toBe(false));
