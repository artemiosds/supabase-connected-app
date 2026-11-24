// =============================================================================
// pca-consolidation-helper.ts — Motor de Consolidação Anual de Demandas (PCA)
// Primus Gestão — Fase 3
// =============================================================================

export interface ItemDemandaPCA {
  description: string;
  unit: string;
  quantity: number;
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
}

export interface ItemConsolidadoPCA {
  descricaoNormalizada: string;
  descricaoOriginal: string;
  unidade: string;
  quantidadeTotal: number;
  totalDemandasOrigem: number;
}

export interface ResumoExercicioPCA {
  totalDemandas: number;
  demandasAguardando: number;
  demandasAprovadas: number;
  demandasConvertidas: number;
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

export function consolidarDemandasPCA(demandas: DemandaPCARow[]): ResumoExercicioPCA {
  let aguardando = 0;
  let aprovadas = 0;
  let convertidas = 0;

  const mapaItens: Record<string, ItemConsolidadoPCA> = {};

  for (const d of demandas) {
    if (d.process_id) {
      convertidas++;
    } else if (d.approved_at) {
      aprovadas++;
    } else {
      aguardando++;
    }

    if (Array.isArray(d.items)) {
      for (const raw of d.items) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const item = raw as Record<string, unknown>;
        const desc = String(item["description"] || "").trim();
        const un = String(item["unit"] || "").trim().toUpperCase();
        const qtd = Number(item["quantity"]) || 0;

        if (!desc || qtd <= 0) continue;

        const chave = `${normalizarDescricao(desc)}__${un}`;
        if (!mapaItens[chave]) {
          mapaItens[chave] = {
            descricaoNormalizada: normalizarDescricao(desc),
            descricaoOriginal: desc,
            unidade: un,
            quantidadeTotal: 0,
            totalDemandasOrigem: 0,
          };
        }
        mapaItens[chave].quantidadeTotal += qtd;
        mapaItens[chave].totalDemandasOrigem += 1;
      }
    }
  }

  const itensConsolidados = Object.values(mapaItens).sort(
    (a, b) => b.quantidadeTotal - a.quantidadeTotal
  );

  return {
    totalDemandas: demandas.length,
    demandasAguardando: aguardando,
    demandasAprovadas: aprovadas,
    demandasConvertidas: convertidas,
    itensConsolidados,
  };
}
