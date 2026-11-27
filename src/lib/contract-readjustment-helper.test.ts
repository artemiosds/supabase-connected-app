import { describe, expect, it } from "vitest";
import {
  calcularReajusteAcumulado,
  parseBcbSeriesPayload,
  sugerirPeriodo12Meses,
} from "./contract-readjustment-helper";

describe("contract-readjustment-helper (BCB SGS / Lei 14.133/2021)", () => {
  it("calcula juros compostos geométricos e não soma simples de percentuais", () => {
    // 2 meses de 10% -> composto = 1.1 * 1.1 - 1 = 21%, não 20%
    const res = calcularReajusteAcumulado({
      valorBase: 100000,
      pontosMensais: [
        { data: "01/01/2026", valor: 10 },
        { data: "01/02/2026", valor: 10 },
      ],
      indice: "ipca",
      dataInicialISO: "2026-01-01",
      dataFinalISO: "2026-02-28",
    });

    expect(res.percentualAcumulado).toBe(21);
    expect(res.valorReajuste).toBe(21000);
    expect(res.valorAtualizado).toBe(121000);
    expect(res.mesesConsiderados).toBe(2);
    expect(res.memorialCalculo).toContain("IPCA (IBGE)");
    expect(res.memorialCalculo).toContain("art. 136, inciso I");
  });

  it("suporta meses com deflação negativa e arredondamento financeiro", () => {
    const res = calcularReajusteAcumulado({
      valorBase: 50000,
      pontosMensais: [
        { data: "01/01/2026", valor: 0.5 },
        { data: "01/02/2026", valor: -0.2 },
        { data: "01/03/2026", valor: 0.35 },
      ],
      indice: "inpc",
      dataInicialISO: "2026-01-01",
      dataFinalISO: "2026-03-31",
    });

    // (1.005 * 0.998 * 1.0035 - 1) = 0.006500465 -> 0.6500% -> R$ 325,02
    expect(res.percentualAcumulado).toBeCloseTo(0.65, 3);
    expect(res.valorReajuste).toBe(325.02);
    expect(res.valorAtualizado).toBe(50325.02);
  });

  it("sugere corretamente a janela dos últimos 12 meses fechados", () => {
    const periodo = sugerirPeriodo12Meses("2026-11-27");
    expect(periodo.dataInicialISO).toBe("2025-11-01");
    expect(periodo.dataFinalISO).toBe("2026-10-31");
  });

  it("sanitiza payload da API SGS do Banco Central descartando entradas inválidas", () => {
    const parsed = parseBcbSeriesPayload([
      { data: "01/10/2026", valor: "0.42" },
      { data: "01/11/2026", valor: -0.15 },
      { data: "invalida", valor: "1.0" },
      { data: "01/12/2026", valor: "abc" },
      null,
    ]);
    expect(parsed).toEqual([
      { data: "01/10/2026", valor: 0.42 },
      { data: "01/11/2026", valor: -0.15 },
    ]);
  });
});
