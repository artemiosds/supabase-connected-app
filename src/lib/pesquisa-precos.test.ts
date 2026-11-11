import { describe, expect, it } from "vitest";
import {
  calcularResumoDePrecos,
  gerarCsvMapaDePrecos,
  precoUnitarioComFrete,
} from "./pesquisa-precos";

const cotacoes = [
  { quantity: 10, unit_price: 10, delivery_cost: 20, total_price: 120 },
  { quantity: 5, unit_price: 20, delivery_cost: 0, total_price: 100 },
  { quantity: 2, unit_price: 30, delivery_cost: 10, total_price: 70 },
];

describe("mapa de pesquisa de preços", () => {
  it("normaliza o frete pela quantidade cotada", () => {
    expect(
      precoUnitarioComFrete({ quantity: 10, unit_price: 10, delivery_cost: 20, total_price: 120 }),
    ).toBe(12);
  });

  it("calcula menor preço, média, mediana e coeficiente de variação", () => {
    const resumo = calcularResumoDePrecos(cotacoes);
    expect(resumo.quantidade).toBe(3);
    expect(resumo.menor).toBe(12);
    expect(resumo.media).toBeCloseTo(67 / 3);
    expect(resumo.mediana).toBe(20);
    const precos = [12, 20, 35];
    const desvioPadrao = Math.sqrt(
      precos.reduce((sum, value) => sum + (value - 67 / 3) ** 2, 0) / precos.length,
    );
    expect(resumo.coeficienteVariacao).toBeCloseTo((desvioPadrao / (67 / 3)) * 100);
  });

  it("exporta CSV compatível com Excel e neutraliza fórmulas em texto", () => {
    const csv = gerarCsvMapaDePrecos(
      "12/2026",
      [{ id: "item-1", line_number: 1, description: "=cmd|malicioso", unit: "un", quantity: 1 }],
      [
        {
          id: "quote-1",
          procurement_item_id: "item-1",
          source_name: "Fonte",
          quoted_at: "2026-11-11",
          quantity: 1,
          unit_price: 4,
          delivery_cost: 0,
          total_price: 4,
          selected_for_estimate: false,
        },
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=cmd|malicioso"');
    expect(csv).toContain('"12/2026"');
  });
});
