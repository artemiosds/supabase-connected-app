// =============================================================================
// pca-consolidation-helper.ts — Motor de Consolidação Anual de Demandas (PCA)
// Primus Gestão — Fase 3
// =============================================================================

export interface ItemDemandaPCA {
  description: string;
  unit: string;
  quantity: number;
  estimated_unit_price?: number | null;
  catmat_code?: string | null;
}

export interface DemandaPCARow {
  id: string;
  plan_year: number;
  title: string;
  justification: string;
  items: unknown;
  approved_at: string | null;
  process_id: string | null;
  submitted_at: string;
  requesting_unit?: string | null;
  responsible_name?: string | null;
  estimated_total_value?: number | null;
  desired_date?: string | null;
  priority?: string | null;
  category?: string | null;
  review_status?: string | null;
  rejection_reason?: string | null;
}

export interface ItemConsolidadoPCA {
  descricaoNormalizada: string;
  descricaoOriginal: string;
  unidade: string;
  quantidadeTotal: number;
  valorEstimadoTotal: number;
  totalDemandasOrigem: number;
}

export interface ResumoExercicioPCA {
  totalDemandas: number;
  demandasAguardando: number;
  demandasAprovadas: number;
  demandasDevolvidas: number;
  demandasCanceladas: number;
  demandasConvertidas: number;
  valorTotalEstimado: number;
  valorTotalAprovado: number;
  itensConsolidados: ItemConsolidadoPCA[];
}

export function normalizarDescricao(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizarUnidadeMedida(unidade: string): string {
  return unidade
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function consolidarDemandasPCA(
  demandas: DemandaPCARow[],
  options?: { somenteAprovadas?: boolean; excluirInativas?: boolean },
): ResumoExercicioPCA {
  let aguardando = 0;
  let aprovadas = 0;
  let devolvidas = 0;
  let canceladas = 0;
  let convertidas = 0;
  let valorTotalEstimado = 0;
  let valorTotalAprovado = 0;

  const mapaItens: Record<
    string,
    ItemConsolidadoPCA & { demandaIds: Set<string>; qtyScaled: number; valorCentavos: number }
  > = {};

  for (const d of demandas) {
    const status = d.review_status ?? (d.process_id ? "converted" : d.approved_at ? "approved" : "submitted");
    const estaCancelada = status === "cancelled";
    const estaDevolvida = status === "rejected";
    const estaAprovadaOuConvertida = Boolean(d.process_id || d.approved_at || status === "approved" || status === "converted");

    if (d.process_id || status === "converted") {
      convertidas++;
    } else if (estaCancelada) {
      canceladas++;
    } else if (estaDevolvida) {
      devolvidas++;
    } else if (d.approved_at || status === "approved") {
      aprovadas++;
    } else {
      aguardando++;
    }

    let somaItensValor = 0;
    const podeConsolidarItens =
      (!options?.excluirInativas || (!estaCancelada && !estaDevolvida)) &&
      (!options?.somenteAprovadas || estaAprovadaOuConvertida);

    if (Array.isArray(d.items)) {
      for (const raw of d.items) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const item = raw as Record<string, unknown>;
        const desc = String(item["description"] || "").trim();
        const un = normalizarUnidadeMedida(String(item["unit"] || ""));
        const qtd = Number(item["quantity"]) || 0;
        const unitPrice =
          item["estimated_unit_price"] !== undefined && item["estimated_unit_price"] !== null
            ? Number(item["estimated_unit_price"])
            : Number.NaN;

        if (!desc || qtd <= 0) continue;
        const itemTotal =
          Number.isFinite(unitPrice) && unitPrice >= 0
            ? Math.round((qtd * unitPrice + Number.EPSILON) * 100) / 100
            : 0;
        somaItensValor += itemTotal;

        if (!podeConsolidarItens) continue;

        const chave = `${normalizarDescricao(desc)}__${un}`;
        if (!mapaItens[chave]) {
          mapaItens[chave] = {
            descricaoNormalizada: normalizarDescricao(desc),
            descricaoOriginal: desc,
            unidade: un,
            quantidadeTotal: 0,
            valorEstimadoTotal: 0,
            totalDemandasOrigem: 0,
            demandaIds: new Set<string>(),
            qtyScaled: 0,
            valorCentavos: 0,
          };
        }
        mapaItens[chave].qtyScaled += Math.round(qtd * 10_000);
        mapaItens[chave].valorCentavos += Math.round(itemTotal * 100);
        mapaItens[chave].demandaIds.add(d.id);
      }
    }

    const demandaValor =
      d.estimated_total_value !== undefined && d.estimated_total_value !== null
        ? Number(d.estimated_total_value)
        : Math.round(somaItensValor * 100) / 100;

    if (!estaCancelada && Number.isFinite(demandaValor) && demandaValor > 0) {
      valorTotalEstimado = Math.round((valorTotalEstimado + demandaValor + Number.EPSILON) * 100) / 100;
      if (estaAprovadaOuConvertida) {
        valorTotalAprovado = Math.round((valorTotalAprovado + demandaValor + Number.EPSILON) * 100) / 100;
      }
    }
  }

  const itensConsolidados: ItemConsolidadoPCA[] = Object.values(mapaItens)
    .map((entry) => ({
      descricaoNormalizada: entry.descricaoNormalizada,
      descricaoOriginal: entry.descricaoOriginal,
      unidade: entry.unidade,
      quantidadeTotal: entry.qtyScaled / 10_000,
      valorEstimadoTotal: entry.valorCentavos / 100,
      totalDemandasOrigem: entry.demandaIds.size,
    }))
    .sort((a, b) => b.quantidadeTotal - a.quantidadeTotal);

  return {
    totalDemandas: demandas.length,
    demandasAguardando: aguardando,
    demandasAprovadas: aprovadas,
    demandasDevolvidas: devolvidas,
    demandasCanceladas: canceladas,
    demandasConvertidas: convertidas,
    valorTotalEstimado,
    valorTotalAprovado,
    itensConsolidados,
  };
}

export type CronogramaPcaAlerta = {
  fase: string;
  status: "no_prazo" | "atencao" | "atrasado" | "encerrado";
  titulo: string;
  descricao: string;
};

/**
 * Avalia os marcos do Decreto nº 10.947/2022 para o exercício do PCA informado.
 * - Consolidação pelos setores de contratações: até 15 de maio de (planYear - 1).
 * - Revisão e adequação orçamentária (PLOA/LOA): setembro a novembro de (planYear - 1) e janeiro de planYear.
 * - Execução e revisões no exercício: durante todo o ano de planYear (art. 16).
 */
export function avaliarCronogramaPca(
  planYear: number,
  referenceDateIso?: string,
): CronogramaPcaAlerta {
  const today =
    referenceDateIso ??
    (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    })();
  const prevYear = planYear - 1;
  const consolidationDeadline = `${prevYear}-05-15`;
  const revisionStart = `${prevYear}-09-01`;
  const revisionEnd = `${prevYear}-11-15`;
  const executionEnd = `${planYear}-12-31`;

  if (today > executionEnd) {
    return {
      fase: "Exercício encerrado",
      status: "encerrado",
      titulo: `PCA ${planYear} encerrado`,
      descricao: `O exercício ${planYear} já foi finalizado. Consulte os registros históricos ou inicie demandas para o próximo ciclo.`,
    };
  }
  if (today >= `${planYear}-01-01`) {
    return {
      fase: "Execução e revisão",
      status: "no_prazo",
      titulo: `PCA ${planYear} em vigência e execução`,
      descricao:
        "Adequações da LOA (até 15 dias após publicação) e revisões ou inclusões justificadas seguem o art. 16 do Decreto nº 10.947/2022.",
    };
  }
  if (today >= revisionStart && today <= revisionEnd) {
    return {
      fase: "Revisão orçamentária",
      status: "atencao",
      titulo: `Janela de revisão e conciliação com o PLOA ${planYear}`,
      descricao: `De 1º de setembro a 15 de novembro de ${prevYear}, concilie as demandas com a proposta orçamentária (Decreto nº 10.947/2022, art. 12).`,
    };
  }
  if (today > consolidationDeadline) {
    return {
      fase: "Pós-consolidação",
      status: "atrasado",
      titulo: `Prazo ordinário de consolidação vencido em 15/05/${prevYear}`,
      descricao:
        "Novas demandas ou ajustes antes da abertura do exercício exigem justificativa técnica e validação da autoridade competente.",
    };
  }
  return {
    fase: "Elaboração e consolidação",
    status: "no_prazo",
    titulo: `Coleta e consolidação de DFD até 15/05/${prevYear}`,
    descricao: `As unidades requisitantes têm até 30/04/${prevYear} para formalizar as demandas (DFD) e o setor de compras consolida o PCA até 15/05/${prevYear}.`,
  };
}
