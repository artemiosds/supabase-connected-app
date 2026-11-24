// =============================================================================
// process-dossier-pdf-helper.ts — Consolidador do Dossiê do Processo para o TCE
// Primus Gestão — Lei 14.133/2021 & IN 65/2021
// =============================================================================

export interface ProcessDossierProcessData {
  number: string;
  title: string;
  modality: string;
  status: string;
  createdAt: string;
  responsibleName?: string | null;
  legalBasis?: string | null;
  fundingSource?: string | null;
}

export interface ProcessDossierItemData {
  itemNumber: number;
  description: string;
  unit: string;
  quantity: number;
  estimatedPrice: number;
  approvedPrice: number;
  winnerSupplierName?: string | null;
  winnerSupplierCnpj?: string | null;
}

export interface ProcessDossierQuoteData {
  supplierName: string;
  supplierCnpj: string;
  quotedItemsCount: number;
  totalQuotedValue: number;
}

export interface ProcessDossierContractData {
  number: string;
  supplierName: string;
  supplierCnpj: string;
  startDate: string;
  endDate: string;
  totalValue: number;
  status: string;
}

export interface ProcessDossierSummary {
  totalEstimated: number;
  totalHomologated: number;
  totalEconomy: number;
  economyPercentage: number;
  totalItems: number;
  totalContracts: number;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calcularResumoDossieProcesso(
  items: ProcessDossierItemData[],
  contractsCount: number
): ProcessDossierSummary {
  let totalEstimated = 0;
  let totalHomologated = 0;

  for (const item of items) {
    const estimatedSubtotal = roundMoney(item.quantity * item.estimatedPrice);
    const approvedPriceEffective = item.approvedPrice > 0 ? item.approvedPrice : item.estimatedPrice;
    const homologatedSubtotal = roundMoney(item.quantity * approvedPriceEffective);

    totalEstimated = roundMoney(totalEstimated + estimatedSubtotal);
    totalHomologated = roundMoney(totalHomologated + homologatedSubtotal);
  }

  const totalEconomy = roundMoney(Math.max(0, totalEstimated - totalHomologated));
  const economyPercentage =
    totalEstimated > 0 ? roundMoney((totalEconomy / totalEstimated) * 100) : 0;

  return {
    totalEstimated,
    totalHomologated,
    totalEconomy,
    economyPercentage,
    totalItems: items.length,
    totalContracts: contractsCount,
  };
}

export function buildProcessDossierDocumentText(payload: {
  process: ProcessDossierProcessData;
  items: ProcessDossierItemData[];
  quotes: ProcessDossierQuoteData[];
  contracts: ProcessDossierContractData[];
  summary: ProcessDossierSummary;
  generatedBy: string;
  generatedAt?: Date;
}): string {
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const numberFormat = new Intl.NumberFormat("pt-BR");
  const percentFormat = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

  const clean = (val?: string | null) => String(val || "Não informado").replace(/[\t\r\n]/g, " ").trim();
  const dateFormatted = (payload.generatedAt ?? new Date()).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines: string[] = [];

  lines.push("DOSSIÊ CONSOLIDADO DE PRESTAÇÃO DE CONTAS DO PROCESSO LICITATÓRIO");
  lines.push("TRIBUNAL DE CONTAS / ÓRGÃOS DE CONTROLE INTERNO E EXTERNO");
  lines.push(`Processo Administrativo nº ${clean(payload.process.number)}`);
  lines.push(`Documento emitido eletronicamente em ${dateFormatted} por ${clean(payload.generatedBy)}`);
  lines.push("");

  lines.push("1. IDENTIFICAÇÃO E ENQUADRAMENTO NORMATIVO DO PROCESSO");
  lines.push(`Número do Processo:\t${clean(payload.process.number)}`);
  lines.push(`Objeto:\t${clean(payload.process.title)}`);
  lines.push(`Modalidade:\t${clean(payload.process.modality)}`);
  lines.push(`Status Atual:\t${clean(payload.process.status)}`);
  lines.push(`Data de Abertura:\t${clean(payload.process.createdAt)}`);
  lines.push(`Responsável / Condutor:\t${clean(payload.process.responsibleName)}`);
  lines.push(`Fundamentação Legal:\t${clean(payload.process.legalBasis ?? "Lei Federal nº 14.133/2021")}`);
  lines.push(`Origem dos Recursos:\t${clean(payload.process.fundingSource ?? "Recursos Ordinários de Saúde")}`);
  lines.push("");

  lines.push("2. RESUMO FINANCEIRO E ECONOMIA GERADA");
  lines.push(`Valor Global Estimado (Referência):\t${currency.format(payload.summary.totalEstimated)}`);
  lines.push(`Valor Global Homologado (Adjudicado):\t${currency.format(payload.summary.totalHomologated)}`);
  lines.push(`Economia Pública Obtida:\t${currency.format(payload.summary.totalEconomy)} (${percentFormat.format(payload.summary.economyPercentage)}% de desconto)`);
  lines.push(`Total de Itens Licitados:\t${payload.summary.totalItems}`);
  lines.push(`Contratos / Atas Formalizados:\t${payload.summary.totalContracts}`);
  lines.push("");

  lines.push("3. DEMONSTRATIVO ANALÍTICO DOS ITENS E PREÇOS HOMOLOGADOS");
  lines.push(["Item", "Descrição", "Unid.", "Qtd.", "Preço Est.", "Preço Homolog.", "Total Homolog.", "Vencedor Adjudicado"].join("\t"));
  for (const item of payload.items) {
    const totalItem = roundMoney(item.quantity * (item.approvedPrice > 0 ? item.approvedPrice : item.estimatedPrice));
    const winnerLabel = item.winnerSupplierName
      ? `${clean(item.winnerSupplierName)} (${clean(item.winnerSupplierCnpj)})`
      : "Aguardando adjudicação";
    lines.push([
      String(item.itemNumber),
      clean(item.description),
      clean(item.unit),
      numberFormat.format(item.quantity),
      currency.format(item.estimatedPrice),
      currency.format(item.approvedPrice),
      currency.format(totalItem),
      winnerLabel,
    ].join("\t"));
  }
  lines.push("");

  lines.push("4. PAINEL DE COTAÇÕES E FORNECEDORES PARTICIPANTES");
  if (payload.quotes.length === 0) {
    lines.push("Nenhuma proposta formal registrada para este processo.");
  } else {
    lines.push(["Fornecedor", "CNPJ", "Itens Cotados", "Valor Global Ofertado"].join("\t"));
    for (const q of payload.quotes) {
      lines.push([
        clean(q.supplierName),
        clean(q.supplierCnpj),
        String(q.quotedItemsCount),
        currency.format(q.totalQuotedValue),
      ].join("\t"));
    }
  }
  lines.push("");

  lines.push("5. CONTRATOS E ATAS DE REGISTRO DE PREÇOS VINCULADOS");
  if (payload.contracts.length === 0) {
    lines.push("Nenhum contrato ou ata vinculado até a presente data.");
  } else {
    lines.push(["Nº Instrumento", "Fornecedor Contratado", "CNPJ", "Vigência", "Valor Contratado", "Status"].join("\t"));
    for (const c of payload.contracts) {
      lines.push([
        clean(c.number),
        clean(c.supplierName),
        clean(c.supplierCnpj),
        `${clean(c.startDate)} a ${clean(c.endDate)}`,
        currency.format(c.totalValue),
        clean(c.status),
      ].join("\t"));
    }
  }
  lines.push("");

  lines.push("6. TERMO DE AUTESTAÇÃO E CONFORMIDADE PARA O TRIBUNAL DE CONTAS");
  lines.push(
    "Atesto, na qualidade de responsável pela condução e instrução dos autos deste processo administrativo de contratação pública de saúde, que os atos processuais atenderam rigorosamente aos preceitos da Lei Federal nº 14.133/2021, aos princípios da impessoalidade, moralidade, economicidade e eficiência, bem como às normas do Tribunal de Contas competente. Os documentos e mapas originais encontram-se autuados sob custódia digital inviolável."
  );
  lines.push("");
  lines.push(`Local e Data:\tEmitido eletronicamente em ${dateFormatted}`);
  lines.push(`Responsável:\t${clean(payload.generatedBy)}`);
  lines.push("Autenticação Digital:\tRegistro eletrônico auditável no sistema Primus Gestão.");

  return lines.join("\n");
}
