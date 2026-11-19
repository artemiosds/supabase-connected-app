import { describe, expect, it } from "vitest";
import {
  calcularVariacaoPrecoPercentual,
  podeUsarMinutaProrrogacao,
} from "./contract-renewal";

describe("elegibilidade da minuta de prorrogação contínua", () => {
  it("aceita somente contrato contínuo regido pela Lei 14.133", () => {
    expect(podeUsarMinutaProrrogacao("contrato", "lei_14133", "continuous_service")).toBe(true);
    expect(podeUsarMinutaProrrogacao("contrato", "lei_14133", "continuous_supply")).toBe(true);
  });

  it("não confunde contrato por escopo, ata ou regime jurídico diferente", () => {
    expect(podeUsarMinutaProrrogacao("contrato", "lei_14133", "scope")).toBe(false);
    expect(podeUsarMinutaProrrogacao("ata_registro_precos", "lei_14133", "continuous_supply")).toBe(false);
    expect(podeUsarMinutaProrrogacao("contrato", "lei_8666", "continuous_service")).toBe(false);
    expect(podeUsarMinutaProrrogacao("contrato", "not_identified", "unclassified")).toBe(false);
  });
});

describe("comparativo de vantajosidade", () => {
  it("calcula variação percentual do preço contratado contra a referência", () => {
    expect(calcularVariacaoPrecoPercentual(110, 100)).toBeCloseTo(10);
    expect(calcularVariacaoPrecoPercentual(90, 100)).toBeCloseTo(-10);
    expect(calcularVariacaoPrecoPercentual(100, 100)).toBe(0);
  });

  it("não calcula quando a referência é inválida ou ausente", () => {
    expect(calcularVariacaoPrecoPercentual(100, 0)).toBeNull();
    expect(calcularVariacaoPrecoPercentual(100, null)).toBeNull();
    expect(calcularVariacaoPrecoPercentual(null, 100)).toBeNull();
    expect(calcularVariacaoPrecoPercentual(Number.NaN, 100)).toBeNull();
  });
});
