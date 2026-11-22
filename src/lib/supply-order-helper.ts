import { calculateItemTotal } from "./procurement-items-parser";

export interface SupplyOrderItemCandidate {
  itemId: string;
  description: string;
  unit: string;
  unitValue: number;
  availableQuantity: number;
  requestedQuantity: number;
}
export interface SupplyOrderHeader {
  referenceNumber: string;
  reason: string;
}
export interface ValidatedSupplyOrderItem {
  itemId: string;
  quantity: number;
  unitValue: number;
  subtotal: number;
}
export interface SupplyOrderValidationResult {
  isValid: boolean;
  errors: string[];
  itemsToConsume: ValidatedSupplyOrderItem[];
  totalValue: number;
  totalItemsCount: number;
}
export function validateSupplyOrder(
  header: SupplyOrderHeader,
  candidates: SupplyOrderItemCandidate[],
): SupplyOrderValidationResult {
  const errors: string[] = [];
  const itemsToConsume: ValidatedSupplyOrderItem[] = [];
  const reference = header.referenceNumber.trim();
  if (!reference || reference.length > 120)
    errors.push("Informe o número da OF / Empenho (até 120 caracteres).");
  if (header.reason.trim().length < 10 || header.reason.trim().length > 1000)
    errors.push("Informe o destino/motivo entre 10 e 1.000 caracteres.");
  const seen = new Set<string>();
  for (const item of candidates) {
    const amount = item.requestedQuantity;
    if (amount === 0) continue;
    if (!Number.isFinite(amount) || amount < 0 || Number(amount.toFixed(4)) !== amount) {
      errors.push(item.description + ": quantidade inválida (até quatro casas decimais).");
      continue;
    }
    if (!Number.isFinite(item.availableQuantity) || amount > item.availableQuantity) {
      errors.push(item.description + ": quantidade solicitada supera o saldo disponível.");
      continue;
    }
    const subtotal = calculateItemTotal(amount, item.unitValue);
    if (!Number.isFinite(subtotal) || seen.has(item.itemId)) {
      errors.push(item.description + ": valor inválido ou item repetido.");
      continue;
    }
    seen.add(item.itemId);
    itemsToConsume.push({
      itemId: item.itemId,
      quantity: amount,
      unitValue: item.unitValue,
      subtotal,
    });
  }
  if (!itemsToConsume.length) errors.push("Solicite ao menos um item.");
  return {
    isValid: errors.length === 0,
    errors,
    itemsToConsume,
    totalValue:
      itemsToConsume.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0) / 100,
    totalItemsCount: itemsToConsume.length,
  };
}
