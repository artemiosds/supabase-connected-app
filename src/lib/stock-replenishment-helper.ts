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
export type MovimentoItemParaReposicao = { movement_type: string; quantity: number };
export type ItemCriticoSugerido = ItemContratoParaReposicao & {
  percentualDisponivel: number;
  nivel: "esgotado" | "critico";
  quantidadeSugerida: number;
  selecionado: boolean;
};

export function filtrarItensCriticosParaReposicao(
  items: ItemContratoParaReposicao[],
  movementsByItem: Record<string, MovimentoItemParaReposicao[]>,
): ItemCriticoSugerido[] {
  return items.flatMap((item) => {
    if (!Number.isFinite(Number(item.quantity_total)) || Number(item.quantity_total) <= 0)
      return [];
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

export function montarSugestaoProcessoReposicao(params: {
  contractNumber: string;
  contractObject?: string | null;
  itensCriticos: ItemCriticoSugerido[];
  year?: number;
}) {
  const totalItens = params.itensCriticos.length;
  const temEsgotado = params.itensCriticos.some((item) => item.nivel === "esgotado");
  const numero = params.contractNumber.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
  return {
    number: "PROC-REP-" + numero + "-" + (params.year ?? new Date().getFullYear()),
    title:
      "Reposição de Estoque: " +
      totalItens +
      " item(ns) críticos — Ref. Contrato " +
      params.contractNumber,
    description:
      "Aquisição de reposição preventiva de estoque para a rede de saúde, em razão de saldo esgotado ou crítico no Contrato nº " +
      params.contractNumber +
      ". Itens prioritários: " +
      params.itensCriticos
        .slice(0, 3)
        .map((item) => item.description)
        .join(", ") +
      (totalItens > 3 ? " e outros " + (totalItens - 3) + " item(ns)." : "."),
    modality: "pregao" as "pregao" | "dispensa",
    priority: temEsgotado ? ("urgente" as const) : ("alta" as const),
    requesting_unit: "",
  };
}

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
  return params.itens.map((item, index) => ({
    tenant_id: params.tenantId,
    process_id: params.processId,
    line_number: index + 1,
    description: item.description.trim(),
    technical_specification: item.specification?.trim() || null,
    unit: item.unit.trim(),
    quantity: item.quantidadeSugerida,
    estimated_unit_price: item.unit_value > 0 ? item.unit_value : null,
    estimated_total: item.unit_value > 0 ? item.quantidadeSugerida * item.unit_value : null,
    estimated_price_source: "contrato_anterior",
    is_active: true,
    created_by: params.userId,
    updated_by: params.userId,
  }));
}
