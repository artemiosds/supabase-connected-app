import { describe, expect, it } from "vitest";
import {
  calcularQuantidadeConsumida,
  calcularPercentualDisponivel,
  calcularSaldoDisponivel,
  classificarNivelSaldo,
  resumirAlertasSaldo,
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
      calcularSaldoDisponivel(1, [
        { movement_type: "consumption", quantity: 1.00001 },
      ]),
    ).toBe(0);
  });

  it("rejeita quantidades não finitas ou negativas", () => {
    expect(() => calcularSaldoDisponivel(-1, [])).toThrow(RangeError);
    expect(() =>
      calcularQuantidadeConsumida([
        { movement_type: "consumption", quantity: Number.NaN },
      ]),
    ).toThrow(RangeError);
  });
  it("calcula percentual disponível com 2,5 consumidos de 10", () => {
    expect(
      calcularPercentualDisponivel(10, [
        { movement_type: "consumption", quantity: 2.5 },
      ]),
    ).toBe(75);
  });

  it("classifica os limites de saldo corretamente", () => {
    expect(classificarNivelSaldo(0)).toBe("esgotado");
    expect(classificarNivelSaldo(15)).toBe("critico");
    expect(classificarNivelSaldo(35)).toBe("atencao");
    expect(classificarNivelSaldo(80)).toBe("normal");
  });

  it("resume os níveis e sinaliza risco com saldo crítico ou esgotado", () => {
    expect(
      resumirAlertasSaldo([
        { percentualDisponivel: 0 },
        { percentualDisponivel: 15 },
        { percentualDisponivel: 35 },
        { percentualDisponivel: 80 },
      ]),
    ).toEqual({
      totalItens: 4,
      esgotados: 1,
      criticos: 1,
      emAtencao: 1,
      normais: 1,
      temRiscoDesabastecimento: true,
    });
    expect(
      resumirAlertasSaldo([{ percentualDisponivel: 80 }])
        .temRiscoDesabastecimento,
    ).toBe(false);
  });
});
