import { describe, expect, it } from "vitest";
import { groupMovementsBySupplyOrder } from "./supply-order-history-helper";

const items = [
  { id: "item-a", line_number: 1, description: "Soro", unit: "FRASCO" },
  { id: "item-b", line_number: 2, description: "Gaze", unit: "PACOTE" },
];
const movements = [
  {
    id: "m1",
    contract_item_id: "item-a",
    movement_type: "consumption",
    quantity: 2,
    unit_value_snapshot: 10,
    reason: "Abastecimento mensal",
    reference_number: "OF 001/2026",
    created_at: "2026-11-20T10:00:00.000Z",
  },
  {
    id: "m2",
    contract_item_id: "item-b",
    movement_type: "consumption",
    quantity: 3,
    unit_value_snapshot: 5,
    reason: "Abastecimento mensal",
    reference_number: "OF 001/2026",
    created_at: "2026-11-20T10:01:00.000Z",
  },
];

describe("groupMovementsBySupplyOrder", () => {
  it("groups different contract items with the same OF reference", () => {
    const [order] = groupMovementsBySupplyOrder(movements, items);
    expect(order?.referenceNumber).toBe("OF 001/2026");
    expect(order?.items.map((item) => item.itemId)).toEqual(["item-a", "item-b"]);
    expect(order?.createdAt).toBe("2026-11-20T10:00:00.000Z");
  });

  it("calculates the distinct item count and total from historical unit values", () => {
    const [order] = groupMovementsBySupplyOrder(movements, items);
    expect(order?.itemsCount).toBe(2);
    expect(order?.totalValue).toBe(35);
  });

  it("ignores unreferenced entries, reversals, and orphan item movements", () => {
    const [order] = groupMovementsBySupplyOrder(
      [
        ...movements,
        { ...movements[0]!, id: "m3", reference_number: null },
        { ...movements[0]!, id: "m4", movement_type: "reversal", reference_number: "OF 002/2026" },
        {
          ...movements[0]!,
          id: "m5",
          contract_item_id: "missing",
          reference_number: "OF 003/2026",
        },
      ],
      items,
    );
    expect(order?.referenceNumber).toBe("OF 001/2026");
    expect(order?.totalValue).toBe(35);
    expect(groupMovementsBySupplyOrder([], items)).toEqual([]);
  });

  it("sorts orders by their earliest movement in descending chronological order", () => {
    const orders = groupMovementsBySupplyOrder(
      [
        ...movements,
        {
          ...movements[0]!,
          id: "m3",
          reference_number: "OF 002/2026",
          created_at: "2026-11-21T09:00:00.000Z",
        },
      ],
      items,
    );
    expect(orders.map((order) => order.referenceNumber)).toEqual(["OF 002/2026", "OF 001/2026"]);
  });

  it("combines repeated item movements without counting duplicate item rows", () => {
    const [order] = groupMovementsBySupplyOrder(
      [
        ...movements,
        { ...movements[0]!, id: "m3", quantity: 1, created_at: "2026-11-20T10:02:00.000Z" },
      ],
      items,
    );
    expect(order?.itemsCount).toBe(2);
    expect(order?.items[0]).toMatchObject({ quantity: 3, subtotal: 30 });
    expect(order?.totalValue).toBe(45);
  });
});
