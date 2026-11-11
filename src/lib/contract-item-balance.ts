export type ContractItemMovement = {
  movement_type: string;
  quantity: number;
};

const QUANTITY_SCALE = 10_000;

function toScaledQuantity(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("A quantidade deve ser um número finito e não negativo.");
  }

  const scaled = Math.round(value * QUANTITY_SCALE);
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError("A quantidade ultrapassa o limite suportado.");
  }
  return scaled;
}

export function calcularQuantidadeConsumida(movements: readonly ContractItemMovement[]): number {
  const consumed = movements.reduce((total, movement) => {
    const amount = toScaledQuantity(Number(movement.quantity));
    if (movement.movement_type === "consumption") return total + amount;
    if (movement.movement_type === "reversal") return total - amount;
    return total;
  }, 0);

  return consumed / QUANTITY_SCALE;
}

export function calcularSaldoDisponivel(
  quantityTotal: number,
  movements: readonly ContractItemMovement[],
): number {
  const total = toScaledQuantity(quantityTotal);
  const consumed = Math.max(0, Math.round(calcularQuantidadeConsumida(movements) * QUANTITY_SCALE));
  return Math.max(0, total - consumed) / QUANTITY_SCALE;
}
