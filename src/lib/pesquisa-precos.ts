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
  const dispersao = analisarDispersaoPrecos(values);
  return {
    quantidade: values.length,
    menor: firstValue,
    media,
    mediana: calcularMediana(values),
    coeficienteVariacao: dispersao.coeficienteVariacao,
  };
}

export function calcularPrecoUnitarioEfetivo(
  quantidade: number,
  precoUnitario: number,
  freteRateado: number,
): number | null {
  if (
    ![quantidade, precoUnitario, freteRateado].every(Number.isFinite) ||
    quantidade <= 0 ||
    precoUnitario < 0 ||
    freteRateado < 0
  )
    return null;
  const valor = precoUnitario + freteRateado / quantidade;
  return Number.isFinite(valor) ? valor : null;
}
function validarPrecos(precos: number[]) {
  if (precos.some((p) => !Number.isFinite(p) || p < 0))
    throw new RangeError("Preços devem ser finitos e não negativos.");
}
export function calcularMediana(precosValidos: number[]): number | null {
  validarPrecos(precosValidos);
  if (!precosValidos.length) return null;
  const p = [...precosValidos].sort((a, b) => a - b),
    i = Math.floor(p.length / 2);
  return p.length % 2 ? p[i]! : p[i - 1]! / 2 + p[i]! / 2;
}
export function analisarDispersaoPrecos(precosValidos: number[]) {
  validarPrecos(precosValidos);
  const n = precosValidos.length;
  const media = n ? precosValidos.reduce((s, p) => s + p / n, 0) : null;
  const desvioPadraoAmostral =
    n > 1 && media !== null
      ? Math.hypot(...precosValidos.map((p) => (p - media) / Math.sqrt(n - 1)))
      : null;
  const coeficienteVariacao =
    media !== null && media > 0 && desvioPadraoAmostral !== null
      ? (desvioPadraoAmostral / media) * 100
      : null;
  return {
    media,
    desvioPadraoAmostral,
    coeficienteVariacao,
    dispersaoExcessiva: coeficienteVariacao !== null && coeficienteVariacao > 25,
  };
}
export function expurgarAmostrasInconsistentes(precos: CotacaoMapa[]) {
  // Sinaliza para análise humana; não altera a seleção nem mistura itens.
  return precos.map((cotacao) => {
    const cesta = precos
      .filter((p) => p.procurement_item_id === cotacao.procurement_item_id)
      .map(precoUnitarioComFrete)
      .filter((p): p is number => p !== null);
    const { media, desvioPadraoAmostral: s } = analisarDispersaoPrecos(cesta);
    const valor = precoUnitarioComFrete(cotacao);
    const motivos: string[] = [];
    if (valor === null) motivos.push("Valor inválido");
    else if (media !== null) {
      if (valor < media * 0.5) motivos.push("Valor inferior a 50% da média");
      if (s !== null && Math.abs(valor - media) > 2 * s)
        motivos.push("Valor fora de média ± 2 desvios amostrais");
    }
    return { cotacao, sinalizada: motivos.length > 0, motivos };
  });
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
