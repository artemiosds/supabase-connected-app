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
export type NivelSaldoItem = "esgotado" | "critico" | "atencao" | "normal";

export function calcularPercentualDisponivel(
  quantityTotal: number,
  movements: readonly ContractItemMovement[],
): number {
  if (!Number.isFinite(quantityTotal) || quantityTotal <= 0) return 0;
  const saldo = calcularSaldoDisponivel(quantityTotal, movements);
  const percentual = (saldo / quantityTotal) * 100;
  return Math.max(0, Math.min(100, Math.round(percentual * 10) / 10));
}

export function classificarNivelSaldo(percentualDisponivel: number): NivelSaldoItem {
  if (!Number.isFinite(percentualDisponivel) || percentualDisponivel <= 0) return "esgotado";
  if (percentualDisponivel <= 20) return "critico";
  if (percentualDisponivel <= 50) return "atencao";
  return "normal";
}

export type ResumoAlertasSaldo = {
  totalItens: number;
  esgotados: number;
  criticos: number;
  emAtencao: number;
  normais: number;
  temRiscoDesabastecimento: boolean;
};

export function resumirAlertasSaldo(
  itensComPercentual: Array<{ percentualDisponivel: number }>,
): ResumoAlertasSaldo {
  let esgotados = 0;
  let criticos = 0;
  let emAtencao = 0;
  let normais = 0;

  for (const item of itensComPercentual) {
    const nivel = classificarNivelSaldo(item.percentualDisponivel);
    if (nivel === "esgotado") esgotados++;
    else if (nivel === "critico") criticos++;
    else if (nivel === "atencao") emAtencao++;
    else normais++;
  }

  return {
    totalItens: itensComPercentual.length,
    esgotados,
    criticos,
    emAtencao,
    normais,
    temRiscoDesabastecimento: esgotados > 0 || criticos > 0,
  };
}
