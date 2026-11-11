import { describe, expect, it } from "vitest";
import {
  gerarCsvContratosAVencerEm90Dias,
  selecionarContratosAVencerEm90Dias,
} from "./relatorio-contratos";

describe("relatório de contratos a vencer em 90 dias", () => {
  it("inclui hoje e o 90º dia, exclui vencidos, posteriores e não vigentes", () => {
    const hoje = new Date(2026, 10, 11);
    const contratos = [
      { number: "hoje", status: "vigente", end_date: "2026-11-11" },
      { number: "limite", status: "vigente", end_date: "2027-02-09" },
      { number: "vencido", status: "vigente", end_date: "2026-11-10" },
      { number: "fora", status: "vigente", end_date: "2027-02-10" },
      { number: "arquivado", status: "arquivado", end_date: "2026-12-01" },
    ];
    expect(selecionarContratosAVencerEm90Dias(contratos, hoje).map((item) => item.number)).toEqual([
      "hoje",
      "limite",
    ]);
  });

  it("gera CSV legível no Excel sem executar fórmulas de dados externos", () => {
    const csv = gerarCsvContratosAVencerEm90Dias([
      {
        number: "12/2026",
        object: "=HYPERLINK(\"https://example.test\")",
        supplier: "Fornecedor; \"A\"",
        process: "42/2026",
        modality: "pregao",
        totalValue: 1200,
        endDate: "2026-12-11",
        manager: "@malicioso",
        inspector: "Fiscal",
        daysRemaining: 30,
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"Fornecedor; ""A"""');
    expect(csv).toContain('"\'@malicioso"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
