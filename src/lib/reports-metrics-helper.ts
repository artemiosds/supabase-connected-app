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
  /** Quantidade consumida/estornada. Usado em conjunto com unit_price para calcular subtotal. */
  quantity?: number | null;
  /** Preço unitário. Usado em conjunto com quantity para calcular subtotal. */
  unit_price?: number | null;
  /**
   * Valor total pré-calculado. Quando presente, tem precedência sobre quantity * unit_price.
   * Supabase retorna este campo diretamente via SELECT total_value.
   */
  total_value?: number | null;
  movement_type: "consumption" | "reversal" | "adjustment";
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calcularMetricasBI(
  contratos: ContratoResumo[],
  movimentos: MovimentoOFResumo[],
): MetricasBI {
  const contratosAtivos = contratos.filter((c) => c.status === "active" || c.status === "vigente");
  const activeContractIds = new Set(contratosAtivos.map((c) => c.id));
  const totalContratado = roundMoney(
    contratosAtivos.reduce((acc, c) => acc + (Number(c.total_value) || 0), 0),
  );

  // Soma consumos líquidos (descontando estornos / reversals) apenas dos contratos na base ativa apurada
  let executedRaw = 0;
  for (const m of movimentos) {
    if (contratosAtivos.length > 0 && !activeContractIds.has(m.contract_id)) continue;
    // total_value tem precedência (vem do banco); fallback: quantity * unit_price
    const subtotal =
      m.total_value != null
        ? Number(m.total_value) || 0
        : (Number(m.quantity) || 0) * (Number(m.unit_price) || 0);
    if (m.movement_type === "consumption") {
      executedRaw += subtotal;
    } else if (m.movement_type === "reversal") {
      executedRaw -= subtotal;
    }
  }
  const totalExecutadoOF = roundMoney(Math.max(0, executedRaw));
  const saldoRestante = roundMoney(Math.max(0, totalContratado - totalExecutadoOF));
  const percentualExecucao = totalContratado > 0 ? (totalExecutadoOF / totalContratado) * 100 : 0;

  // Agrupamento por fornecedor (considerando contratos da base filtrada ativa)
  const mapaFornecedor: Record<string, { valorTotal: number; qtdContratos: number }> = {};
  for (const c of contratosAtivos) {
    const nome = c.supplier_name?.trim() || "Fornecedor não identificado";
    if (!mapaFornecedor[nome]) {
      mapaFornecedor[nome] = { valorTotal: 0, qtdContratos: 0 };
    }
    mapaFornecedor[nome].valorTotal = roundMoney(
      mapaFornecedor[nome].valorTotal + (Number(c.total_value) || 0),
    );
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
    totalContratosAtivos: contratosAtivos.length,
    rankingFornecedores,
  };
}
