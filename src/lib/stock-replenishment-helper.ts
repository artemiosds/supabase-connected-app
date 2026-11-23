import { calcularPercentualDisponivel, classificarNivelSaldo } from "./contract-item-balance";

export type ItemContratoParaReposicao = {
  id: string;
  line_number: number;
  description: string;
  specification: string | null;
  unit: string;
  quantity_total: number;
  unit_value: number;
};

export type MovimentoItemParaReposicao = {
  movement_type: string;
  quantity: number;
};

export type ItemCriticoSugerido = ItemContratoParaReposicao & {
  percentualDisponivel: number;
  nivel: "esgotado" | "critico";
  quantidadeSugerida: number;
  selecionado: boolean;
};

/**
 * Filtra itens com saldo esgotado (0%) ou crítico (até 20%) e prepara
 * sugestões sem recalcular regras que já pertencem ao módulo de saldos.
 */
export function filtrarItensCriticosParaReposicao(
  items: ItemContratoParaReposicao[],
  movementsByItem: Record<string, MovimentoItemParaReposicao[]>,
): ItemCriticoSugerido[] {
  return items.flatMap((item) => {
    if (!Number.isFinite(Number(item.quantity_total)) || Number(item.quantity_total) <= 0) {
      return [];
    }

    const percentualDisponivel = calcularPercentualDisponivel(
      Number(item.quantity_total),
      movementsByItem[item.id] ?? [],
    );
    const nivel = classificarNivelSaldo(percentualDisponivel);

    if (nivel !== "esgotado" && nivel !== "critico") return [];

    return [
      {
        ...item,
        percentualDisponivel,
        nivel,
        quantidadeSugerida: Number(item.quantity_total),
        selecionado: true,
      },
    ];
  });
}

/**
 * Monta os valores iniciais do novo processo de reposição.
 * O preço anterior é apenas uma referência histórica e não substitui
 * a pesquisa oficial de preços do novo procedimento.
 */
export function montarSugestaoProcessoReposicao(params: {
  contractNumber: string;
  contractObject?: string | null;
  itensCriticos: ItemCriticoSugerido[];
  year?: number;
}) {
  const totalItens = params.itensCriticos.length;
  const temEsgotado = params.itensCriticos.some((item) => item.nivel === "esgotado");
  const numero = params.contractNumber.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
  const objeto = params.contractObject?.trim();

  return {
    number: "PROC-REP-" + numero + "-" + (params.year ?? new Date().getFullYear()),
    title:
      "Reposição de Estoque: " +
      totalItens +
      " item(ns) críticos — Ref. Contrato " +
      params.contractNumber,
    description:
      "Aquisição de reposição de estoque para a rede municipal de saúde, em razão de saldo esgotado ou crítico no Contrato nº " +
      params.contractNumber +
      (objeto ? ". Objeto do contrato de origem: " + objeto : "") +
      ". Itens prioritários: " +
      params.itensCriticos
        .slice(0, 3)
        .map((item) => item.description)
        .join(", ") +
      (totalItens > 3 ? " e outros " + (totalItens - 3) + " item(ns)." : ".") +
      " Os preços unitários pré-preenchidos são referências históricas do contrato de origem, registradas como estimativas manuais preliminares; não substituem a pesquisa de preços e a aprovação exigidas no novo processo.",
    modality: "dispensa" as "pregao" | "dispensa",
    priority: temEsgotado ? ("urgente" as const) : ("alta" as const),
    requesting_unit: "Fundo Municipal de Saúde / Almoxarifado Central",
  };
}

/**
 * Mapeia somente colunas graváveis de procurement_items.
 * estimated_total é GENERATED ALWAYS no PostgreSQL e deve ser omitida.
 * A origem 'manual' é a única permitida em INSERT pelo cliente; os fluxos
 * internos registram quote_reference/approved após a pesquisa oficial.
 */
export function prepararProcurementItemsParaInsercao(params: {
  processId: string;
  tenantId: string;
  userId: string;
  itens: Array<
    Pick<
      ItemCriticoSugerido,
      "description" | "specification" | "unit" | "quantidadeSugerida" | "unit_value"
    >
  >;
}) {
  if (params.itens.length > 99_999) {
    throw new RangeError("O processo não pode receber mais de 99.999 itens.");
  }

  return params.itens.map((item, index) => {
    const description = item.description.trim();
    const unit = item.unit.trim();
    const quantity = Number(item.quantidadeSugerida);
    const unitValue = Number(item.unit_value);

    if (description.length < 3 || description.length > 500) {
      throw new RangeError("A descrição do item deve ter entre 3 e 500 caracteres.");
    }
    if (unit.length < 1 || unit.length > 30) {
      throw new RangeError("A unidade do item deve ter entre 1 e 30 caracteres.");
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9_999_999_999.9999) {
      throw new RangeError("A quantidade a adquirir deve ser positiva e válida.");
    }
    if (!Number.isFinite(unitValue) || unitValue < 0) {
      throw new RangeError("O preço histórico do item deve ser um número válido e não negativo.");
    }

    return {
      tenant_id: params.tenantId,
      process_id: params.processId,
      line_number: index + 1,
      description,
      technical_specification: item.specification?.trim() || null,
      unit,
      quantity,
      estimated_unit_price: unitValue > 0 ? unitValue : null,
      estimated_price_source: "manual",
      is_active: true,
      created_by: params.userId,
      updated_by: params.userId,
    };
  });
}
