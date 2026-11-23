export interface SupplyOrderPdfPayload {
  tenantName: string;
  contractNumber: string;
  contractObject: string;
  processNumber?: string;
  supplierName: string;
  supplierCnpj: string;
  referenceNumber: string;
  reason: string;
  createdAt: string;
  items: Array<{
    lineNumber: number;
    description: string;
    unit: string;
    quantity: number;
    unitValue: number;
    subtotal: number;
  }>;
  totalValue: number;
  responsibleName?: string;
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
function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : singleLine(value);
}
function triplet(value: number): string {
  const units = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const teens = [
    "dez",
    "onze",
    "doze",
    "treze",
    "quatorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove",
  ];
  const tens = [
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
  ];
  const hundreds = [
    "",
    "cento",
    "duzentos",
    "trezentos",
    "quatrocentos",
    "quinhentos",
    "seiscentos",
    "setecentos",
    "oitocentos",
    "novecentos",
  ];
  if (!value) return "";
  if (value === 100) return "cem";
  const result: string[] = [];
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  if (hundred) result.push(hundreds[hundred]!);
  if (rest >= 10 && rest < 20) result.push(teens[rest - 10]!);
  else {
    const ten = Math.floor(rest / 10);
    const unit = rest % 10;
    if (ten) result.push(tens[ten]!);
    if (unit) result.push(units[unit]!);
  }
  return result.join(" e ");
}
function integerInWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999)
    return "valor não disponível";
  if (!value) return "zero";
  const millions = Math.floor(value / 1_000_000),
    thousands = Math.floor((value % 1_000_000) / 1_000),
    remainder = value % 1_000;
  if (millions) {
    const upper = millions === 1 ? "um milhão" : triplet(millions) + " milhões";
    const lower = [
      thousands ? (thousands === 1 ? "mil" : triplet(thousands) + " mil") : "",
      remainder ? triplet(remainder) : "",
    ].filter(Boolean);
    return lower.length
      ? upper +
          (thousands ? " " : " e ") +
          lower.join(
            remainder && thousands && (remainder < 100 || remainder % 100 === 0) ? " e " : " ",
          )
      : upper;
  }
  if (thousands) {
    const upper = thousands === 1 ? "mil" : triplet(thousands) + " mil";
    return remainder
      ? upper + (remainder < 100 || remainder % 100 === 0 ? " e " : " ") + triplet(remainder)
      : upper;
  }
  return triplet(remainder);
}
function amountInWords(value: number): string {
  const centsTotal = Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0;
  const reais = Math.floor(centsTotal / 100),
    cents = centsTotal % 100;
  const realText =
    integerInWords(reais) +
    (reais === 1
      ? " real"
      : reais >= 1_000_000 && reais % 1_000_000 === 0
        ? " de reais"
        : " reais");
  return cents
    ? realText + " e " + integerInWords(cents) + (cents === 1 ? " centavo" : " centavos")
    : realText;
}
/** Produz texto tabular higienizado para o motor documental nativo. */
export function buildSupplyOrderDocumentText(payload: SupplyOrderPdfPayload): string {
  const rows = payload.items.map((item) =>
    [
      String(Number.isFinite(item.lineNumber) ? item.lineNumber : ""),
      singleLine(item.description),
      singleLine(item.unit),
      quantityFormat.format(Number.isFinite(item.quantity) ? item.quantity : 0),
      currency.format(Number.isFinite(item.unitValue) ? item.unitValue : 0),
      currency.format(Number.isFinite(item.subtotal) ? item.subtotal : 0),
    ].join("\t"),
  );
  const total =
    Number.isFinite(payload.totalValue) && payload.totalValue >= 0 ? payload.totalValue : 0;
  const reference = singleLine(payload.referenceNumber);
  return [
    "ORDEM DE FORNECIMENTO / AUTORIZAÇÃO DE COMPRA Nº " + reference,
    "",
    "IDENTIFICAÇÃO DA ORDEM",
    "Secretaria: " + singleLine(payload.tenantName),
    "Contrato / Ata nº: " + singleLine(payload.contractNumber),
    "Processo Administrativo de Origem: " +
      singleLine(payload.processNumber, "Não informado no instrumento"),
    "Objeto: " + singleLine(payload.contractObject),
    "Favorecido / Fornecedor: " + singleLine(payload.supplierName),
    "CNPJ: " + formatCnpj(payload.supplierCnpj),
    "Referência da Ordem / Empenho: " + reference,
    "Data de emissão: " + singleLine(payload.createdAt),
    "",
    "DESTINO E JUSTIFICATIVA",
    singleLine(payload.reason),
    "",
    "ITENS SOLICITADOS",
    ["Item", "Descrição", "Unidade", "Qtd. Solicitada", "Preço Unit. (R$)", "Total (R$)"].join(
      "\t",
    ),
    ...rows,
    "",
    "Itens solicitados: " + payload.items.length,
    "VALOR TOTAL DA ORDEM: " + currency.format(total) + " (" + amountInWords(total) + ")",
    "",
    "PRAZO, ENTREGA E FISCALIZAÇÃO",
    "O prazo e as condições de entrega seguem as cláusulas do contrato ou da ata vigente.",
    "O recebimento e o ateste dos itens são obrigatórios pelo fiscal designado, conforme as condições contratuais.",
    "",
    "ASSINATURAS",
    "____________________________________________________________",
    "Secretário(a) de Saúde / Ordenador(a) de Despesas",
    singleLine(payload.tenantName),
    "",
    "____________________________________________________________",
    singleLine(payload.responsibleName, "Fiscal designado no contrato"),
    "Fiscal do Contrato",
    "Data: _____/_____/________",
  ].join("\n");
}
