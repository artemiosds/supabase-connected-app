import { describe, expect, it } from "vitest";
import {
  calcularQuantidadeConsumida,
  calcularSaldoDisponivel,
} from "./contract-item-balance";

describe("saldo de itens de contrato e ARP", () => {
  it("calcula consumos e estornos mantendo quatro casas decimais", () => {
    const movements = [
      { movement_type: "consumption", quantity: 2.125 },
      { movement_type: "consumption", quantity: 0.5 },
      { movement_type: "reversal", quantity: 0.125 },
    ];

    expect(calcularQuantidadeConsumida(movements)).toBe(2.5);
    expect(calcularSaldoDisponivel(10, movements)).toBe(7.5);
  });

  it("não produz saldo negativo por arredondamento", () => {
    expect(
      calcularSaldoDisponivel(1, [{ movement_type: "consumption", quantity: 1.00001 }]),
    ).toBe(0);
  });

  it("rejeita quantidades não finitas ou negativas", () => {
    expect(() => calcularSaldoDisponivel(-1, [])).toThrow(RangeError);
    expect(() =>
      calcularQuantidadeConsumida([{ movement_type: "consumption", quantity: Number.NaN }]),
    ).toThrow(RangeError);
  });
});
