// =============================================================================
// reports-metrics-helper.test.ts — Testes unitários do Motor de Métricas BI
// Primus Gestão — Central de Relatórios Executivos
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  calcularMetricasBI,
  type ContratoResumo,
  type MovimentoOFResumo,
} from "./reports-metrics-helper";

describe("reports-metrics-helper: calcularMetricasBI", () => {
  it("deve calcular corretamente total contratado, executado por OF e saldo restante", () => {
    const contratos: ContratoResumo[] = [
      { id: "c1", supplier_name: "Fornecedor Alpha", total_value: 100000, status: "vigente" },
      { id: "c2", supplier_name: "Fornecedor Beta", total_value: 50000, status: "active" },
      { id: "c3", supplier_name: "Fornecedor Gamma", total_value: 80000, status: "encerrado" }, // não ativo
    ];

    const movimentos: MovimentoOFResumo[] = [
      { contract_id: "c1", quantity: 10, unit_price: 2000, movement_type: "consumption" }, // 20.000
      { contract_id: "c2", quantity: 5, unit_price: 3000, movement_type: "consumption" }, // 15.000
      { contract_id: "c1", quantity: 2, unit_price: 1000, movement_type: "adjustment" }, // ajuste ignorado no consumo
    ];

    const metricas = calcularMetricasBI(contratos, movimentos);

    // Contratado ativo: 100.000 + 50.000 = 150.000
    expect(metricas.totalContratado).toBe(150000);
    // Executado em consumo: 20.000 + 15.000 = 35.000
    expect(metricas.totalExecutadoOF).toBe(35000);
    // Saldo restante: 150.000 - 35.000 = 115.000
    expect(metricas.saldoRestante).toBe(115000);
    // Percentual: (35.000 / 150.000) * 100 = 23.333% -> 23.3
    expect(metricas.percentualExecucao).toBe(23.3);
    // Contratos ativos
    expect(metricas.totalContratosAtivos).toBe(2);
  });

  it("deve agrupar e ranquear corretamente os 5 maiores fornecedores por valor total", () => {
    const contratos: ContratoResumo[] = [
      { id: "c1", supplier_name: "Empresa A", total_value: 30000, status: "vigente" },
      { id: "c2", supplier_name: "Empresa B", total_value: 90000, status: "vigente" },
      { id: "c3", supplier_name: "Empresa A", total_value: 40000, status: "vigente" }, // Empresa A total: 70.000 (2 contratos)
      { id: "c4", supplier_name: "Empresa C", total_value: 120000, status: "vigente" },
      { id: "c5", supplier_name: "Empresa D", total_value: 15000, status: "vigente" },
      { id: "c6", supplier_name: "Empresa E", total_value: 50000, status: "vigente" },
      { id: "c7", supplier_name: "Empresa F", total_value: 5000, status: "vigente" },
    ];

    const metricas = calcularMetricasBI(contratos, []);

    // Deve retornar no máximo top 5
    expect(metricas.rankingFornecedores.length).toBe(5);

    // 1º Empresa C: 120.000
    expect(metricas.rankingFornecedores[0]?.fornecedor).toBe("Empresa C");
    expect(metricas.rankingFornecedores[0]?.valorTotal).toBe(120000);
    expect(metricas.rankingFornecedores[0]?.qtdContratos).toBe(1);

    // 2º Empresa B: 90.000
    expect(metricas.rankingFornecedores[1]?.fornecedor).toBe("Empresa B");
    expect(metricas.rankingFornecedores[1]?.valorTotal).toBe(90000);

    // 3º Empresa A: 70.000 (2 contratos somados)
    expect(metricas.rankingFornecedores[2]?.fornecedor).toBe("Empresa A");
    expect(metricas.rankingFornecedores[2]?.valorTotal).toBe(70000);
    expect(metricas.rankingFornecedores[2]?.qtdContratos).toBe(2);

    // 4º Empresa E: 50.000
    expect(metricas.rankingFornecedores[3]?.fornecedor).toBe("Empresa E");

    // 5º Empresa D: 15.000
    expect(metricas.rankingFornecedores[4]?.fornecedor).toBe("Empresa D");
  });

  it("deve tratar listas vazias sem divisão por zero (percentual 0%)", () => {
    const metricas = calcularMetricasBI([], []);

    expect(metricas.totalContratado).toBe(0);
    expect(metricas.totalExecutadoOF).toBe(0);
    expect(metricas.saldoRestante).toBe(0);
    expect(metricas.percentualExecucao).toBe(0);
    expect(metricas.totalContratosAtivos).toBe(0);
    expect(metricas.rankingFornecedores).toEqual([]);
  });

  it("subtrai estornos (reversal) e ignora movimentações de contratos encerrados", () => {
    const contratos = [
      {
        id: "ctr-ativo",
        supplier_name: "Med A",
        total_value: 1000,
        status: "vigente",
      },
      {
        id: "ctr-encerrado",
        supplier_name: "Med B",
        total_value: 5000,
        status: "encerrado",
      },
    ];
    const movimentos = [
      { contract_id: "ctr-ativo", movement_type: "consumption" as const, total_value: 600 },
      { contract_id: "ctr-ativo", movement_type: "reversal" as const, total_value: 150 },
      { contract_id: "ctr-encerrado", movement_type: "consumption" as const, total_value: 2000 },
    ];

    const metricas = calcularMetricasBI(contratos, movimentos);

    expect(metricas.totalContratado).toBe(1000);
    expect(metricas.totalExecutadoOF).toBe(450);
    expect(metricas.saldoRestante).toBe(550);
    expect(metricas.percentualExecucao).toBe(45);
  });
});
