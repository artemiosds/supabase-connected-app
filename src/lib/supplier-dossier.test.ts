// =============================================================================
// supplier-dossier.test.ts — Testes unitários do Dossiê Administrativo
// Primus Gestão — Fase 2.1 — Entrega 6
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  gerarCodigoAutenticidade,
  gerarHtmlDossie,
  type DossieCompletoParams,
} from "./supplier-dossier";

describe("supplier-dossier: código de autenticidade", () => {
  it("deve gerar código no padrão PRM-XXXX-XXXX", () => {
    const codigo = gerarCodigoAutenticidade("sup-12345", 1700000000000);
    expect(codigo).toMatch(/^PRM-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("deve ser determinístico para o mesmo id e timestamp", () => {
    const c1 = gerarCodigoAutenticidade("fornecedor-abc", 1000);
    const c2 = gerarCodigoAutenticidade("fornecedor-abc", 1000);
    expect(c1).toBe(c2);
  });
});

describe("supplier-dossier: geração de HTML do dossiê", () => {
  const params: DossieCompletoParams = {
    secretariaNome: "Secretaria Municipal de Saúde de Exemplo",
    fornecedor: {
      id: "f-123",
      legal_name: "Distribuidora Hospitalar Modelo Ltda",
      trade_name: "Hospitalar Modelo",
      cnpj: "12345678000195",
      city: "São Paulo",
      state: "SP",
      status: "active",
    },
    statusConsolidado: "apto",
    ultimaHomologacao: {
      status: "completed",
      conclusion_status: "approved",
      concluded_at: "2026-11-15",
      created_at: "2026-11-01",
    },
    regularidades: [
      {
        source: "tst_cndt",
        source_label: "Certidão Negativa Trabalhista (CNDT)",
        status: "regular",
        valid_until: "2027-01-01",
      },
    ],
    documentos: [
      {
        id: "d-1",
        title: "Alvará Sanitário 2026",
        document_type: "alvara_sanitario",
        status: "active",
        expires_at: "2026-12-31",
      },
    ],
    sancoes: [],
    instrumentos: [
      {
        id: "c-1",
        number: "PE 042/2026 - Contrato 10",
        instrument_type: "contrato",
        status: "vigente",
      },
    ],
    cotacoesCount: 5,
  };

  it("deve conter os elementos obrigatórios da instrução processual", () => {
    const html = gerarHtmlDossie(params);

    expect(html).toContain("Secretaria Municipal de Saúde de Exemplo");
    expect(html).toContain("Distribuidora Hospitalar Modelo Ltda");
    expect(html).toContain("12.345.678/0001-95");
    expect(html).toContain("Apto / Regular");
    expect(html).toContain("Certidão Negativa Trabalhista (CNDT)");
    expect(html).toContain("Alvará Sanitário 2026");
    expect(html).toContain("Nenhum registro de sanção ou impedimento");
    expect(html).toContain("Lei Federal nº 14.133/2021");
    expect(html).toContain("PRM-");
  });
});
