import { describe, expect, it } from "vitest";
import {
  calcularDiasAteData,
  calcularMetricasCockpitVencimentos,
  classificarUrgenciaVencimento,
  compilarItensVencimentoUnificados,
} from "./document-expiry-cockpit-helper";

describe("document-expiry-cockpit-helper (Frente 2 - Parte 1)", () => {
  const hoje = new Date("2026-11-27T12:00:00Z");

  it("classifica corretamente todos os níveis de urgência e rótulos", () => {
    expect(classificarUrgenciaVencimento(-5)).toEqual({
      nivel: "critico",
      rotulo: "Vencido há 5 dias",
    });
    expect(classificarUrgenciaVencimento(-1)).toEqual({
      nivel: "critico",
      rotulo: "Vencido há 1 dia",
    });
    expect(classificarUrgenciaVencimento(0)).toEqual({
      nivel: "urgente",
      rotulo: "Vence hoje",
    });
    expect(classificarUrgenciaVencimento(15)).toEqual({
      nivel: "urgente",
      rotulo: "Vence em 15 dias",
    });
    expect(classificarUrgenciaVencimento(45)).toEqual({
      nivel: "atencao",
      rotulo: "Vence em 45 dias",
    });
    expect(classificarUrgenciaVencimento(90)).toEqual({
      nivel: "planejamento",
      rotulo: "Vence em 90 dias",
    });
    expect(classificarUrgenciaVencimento(180)).toEqual({
      nivel: "regular",
      rotulo: "Vigente (180 dias)",
    });
    expect(classificarUrgenciaVencimento(null)).toEqual({
      nivel: "indeterminado",
      rotulo: "Sem prazo definido",
    });
  });

  it("calcula diferença em dias inteiros para datas ISO e trata datas inválidas", () => {
    expect(calcularDiasAteData("2026-11-22", hoje)).toBe(-5);
    expect(calcularDiasAteData("2026-11-27", hoje)).toBe(0);
    expect(calcularDiasAteData("2026-12-12", hoje)).toBe(15);
    expect(calcularDiasAteData(null, hoje)).toBeNull();
    expect(calcularDiasAteData("2026-02-31", hoje)).toBeNull();
  });

  it("unifica certidões e contratos ativos, filtra inativos e ordena por criticidade", () => {
    const itens = compilarItensVencimentoUnificados({
      hoje,
      fornecedores: [
        {
          id: "sup-1",
          legal_name: "MedFar Comercio Ltda",
          trade_name: "MedFar Saúde",
          cnpj: "12345678000190",
        },
        {
          id: "sup-2",
          legal_name: "Clinica Norte S/A",
          trade_name: null,
          cnpj: "98765432000110",
        },
      ],
      documentosFornecedor: [
        {
          id: "doc-1",
          title: "CND Federal PGFN",
          document_type: "CND Federal",
          supplier_id: "sup-1",
          issue_date: "2026-06-01",
          expires_at: "2026-12-12", // +15d (urgente)
        },
        {
          id: "doc-2",
          title: "CRF FGTS Caixa",
          document_type: "FGTS",
          supplier_id: "sup-2",
          expires_at: "2026-11-20", // -7d (critico)
        },
      ],
      contratos: [
        {
          id: "ctr-1",
          number: "012/2026",
          object: "Fornecimento de medicamentos básicos",
          supplier_id: "sup-1",
          status: "vigente",
          instrument_type: "contrato",
          total_value: 150000,
          start_date: "2026-01-15",
          end_date: "2027-01-15", // +49d (atencao)
        },
        {
          id: "ctr-2",
          number: "099/2025",
          object: "Contrato já encerrado",
          supplier_id: "sup-2",
          status: "encerrado",
          end_date: "2025-12-31",
        },
        {
          id: "ctr-3",
          number: "004/2026",
          object: "Ata de insumos hospitalares",
          supplier_id: "sup-2",
          status: "active",
          instrument_type: "ata_registro_precos",
          end_date: "2027-06-01", // +186d (regular)
        },
      ],
    });

    // Contrato encerrado deve ser ignorado
    expect(itens).toHaveLength(4);
    // Ordenação: crítico (-7d) -> urgente (+15d) -> atenção (+49d) -> regular (+186d)
    expect(itens.map((i) => i.id)).toEqual([
      "cert:doc-2",
      "cert:doc-1",
      "ctr:ctr-1",
      "ctr:ctr-3",
    ]);
    expect(itens[0]?.fornecedorNome).toBe("Clinica Norte S/A");
    expect(itens[1]?.fornecedorNome).toBe("MedFar Saúde");
    expect(itens[2]?.identificador).toBe("Contrato nº 012/2026");
    expect(itens[3]?.identificador).toBe("Ata nº 004/2026");

    const metricas = calcularMetricasCockpitVencimentos(itens);
    expect(metricas).toEqual({
      totalItens: 4,
      totalVencidos: 1,
      totalUrgentes30d: 1,
      totalAtencao60d: 1,
      totalPlanejamento120d: 0,
      totalRegulares: 1,
      totalContratos: 2,
      totalCertidoes: 2,
    });
  });
});
