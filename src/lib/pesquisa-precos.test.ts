import { describe, expect, it } from "vitest";
import {
  calcularResumoDePrecos,
  calcularPrecoHomologado,
  calcularPrecoUnitarioEfetivo,
  analisarDispersaoPrecos,
  calcularMediana,
  expurgarAmostrasInconsistentes,
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
      precos.reduce((sum, value) => sum + (value - 67 / 3) ** 2, 0) / (precos.length - 1),
    );
    expect(resumo.coeficienteVariacao).toBeCloseTo((desvioPadrao / (67 / 3)) * 100);
  });

  it("calcula preço aprovado por média, mediana e menor preço, com frete rateado", () => {
    const rows = [
      { quantity: 10, unit_price: 10, delivery_cost: 20, total_price: 120 },
      { quantity: 5, unit_price: 20, delivery_cost: 0, total_price: 100 },
      { quantity: 2, unit_price: 30, delivery_cost: 10, total_price: 70 },
    ];
    expect(calcularPrecoHomologado("media", rows, 4).precoUnitarioAprovado).toBeCloseTo(67 / 3);
    expect(calcularPrecoHomologado("mediana", rows, 4).precoUnitarioAprovado).toBe(20);
    expect(calcularPrecoHomologado("menor", rows, 4).precoUnitarioAprovado).toBe(12);
    expect(calcularPrecoHomologado("outro", rows, 4, 18).precoTotalAprovado).toBe(72);
    expect(() => calcularPrecoHomologado("outro", rows, 4)).toThrow();
    expect(() => calcularPrecoHomologado("mediana", [], 4)).toThrow();
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
          is_active: true,
          source_type: "fornecedor",
          supplier_selection_justification: "Fornecedor selecionado por atender à especificação e ao prazo local.",
          reference_identifier: "PNCP-123",
          accessed_at: "2026-11-18T10:00:00-03:00",
          supplier_response_deadline: "2026-11-30",
          supplier_consultation_sent_at: "2026-11-01",
          supplier_consultation_response_deadline: "2026-11-05",
          source_contact_phone: "(93) 99999-0000",
          notes: "Frete incluso no prazo informado.",
          evidence_file_name: "proposta.pdf",
          evidence_mime_type: "application/pdf",
          evidence_file_size: 4096,
        },
        {
          id: "quote-2",
          procurement_item_id: "item-1",
          source_name: "Fonte expurgada",
          quoted_at: "2026-11-10",
          quantity: 1,
          unit_price: 9,
          delivery_cost: 0,
          total_price: 9,
          selected_for_estimate: false,
          is_active: false,
          justificativa_expurgo: "Preço incompatível com a especificação técnica.",
        },
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=cmd|malicioso"');
    expect(csv).toContain('"12/2026"');
    expect(csv).toContain('"Expurgada"');
    expect(csv).toContain('"Preço incompatível com a especificação técnica."');
    expect(csv).toContain('"PNCP-123"');
    expect(csv).toContain('"2026-11-30"');
    expect(csv).toContain('"2026-11-01"');
    expect(csv).toContain('"2026-11-05"');
    expect(csv).toContain('"(93) 99999-0000"');
    expect(csv).toContain('"Frete incluso no prazo informado."');
    expect(csv).toContain('"Fornecedor selecionado por atender à especificação e ao prazo local."');
    expect(csv).toContain('"application/pdf"');
    expect(csv).toContain('"4096"');
  });
});

describe("estatística amostral", () => {
  it.each([
    [1, 10, 0, 10],
    [10, 10, 20, 12],
    [0, 10, 10, null],
    [-1, 10, 0, null],
    [1, Infinity, 0, null],
  ])("preço efetivo %s %s %s", (q, p, f, r) =>
    expect(calcularPrecoUnitarioEfetivo(q!, p!, f!)).toBe(r),
  );
  it("trata cesta vazia e observação única", () => {
    expect(calcularMediana([])).toBeNull();
    expect(analisarDispersaoPrecos([10]).coeficienteVariacao).toBeNull();
    expect(analisarDispersaoPrecos([]).media).toBeNull();
  });
  it("calcula duas e três observações sem alterar entrada", () => {
    const p = [30, 10, 20];
    expect(calcularMediana(p)).toBe(20);
    expect(p).toEqual([30, 10, 20]);
    expect(calcularMediana([10, 20])).toBe(15);
    expect(analisarDispersaoPrecos([10, 20]).desvioPadraoAmostral).toBeCloseTo(Math.sqrt(50));
    expect(analisarDispersaoPrecos(p).coeficienteVariacao).toBeCloseTo(50);
    expect(analisarDispersaoPrecos(p).dispersaoExcessiva).toBe(true);
    expect(analisarDispersaoPrecos([0, 0]).coeficienteVariacao).toBeNull();
    expect(() => calcularMediana([NaN])).toThrow();
  });
  it("sinaliza preço acima de média mais dois desvios amostrais sem exclusão automática", () => {
    const quotes = [...Array(9).fill(10), 100].map((unit_price, i) => ({
      id: String(i),
      procurement_item_id: "i",
      source_name: "Fonte",
      quoted_at: "2026-11-18",
      quantity: 1,
      unit_price,
      delivery_cost: 0,
      total_price: null,
      selected_for_estimate: true,
    }));
    const result = expurgarAmostrasInconsistentes(quotes);
    expect(result[9]?.motivos).toContain("Valor fora de média ± 2 desvios amostrais");
    expect(quotes[9]?.selected_for_estimate).toBe(true);
  });

  it("sinaliza baixo preço sem excluir a cotação", () => {
    const quotes = [1, 100, 100].map((unit_price, i) => ({
      id: String(i),
      procurement_item_id: "i",
      source_name: "Fonte",
      quoted_at: "2026-11-18",
      quantity: 1,
      unit_price,
      delivery_cost: 0,
      total_price: null,
      selected_for_estimate: true,
    }));
    expect(expurgarAmostrasInconsistentes(quotes)[0]?.sinalizada).toBe(true);
    expect(quotes[0]?.selected_for_estimate).toBe(true);
  });
});
