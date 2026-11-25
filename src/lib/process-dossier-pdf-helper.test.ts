// =============================================================================
// process-dossier-pdf-helper.test.ts — Testes unitários do Dossiê TCE
// Primus Gestão — Fase 5
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  calcularResumoDossieProcesso,
  buildProcessDossierDocumentText,
  roundMoney,
} from "./process-dossier-pdf-helper";

describe("process-dossier-pdf-helper", () => {
  const mockItems = [
    {
      itemNumber: 1,
      description: "Soro Fisiológico 0,9% 500ml",
      unit: "Frasco",
      quantity: 1000,
      estimatedPrice: 8.5,
      approvedPrice: 6.8,
      winnerSupplierName: "Distribuidora Farmacêutica Ltda",
      winnerSupplierCnpj: "12.345.678/0001-90",
    },
    {
      itemNumber: 2,
      description: "Dipirona Sódica 500mg/ml Ampola",
      unit: "Ampola",
      quantity: 500,
      estimatedPrice: 4.0,
      approvedPrice: 3.2,
      winnerSupplierName: "Distribuidora Farmacêutica Ltda",
      winnerSupplierCnpj: "12.345.678/0001-90",
    },
  ];

  it("calcula corretamente valores, economia e percentual de desconto", () => {
    const summary = calcularResumoDossieProcesso(mockItems, 1);
    expect(summary.totalEstimated).toBe(10500); // (1000*8.5) + (500*4.0)
    expect(summary.totalHomologated).toBe(8400); // (1000*6.8) + (500*3.2)
    expect(summary.totalEconomy).toBe(2100);
    expect(summary.economyPercentage).toBe(20);
    expect(summary.totalItems).toBe(2);
    expect(summary.totalContracts).toBe(1);
  });

  it("arredonda valores monetários de forma segura", () => {
    expect(roundMoney(10.555)).toBe(10.56);
    expect(roundMoney(10.554)).toBe(10.55);
    expect(roundMoney(NaN)).toBe(0);
  });

  it("gera o texto do dossiê com todas as 6 seções obrigatórias para o TCE", () => {
    const summary = calcularResumoDossieProcesso(mockItems, 1);
    const text = buildProcessDossierDocumentText({
      process: {
        number: "PROC-2026/042",
        title: "Aquisição de Insumos Hospitalares Urgentes",
        modality: "Dispensa de Licitação",
        status: "homologado",
        createdAt: "10/11/2026",
        responsibleName: "Dr. Roberto Silva",
      },
      items: mockItems,
      quotes: [
        {
          supplierName: "Distribuidora Farmacêutica Ltda",
          supplierCnpj: "12.345.678/0001-90",
          quotedItemsCount: 2,
          totalQuotedValue: 8400,
        },
      ],
      contracts: [
        {
          number: "CT-2026/015",
          supplierName: "Distribuidora Farmacêutica Ltda",
          supplierCnpj: "12.345.678/0001-90",
          startDate: "15/11/2026",
          endDate: "15/11/2027",
          totalValue: 8400,
          status: "ativo",
        },
      ],
      summary,
      generatedBy: "Auditor de Controle Interno",
      generatedAt: new Date("2026-11-24T18:00:00Z"),
    });

    expect(text).toContain("DOSSIÊ CONSOLIDADO DE PRESTAÇÃO DE CONTAS");
    expect(text).toContain("1. IDENTIFICAÇÃO E ENQUADRAMENTO NORMATIVO DO PROCESSO");
    expect(text).toContain("2. RESUMO FINANCEIRO E ECONOMIA GERADA");
    expect(text).toContain("3. DEMONSTRATIVO ANALÍTICO DOS ITENS E PREÇOS HOMOLOGADOS");
    expect(text).toContain("4. PAINEL DE COTAÇÕES E FORNECEDORES PARTICIPANTES");
    expect(text).toContain("5. CONTRATOS E ATAS DE REGISTRO DE PREÇOS VINCULADOS");
    expect(text).toContain("6. TERMO DE AUTESTAÇÃO E CONFORMIDADE PARA O TRIBUNAL DE CONTAS");
    expect(text).toContain("PROC-2026/042");
    expect(text).toContain("Soro Fisiológico 0,9% 500ml");
    expect(text.replace(/\u00a0/g, " ")).toContain("R$ 2.100,00");
  });
});
