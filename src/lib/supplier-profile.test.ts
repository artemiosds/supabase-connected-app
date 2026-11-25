// =============================================================================
// supplier-profile.test.ts — Testes unitários da Ficha 360º Consolidada
// Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores (Entrega 5)
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  dataLocalIso,
  diasAteDataIso,
  resumirFichaFornecedor,
  situacaoDocumentoPerfil,
  calcularStatusConsolidado360,
  rotuloStatusConsolidado360,
} from "./supplier-profile";

describe("Ficha 360º de fornecedores: funções básicas", () => {
  const hoje = "2026-11-19";

  it("diferencia documentos arquivados, vencidos e com vencimento próximo", () => {
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-11-18" }, hoje)).toBe(
      "vencido",
    );
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-11-19" }, hoje)).toBe(
      "vence_hoje",
    );
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-12-19" }, hoje)).toBe(
      "a_vencer",
    );
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-12-20" }, hoje)).toBe(
      "em_dia",
    );
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: null }, hoje)).toBe(
      "sem_vencimento",
    );
    expect(situacaoDocumentoPerfil({ status: "archived", expires_at: "2026-01-01" }, hoje)).toBe(
      "arquivado",
    );
  });

  it("não sofre desvios de fuso na contagem de dias", () => {
    expect(diasAteDataIso("2026-11-18", hoje)).toBe(-1);
    expect(diasAteDataIso("2026-11-19", hoje)).toBe(0);
    expect(diasAteDataIso("2026-11-20", hoje)).toBe(1);
    expect(diasAteDataIso(null, hoje)).toBeNull();
    expect(dataLocalIso(new Date(2026, 10, 19, 23, 59))).toBe("2026-11-19");
  });

  it("preserva compatibilidade com chamada legada sem novos argumentos", () => {
    const resumo = resumirFichaFornecedor(
      [
        { status: "active", expires_at: "2026-11-18" },
        { status: "active", expires_at: "2026-11-25" },
        { status: "archived", expires_at: "2025-01-01" },
      ],
      [{ id: "q1" }, { id: "q2" }],
      [
        { instrument_type: "contrato", status: "vigente", end_date: "2026-11-25" },
        { instrument_type: "ata_registro_precos", status: "vigente", end_date: "2026-12-25" },
      ],
      [
        { status: "active", start_date: "2026-01-01", end_date: null },
        { status: "revoked", start_date: "2026-01-01", end_date: null },
      ],
      hoje,
    );

    expect(resumo).toMatchObject({
      documentos: 2,
      vencidos: 1,
      aVencer: 1,
      cotacoes: 2,
      contratos: 1,
      atas: 1,
      vencimentosContratuais: 1,
      sancoesVigentes: 1,
      statusConsolidado360: "inapto", // devido à sanção vigente
    });
  });
});

describe("Ficha 360º Consolidada: Status e Indicadores Integrados (Entrega 5)", () => {
  const hoje = "2026-11-19";

  it("determina 'inapto' quando houver sanção, irregularidade oficial ou pendência crítica", () => {
    // Caso 1: Sanção vigente
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 1,
        regularidadesIrregulares: 0,
        tarefasCriticas: 0,
        documentosVencidos: 0,
        documentosAVencer: 0,
        tarefasAbertas: 0,
        cadastroAtivo: true,
      }),
    ).toBe("inapto");

    // Caso 2: Irregularidade oficial (CEIS, CNDT, etc)
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 0,
        regularidadesIrregulares: 1,
        tarefasCriticas: 0,
        documentosVencidos: 0,
        documentosAVencer: 0,
        tarefasAbertas: 0,
        cadastroAtivo: true,
      }),
    ).toBe("inapto");

    // Caso 3: Tarefa operacional de prioridade crítica aberta
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 0,
        regularidadesIrregulares: 0,
        tarefasCriticas: 2,
        documentosVencidos: 0,
        documentosAVencer: 0,
        tarefasAbertas: 2,
        cadastroAtivo: true,
      }),
    ).toBe("inapto");

    // Caso 4: Cadastro inativo
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 0,
        regularidadesIrregulares: 0,
        tarefasCriticas: 0,
        documentosVencidos: 0,
        documentosAVencer: 0,
        tarefasAbertas: 0,
        cadastroAtivo: false,
      }),
    ).toBe("inapto");
  });

  it("determina 'em_homologacao' quando há processo em análise sem impedimentos", () => {
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 0,
        regularidadesIrregulares: 0,
        tarefasCriticas: 0,
        documentosVencidos: 0,
        documentosAVencer: 0,
        tarefasAbertas: 0,
        ultimaHomologacao: {
          status: "in_review",
          conclusion_status: null,
          concluded_at: null,
          created_at: "2026-11-19",
        },
        cadastroAtivo: true,
      }),
    ).toBe("em_homologacao");
  });

  it("determina 'atencao' quando há documentos vencidos ou tarefas pendentes não críticas", () => {
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 0,
        regularidadesIrregulares: 0,
        tarefasCriticas: 0,
        documentosVencidos: 1,
        documentosAVencer: 0,
        tarefasAbertas: 1,
        cadastroAtivo: true,
      }),
    ).toBe("atencao");
  });

  it("determina 'apto' quando todas as certidões e verificações estão regulares", () => {
    expect(
      calcularStatusConsolidado360({
        sancoesVigentes: 0,
        regularidadesIrregulares: 0,
        tarefasCriticas: 0,
        documentosVencidos: 0,
        documentosAVencer: 0,
        tarefasAbertas: 0,
        ultimaHomologacao: {
          status: "completed",
          conclusion_status: "approved",
          concluded_at: "2026-11-18",
          created_at: "2026-11-10",
        },
        cadastroAtivo: true,
      }),
    ).toBe("apto");
  });

  it("consolida todas as dimensões da Fase 2.1 em resumirFichaFornecedor", () => {
    const homologacoes = [
      {
        id: "h-1",
        status: "completed",
        conclusion_status: "approved",
        concluded_at: "2026-11-18",
        created_at: "2026-11-10",
      },
    ];

    const regularidades = [
      { id: "r-1", source: "rfb_cnpj", status: "regular", valid_until: "2027-01-01" },
      { id: "r-2", source: "tst_cndt", status: "regular", valid_until: "2026-12-15" },
      { id: "r-3", source: "ceis_cgu", status: "not_found", valid_until: null },
    ];

    const tarefas = [
      {
        id: "t-1",
        task_type: "document_expiring",
        priority: "low",
        status: "open",
        due_date: "2026-12-15",
      },
      { id: "t-2", task_type: "manual", priority: "medium", status: "resolved", due_date: null },
    ];

    const resumo = resumirFichaFornecedor(
      [{ status: "active", expires_at: "2027-01-01" }],
      [{ id: "q1" }],
      [{ instrument_type: "contrato", status: "vigente", end_date: "2027-05-01" }],
      [],
      hoje,
      homologacoes,
      regularidades,
      tarefas,
      true,
    );

    expect(resumo.ultimaHomologacao).toEqual(homologacoes[0]);
    expect(resumo.regularidade).toEqual({
      total: 3,
      regulares: 2,
      irregulares: 0,
      pendentes: 0,
    });
    expect(resumo.tarefas).toEqual({
      abertas: 1,
      criticas: 0,
      vencidas: 0,
    });
    expect(resumo.statusConsolidado360).toBe("atencao"); // 1 tarefa aberta
  });

  it("rotuloStatusConsolidado360 fornece metadados visuais corretos", () => {
    expect(rotuloStatusConsolidado360("apto").label).toBe("Apto / Regular");
    expect(rotuloStatusConsolidado360("inapto").label).toBe("Inapto / Impedimento");
    expect(rotuloStatusConsolidado360("atencao").label).toBe("Atenção / Pendências");
    expect(rotuloStatusConsolidado360("em_homologacao").label).toBe("Em Homologação");
  });
});
