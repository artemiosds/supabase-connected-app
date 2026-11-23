import {
  calcularPercentualDisponivel,
  calcularQuantidadeConsumida,
  calcularSaldoDisponivel,
  type ContractItemMovement,
} from "./contract-item-balance";

export interface DossierContractData {
  number: string;
  instrumentType: string;
  modality: string;
  object: string;
  startDate: string;
  endDate: string;
  totalValue: number;
  status: string;
  managerName?: string | null;
  inspectorName?: string | null;
  ordinance?: string | null;
}

export interface DossierSupplierData {
  name: string;
  cnpj: string;
}

export interface DossierAmendmentData {
  number: string;
  kind: string;
  signedAt: string;
  newEndDate?: string | null;
  valueChange: number;
  notes?: string | null;
}

export interface DossierItemInput {
  id: string;
  lineNumber: number;
  description: string;
  unit: string;
  quantityTotal: number;
  unitValue: number;
}

export interface DossierMovementInput extends ContractItemMovement {
  contract_item_id: string;
}

export interface DossierOrderData {
  referenceNumber: string;
  createdAt: string;
  reason: string;
  itemsCount: number;
  totalValue: number;
}

export interface DossierSummary {
  originalValue: number;
  amendmentsValueChange: number;
  updatedValue: number;
  executedValue: number;
  balanceValue: number;
  executionPercentage: number;
  totalItems: number;
  totalOrders: number;
}

export interface DossierItemCalculated {
  lineNumber: number;
  description: string;
  unit: string;
  quantityTotal: number;
  quantityConsumed: number;
  quantityBalance: number;
  unitValue: number;
  totalContracted: number;
  totalConsumed: number;
  totalBalance: number;
  percentConsumed: number;
}

export interface ContractDossierPdfPayload {
  tenantName: string;
  contract: DossierContractData;
  processNumber?: string | null;
  supplier: DossierSupplierData;
  amendments: DossierAmendmentData[];
  items: DossierItemCalculated[];
  orders: DossierOrderData[];
  summary: DossierSummary;
  generatedAt: string;
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const quantityFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 4,
});

function singleLine(value: unknown, fallback = "Não informado"): string {
  const safe = Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159) ? " " : character;
  }).join("");
  return safe.replace(/\s+/g, " ").trim() || fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : singleLine(value);
}

export function formatarDataIsoPtBr(isoDate: string | null | undefined): string {
  if (!isoDate) return "Não informada";

  const datePart = isoDate.split("T")[0]?.split(" ")[0] ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return singleLine(isoDate);

  const [, year, month, day] = match;
  const parsed = new Date(year + "-" + month + "-" + day + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== datePart) {
    return singleLine(isoDate);
  }

  return day + "/" + month + "/" + year;
}

export function traduzirTipoAditivo(kind: string): string {
  switch (kind) {
    case "prorrogacao":
      return "Prorrogação de Vigência";
    case "acrescimo":
      return "Acréscimo de Valor/Quantitativo";
    case "supressao":
      return "Supressão de Valor/Quantitativo";
    case "reajuste":
      return "Reajuste de Preços";
    case "qualificacao":
      return "Alteração Qualitativa";
    case "apostilamento":
      return "Apostilamento";
    default:
      return kind || "Aditivo";
  }
}

/**
 * Calcula os saldos analíticos por item e consolida os totais financeiros.
 * Os movimentos preservam o formato nativo (consumption/reversal) do módulo de contratos.
 */
export function calcularResumoDossieContratual(params: {
  contractTotalValue: number;
  items: DossierItemInput[];
  movements: DossierMovementInput[];
  amendments: DossierAmendmentData[];
  ordersCount: number;
}): { itemsCalculated: DossierItemCalculated[]; summary: DossierSummary } {
  if (!Number.isFinite(params.contractTotalValue) || params.contractTotalValue < 0) {
    throw new RangeError("O valor original do instrumento deve ser finito e não negativo.");
  }
  if (!Number.isInteger(params.ordersCount) || params.ordersCount < 0) {
    throw new RangeError("A quantidade de ordens deve ser um inteiro não negativo.");
  }

  const movementsByItem: Record<string, DossierMovementInput[]> = {};
  for (const movement of params.movements) {
    if (!movementsByItem[movement.contract_item_id]) {
      movementsByItem[movement.contract_item_id] = [];
    }
    movementsByItem[movement.contract_item_id]?.push(movement);
  }

  let totalExecutedValue = 0;

  const itemsCalculated: DossierItemCalculated[] = params.items.map((item) => {
    if (!Number.isFinite(item.unitValue) || item.unitValue < 0) {
      throw new RangeError("O valor unitário do item deve ser finito e não negativo.");
    }

    const itemMovements = movementsByItem[item.id] ?? [];
    const consumed = Math.max(0, calcularQuantidadeConsumida(itemMovements));
    const balance = calcularSaldoDisponivel(item.quantityTotal, itemMovements);
    const percentAvailable = calcularPercentualDisponivel(item.quantityTotal, itemMovements);
    const totalContracted = roundMoney(item.quantityTotal * item.unitValue);
    const totalConsumed = roundMoney(consumed * item.unitValue);
    const totalBalance = roundMoney(balance * item.unitValue);

    totalExecutedValue += totalConsumed;

    return {
      lineNumber: item.lineNumber,
      description: item.description,
      unit: item.unit,
      quantityTotal: item.quantityTotal,
      quantityConsumed: consumed,
      quantityBalance: balance,
      unitValue: item.unitValue,
      totalContracted,
      totalConsumed,
      totalBalance,
      percentConsumed: Math.max(0, Math.min(100, 100 - percentAvailable)),
    };
  });

  const amendmentsValueChange = roundMoney(
    params.amendments.reduce((total, amendment) => {
      if (!Number.isFinite(amendment.valueChange)) {
        throw new RangeError("A alteração de valor de um aditivo não é válida.");
      }
      return total + amendment.valueChange;
    }, 0),
  );

  const updatedValue = roundMoney(params.contractTotalValue + amendmentsValueChange);
  if (updatedValue < 0) {
    throw new RangeError("O valor atualizado do instrumento não pode ser negativo.");
  }

  totalExecutedValue = roundMoney(totalExecutedValue);
  const balanceValue = roundMoney(Math.max(0, updatedValue - totalExecutedValue));
  const executionPercentage =
    updatedValue > 0
      ? Math.max(0, Math.min(100, (totalExecutedValue / updatedValue) * 100))
      : 0;

  const summary: DossierSummary = {
    originalValue: roundMoney(params.contractTotalValue),
    amendmentsValueChange,
    updatedValue,
    executedValue: totalExecutedValue,
    balanceValue,
    executionPercentage,
    totalItems: params.items.length,
    totalOrders: params.ordersCount,
  };

  return { itemsCalculated, summary };
}

/**
 * Produz texto estruturado em tabelas para o motor documental nativo do Primus.
 * A ordenação cronológica é garantida mesmo que a origem entregue registros fora de ordem.
 */
export function buildContractDossierDocumentText(payload: ContractDossierPdfPayload): string {
  const lines: string[] = [];

  lines.push("DOSSIÊ DE EXECUÇÃO CONTRATUAL E PRESTAÇÃO DE CONTAS");
  lines.push("INSTRUMENTO Nº " + singleLine(payload.contract.number));
  lines.push("");

  lines.push("1. IDENTIFICAÇÃO DO INSTRUMENTO E DAS PARTES");
  lines.push("Órgão Contratante: " + singleLine(payload.tenantName));
  lines.push("Instrumento / Contrato nº: " + singleLine(payload.contract.number));
  lines.push("Processo Administrativo de Origem: " + singleLine(payload.processNumber, "Não vinculado"));
  lines.push("Modalidade de Contratação: " + singleLine(payload.contract.modality).toUpperCase());
  lines.push("Tipo de Instrumento: " + singleLine(payload.contract.instrumentType).toUpperCase());
  lines.push("Situação Cadastral: " + singleLine(payload.contract.status).toUpperCase());
  lines.push("Objeto: " + singleLine(payload.contract.object));
  lines.push("Contratada / Favorecido: " + singleLine(payload.supplier.name));
  lines.push("CNPJ: " + formatCnpj(payload.supplier.cnpj));
  lines.push(
    "Vigência Atual: " +
      formatarDataIsoPtBr(payload.contract.startDate) +
      " a " +
      formatarDataIsoPtBr(payload.contract.endDate),
  );
  lines.push("Gestor do Contrato: " + singleLine(payload.contract.managerName, "Não designado formalmente"));
  lines.push("Fiscal do Contrato: " + singleLine(payload.contract.inspectorName, "Não designado formalmente"));
  if (payload.contract.ordinance) {
    lines.push("Portaria de Designação: " + singleLine(payload.contract.ordinance));
  }
  lines.push("");

  lines.push("2. HISTÓRICO DE TERMOS ADITIVOS E APOSTILAMENTOS");
  const amendments = [...payload.amendments].sort(
    (left, right) =>
      left.signedAt.localeCompare(right.signedAt) || left.number.localeCompare(right.number),
  );
  if (amendments.length === 0) {
    lines.push("Nenhum termo aditivo ou apostilamento registrado até a presente data.");
  } else {
    lines.push(
      ["Termo", "Espécie", "Assinatura", "Nova Vigência", "Alteração de Valor", "Observações"].join("\t"),
    );
    for (const amendment of amendments) {
      lines.push(
        [
          singleLine(amendment.number),
          singleLine(traduzirTipoAditivo(amendment.kind)),
          formatarDataIsoPtBr(amendment.signedAt),
          amendment.newEndDate ? formatarDataIsoPtBr(amendment.newEndDate) : "Inalterada",
          currency.format(amendment.valueChange || 0),
          singleLine(amendment.notes, "—"),
        ].join("\t"),
      );
    }
  }
  lines.push("");

  lines.push("3. DEMONSTRATIVO ANALÍTICO DE EXECUÇÃO POR ITEM");
  lines.push(
    [
      "Item",
      "Descrição / Unid.",
      "Qtd. Contratada",
      "Qtd. Fornecida",
      "Saldo Físico",
      "% Consumido",
      "Preço Unitário",
      "Total Contratado",
      "Total Executado",
      "Saldo Financeiro",
    ].join("\t"),
  );
  for (const item of payload.items) {
    lines.push(
      [
        String(item.lineNumber),
        singleLine(item.description) + " / " + singleLine(item.unit),
        quantityFormat.format(item.quantityTotal),
        quantityFormat.format(item.quantityConsumed),
        quantityFormat.format(item.quantityBalance),
        item.percentConsumed.toFixed(1) + "%",
        currency.format(item.unitValue),
        currency.format(item.totalContracted),
        currency.format(item.totalConsumed),
        currency.format(item.totalBalance),
      ].join("\t"),
    );
  }
  lines.push("");

  lines.push("4. RESUMO FINANCEIRO CONSOLIDADO DA EXECUÇÃO");
  lines.push("Valor Global Original do Instrumento: " + currency.format(payload.summary.originalValue));
  lines.push("Variação Acumulada por Termos Aditivos: " + currency.format(payload.summary.amendmentsValueChange));
  lines.push("Valor Global Atualizado do Instrumento: " + currency.format(payload.summary.updatedValue));
  lines.push("Valor Total Executado / Fornecido: " + currency.format(payload.summary.executedValue));
  lines.push("Saldo Financeiro Disponível: " + currency.format(payload.summary.balanceValue));
  lines.push("Percentual de Execução Global: " + payload.summary.executionPercentage.toFixed(2) + "%");
  lines.push("Quantidade de Itens Contratuais: " + String(payload.summary.totalItems));
  lines.push("Ordens de Fornecimento Identificadas: " + String(payload.summary.totalOrders));
  lines.push("");

  lines.push("5. HISTÓRICO CRONOLÓGICO DE ORDENS DE FORNECIMENTO");
  const orders = [...payload.orders].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.referenceNumber.localeCompare(right.referenceNumber),
  );
  if (orders.length === 0) {
    lines.push("Nenhuma ordem de fornecimento emitida para este instrumento.");
  } else {
    lines.push(
      ["Ordem / Empenho", "Data de Emissão", "Qtd. Itens", "Finalidade / Destino", "Valor Total"].join("\t"),
    );
    for (const order of orders) {
      lines.push(
        [
          singleLine(order.referenceNumber),
          formatarDataIsoPtBr(order.createdAt),
          String(order.itemsCount),
          singleLine(order.reason),
          currency.format(order.totalValue),
        ].join("\t"),
      );
    }
  }
  lines.push("");

  lines.push("6. TERMO DE FISCALIZAÇÃO, ATESTO E PRESTAÇÃO DE CONTAS");
  lines.push(
    "Atestamos, para os devidos fins de controle interno, auditoria e prestação de contas junto ao Tribunal de Contas, " +
      "que os quantitativos e valores discriminados neste dossiê refletem os registros de execução, " +
      "as ordens de fornecimento, notas de entrega e medições vinculadas ao Contrato nº " +
      singleLine(payload.contract.number) +
      ", nos termos do art. 117 da Lei Federal nº 14.133/2021, após conferência pelos responsáveis abaixo assinados.",
  );
  lines.push("Dossiê gerado eletronicamente em: " + singleLine(payload.generatedAt));
  lines.push("");
  lines.push("ASSINATURAS DOS RESPONSÁVEIS:");
  lines.push("");
  lines.push("____________________________________________________________");
  lines.push(singleLine(payload.contract.inspectorName, "Fiscal do Contrato"));
  lines.push("Fiscal Designado — Matrícula / Portaria: " + singleLine(payload.contract.ordinance, "Conforme designação"));
  lines.push("");
  lines.push("____________________________________________________________");
  lines.push(singleLine(payload.contract.managerName, "Gestor do Contrato"));
  lines.push("Gestor do Contrato");
  lines.push("");
  lines.push("____________________________________________________________");
  lines.push("Secretário(a) Municipal de Saúde / Ordenador(a) de Despesas");
  lines.push(singleLine(payload.tenantName));
  lines.push("");
  lines.push("____________________________________________________________");
  lines.push(singleLine(payload.supplier.name));
  lines.push("Representante Legal da Contratada (CNPJ: " + formatCnpj(payload.supplier.cnpj) + ")");

  return lines.join("\n");
}
