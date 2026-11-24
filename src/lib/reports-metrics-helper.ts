// =============================================================================
// reports-metrics-helper.ts — Motor de Cálculo de Indicadores Executivos & BI
// Primus Gestão — Central de Relatórios Executivos (/relatorios)
// =============================================================================

export interface ProcessoResumo {
  id: string;
  estimated_total: number | null;
  status: string;
}

export interface ContratoResumo {
  id: string;
  supplier_name: string;
  total_value: number;
  status: string;
}

export interface MovimentoOFResumo {
  contract_id: string;
  quantity: number;
  unit_price: number;
  movement_type: "consumption" | "adjustment";
  notes?: string | null;
}

export interface MetricasBI {
  totalContratado: number;
  totalExecutadoOF: number;
  saldoRestante: number;
  percentualExecucao: number;
  totalContratosAtivos: number;
  rankingFornecedores: { fornecedor: string; valorTotal: number; qtdContratos: number }[];
}

export function calcularMetricasBI(
  contratos: ContratoResumo[],
  movimentos: MovimentoOFResumo[]
): MetricasBI {
  const totalContratado = contratos
    .filter((c) => c.status === "active" || c.status === "vigente")
    .reduce((acc, c) => acc + (Number(c.total_value) || 0), 0);

  const totalExecutadoOF = movimentos
    .filter((m) => m.movement_type === "consumption")
    .reduce((acc, m) => acc + (Number(m.quantity) || 0) * (Number(m.unit_price) || 0), 0);

  const saldoRestante = Math.max(0, totalContratado - totalExecutadoOF);
  const percentualExecucao = totalContratado > 0 ? (totalExecutadoOF / totalContratado) * 100 : 0;

  // Agrupamento por fornecedor
  const mapaFornecedor: Record<string, { valorTotal: number; qtdContratos: number }> = {};
  for (const c of contratos) {
    const nome = c.supplier_name?.trim() || "Fornecedor não identificado";
    if (!mapaFornecedor[nome]) {
      mapaFornecedor[nome] = { valorTotal: 0, qtdContratos: 0 };
    }
    mapaFornecedor[nome].valorTotal += Number(c.total_value) || 0;
    mapaFornecedor[nome].qtdContratos += 1;
  }

  const rankingFornecedores = Object.entries(mapaFornecedor)
    .map(([fornecedor, dados]) => ({
      fornecedor,
      valorTotal: dados.valorTotal,
      qtdContratos: dados.qtdContratos,
    }))
    .sort((a, b) => b.valorTotal - a.valorTotal)
    .slice(0, 5);

  return {
    totalContratado,
    totalExecutadoOF,
    saldoRestante,
    percentualExecucao: Number(percentualExecucao.toFixed(1)),
    totalContratosAtivos: contratos.filter((c) => c.status === "active" || c.status === "vigente").length,
    rankingFornecedores,
  };
}
