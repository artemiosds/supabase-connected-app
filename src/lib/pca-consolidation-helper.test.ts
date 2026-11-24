// =============================================================================
// pca-consolidation-helper.test.ts — Testes unitários do Motor PCA
// Primus Gestão — Fase 3
// =============================================================================

import { describe, expect, it } from "vitest";
import { consolidarDemandasPCA, normalizarDescricao } from "./pca-consolidation-helper";

describe("consolidarDemandasPCA", () => {
  it("normaliza descrições removendo acentos e espaços extras", () => {
    expect(normalizarDescricao("  DIPIRONA   500MG  ")).toBe("dipirona 500mg");
    expect(normalizarDescricao("Álcool em Gel 70%")).toBe("alcool em gel 70%");
  });

  it("soma quantidades de itens idênticos vindos de diferentes unidades/demandas", () => {
    const demandas = [
      {
        id: "d1",
        plan_year: 2026,
        title: "Demanda UBS Centro",
        justification: "Atendimento básico",
        approved_at: "2026-01-10",
        process_id: null,
        submitted_at: "2026-01-05",
        items: [
          { description: "Dipirona 500mg", unit: "CX", quantity: 100 },
          { description: "Luva de Procedimento M", unit: "CX", quantity: 50 },
        ],
      },
      {
        id: "d2",
        plan_year: 2026,
        title: "Demanda Hospital Municipal",
        justification: "Pronto atendimento",
        approved_at: null,
        process_id: null,
        submitted_at: "2026-01-08",
        items: [
          { description: "dipirona 500mg", unit: "CX", quantity: 200 },
          { description: "Seringa 5ml", unit: "UN", quantity: 500 },
        ],
      },
    ];

    const resumo = consolidarDemandasPCA(demandas);

    expect(resumo.totalDemandas).toBe(2);
    expect(resumo.demandasAprovadas).toBe(1);
    expect(resumo.demandasAguardando).toBe(1);
    expect(resumo.demandasConvertidas).toBe(0);

    // Dipirona foi consolidada: 100 + 200 = 300
    const dipirona = resumo.itensConsolidados.find((i) => i.descricaoNormalizada.includes("dipirona"));
    expect(dipirona).toBeDefined();
    expect(dipirona?.quantidadeTotal).toBe(300);
    expect(dipirona?.totalDemandasOrigem).toBe(2);
  });
});
