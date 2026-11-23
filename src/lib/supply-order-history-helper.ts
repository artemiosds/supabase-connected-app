export interface SupplyOrderMovement {
  id: string;
  contract_item_id: string;
  movement_type: string;
  quantity: number;
  unit_value_snapshot: number;
  reason: string;
  reference_number: string | null;
  created_at: string;
}

export interface SupplyOrderContractItem {
  id: string;
  line_number: number;
  description: string;
  unit: string;
}

export interface GroupedSupplyOrder {
  referenceNumber: string;
  createdAt: string;
  reason: string;
  itemsCount: number;
  totalValue: number;
  items: Array<{
    itemId: string;
    lineNumber: number;
    description: string;
    unit: string;
    quantity: number;
    unitValue: number;
    subtotal: number;
  }>;
}

/** Agrupa consumos com referência, preservando o valor histórico e ignorando estornos. */
export function groupMovementsBySupplyOrder(
  movements: SupplyOrderMovement[],
  items: SupplyOrderContractItem[],
): GroupedSupplyOrder[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const groups = new Map<
    string,
    {
      referenceNumber: string;
      createdAt: string;
      reason: string;
      itemRows: Map<string, GroupedSupplyOrder["items"][number]>;
    }
  >();

  for (const movement of movements) {
    const referenceNumber = movement.reference_number?.trim();
    if (
      movement.movement_type !== "consumption" ||
      !referenceNumber ||
      !Number.isFinite(Number(movement.quantity)) ||
      Number(movement.quantity) <= 0 ||
      !Number.isFinite(Number(movement.unit_value_snapshot)) ||
      Number(movement.unit_value_snapshot) < 0
    )
      continue;

    const item = itemsById.get(movement.contract_item_id);
    if (!item) continue;

    let group = groups.get(referenceNumber);
    if (!group) {
      group = {
        referenceNumber,
        createdAt: movement.created_at,
        reason: movement.reason,
        itemRows: new Map(),
      };
      groups.set(referenceNumber, group);
    } else if (movement.created_at < group.createdAt) {
      group.createdAt = movement.created_at;
      group.reason = movement.reason;
    }

    const existing = group.itemRows.get(item.id);
    const unitValue = Number(movement.unit_value_snapshot);
    const quantity = Number(movement.quantity);
    const subtotal = Math.round(quantity * unitValue * 100) / 100;
    if (existing) {
      existing.quantity += quantity;
      existing.subtotal = Math.round((existing.subtotal + subtotal) * 100) / 100;
    } else {
      group.itemRows.set(item.id, {
        itemId: item.id,
        lineNumber: item.line_number,
        description: item.description,
        unit: item.unit,
        quantity,
        unitValue,
        subtotal,
      });
    }
  }

  return [...groups.values()]
    .map((group) => {
      const orderItems = [...group.itemRows.values()].sort(
        (left, right) =>
          left.lineNumber - right.lineNumber || left.itemId.localeCompare(right.itemId),
      );
      return {
        referenceNumber: group.referenceNumber,
        createdAt: group.createdAt,
        reason: group.reason,
        itemsCount: orderItems.length,
        totalValue:
          Math.round(orderItems.reduce((total, item) => total + item.subtotal, 0) * 100) / 100,
        items: orderItems,
      };
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.referenceNumber.localeCompare(right.referenceNumber),
    );
}
