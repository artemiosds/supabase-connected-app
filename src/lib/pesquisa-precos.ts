export type ItemMapa = {
  id: string;
  line_number: number;
  description: string;
  unit: string;
  quantity: number;
};

export type CotacaoMapa = {
  id: string;
  procurement_item_id: string;
  source_name: string;
  quoted_at: string;
  quantity: number;
  unit_price: number;
  delivery_cost: number;
  total_price: number | null;
  reference_url?: string | null;
  selected_for_estimate: boolean;
};

type Precificacao = Pick<CotacaoMapa, "quantity" | "unit_price" | "delivery_cost" | "total_price">;

export type ResumoDePrecos = {
  quantidade: number;
  menor: number | null;
  media: number | null;
  mediana: number | null;
  coeficienteVariacao: number | null;
};

export function precoUnitarioComFrete(quote: Precificacao): number | null {
  const quantity = Number(quote.quantity);
  const unitPrice = Number(quote.unit_price);
  const delivery = Number(quote.delivery_cost);
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    !Number.isFinite(delivery) ||
    delivery < 0
  ) {
    return null;
  }
  const total = quote.total_price ?? unitPrice * quantity + delivery;
  if (!Number.isFinite(total) || total < 0) return null;
  return total / quantity;
}

export function calcularResumoDePrecos(quotes: Precificacao[]): ResumoDePrecos {
  const values = quotes
    .map(precoUnitarioComFrete)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return { quantidade: 0, menor: null, media: null, mediana: null, coeficienteVariacao: null };
  }
  const media = values.reduce((sum, value) => sum + value, 0) / values.length;
  const firstValue = values[0];
  if (firstValue === undefined) {
    return { quantidade: 0, menor: null, media: null, mediana: null, coeficienteVariacao: null };
  }
  const middle = Math.floor(values.length / 2);
  const lower = values[middle - 1] ?? firstValue;
  const upper = values[middle] ?? firstValue;
  const mediana = values.length % 2 === 0 ? (lower + upper) / 2 : upper;
  const variance = values.reduce((sum, value) => sum + (value - media) ** 2, 0) / values.length;
  return {
    quantidade: values.length,
    menor: firstValue,
    media,
    mediana,
    coeficienteVariacao: media > 0 ? (Math.sqrt(variance) / media) * 100 : null,
  };
}

function escaparCelulaCsv(value: string | number | boolean | null | undefined): string {
  let text = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function gerarCsvMapaDePrecos(
  processNumber: string,
  items: ItemMapa[],
  quotes: CotacaoMapa[],
): string {
  const rows: Array<Array<string | number | boolean | null>> = [
    [
      "Processo",
      "Item",
      "Descrição",
      "Unidade",
      "Quantidade prevista",
      "Fonte",
      "Data da cotação",
      "Quantidade cotada",
      "Preço unitário",
      "Frete",
      "Preço total",
      "Preço unitário equivalente com frete",
      "Selecionada como referência",
      "Média unitária",
      "Mediana unitária",
      "Menor unitário",
      "Coeficiente de variação (%)",
      "Referência consultada",
    ],
  ];
  for (const item of items) {
    const itemQuotes = quotes.filter((quote) => quote.procurement_item_id === item.id);
    const summary = calcularResumoDePrecos(itemQuotes);
    for (const quote of itemQuotes) {
      rows.push([
        processNumber,
        item.line_number,
        item.description,
        item.unit,
        item.quantity,
        quote.source_name,
        quote.quoted_at,
        quote.quantity,
        quote.unit_price,
        quote.delivery_cost,
        quote.total_price,
        precoUnitarioComFrete(quote),
        quote.selected_for_estimate ? "Sim" : "Não",
        summary.media,
        summary.mediana,
        summary.menor,
        summary.coeficienteVariacao,
        quote.reference_url ?? "",
      ]);
    }
  }
  return "\uFEFF" + rows.map((row) => row.map(escaparCelulaCsv).join(";")).join("\r\n");
}
