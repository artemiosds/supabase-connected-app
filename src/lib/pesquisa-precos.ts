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
  is_active?: boolean;
  justificativa_expurgo?: string | null;
  source_type?: string;
  reference_identifier?: string | null;
  accessed_at?: string | null;
  supplier_response_deadline?: string | null;
  supplier_consultation_sent_at?: string | null;
  supplier_consultation_response_deadline?: string | null;
  source_tax_id?: string | null;
  source_contact_name?: string | null;
  source_contact_email?: string | null;
  source_contact_phone?: string | null;
  source_address?: string | null;
  brand_model?: string | null;
  delivery_term?: string | null;
  payment_terms?: string | null;
  warranty_terms?: string | null;
  notes?: string | null;
  supplier_selection_justification?: string | null;
  evidence_file_name?: string | null;
  evidence_mime_type?: string | null;
  evidence_file_size?: number | null;
};

type Precificacao = Pick<CotacaoMapa, "quantity" | "unit_price" | "delivery_cost" | "total_price">;

export type ResumoDePrecos = {
  quantidade: number;
  menor: number | null;
  media: number | null;
  mediana: number | null;
  coeficienteVariacao: number | null;
};

export type MetodoPreco = "media" | "mediana" | "menor" | "outro";

export type ResultadoPrecoHomologado = {
  quantidadeAmostras: number;
  media: number;
  mediana: number;
  menor: number;
  desvioPadraoAmostral: number | null;
  coeficienteVariacao: number | null;
  precoUnitarioAprovado: number;
  precoTotalAprovado: number;
};

export function calcularPrecoHomologado(
  method: MetodoPreco,
  quotes: Precificacao[],
  itemQuantity: number,
  otherUnitPrice?: number,
): ResultadoPrecoHomologado {
  if (!Number.isFinite(itemQuantity) || itemQuantity <= 0) {
    throw new RangeError("A quantidade do item deve ser maior que zero.");
  }
  const values = quotes
    .map(precoUnitarioComFrete)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (values.length === 0) throw new RangeError("Não há cotações ativas com preço válido.");
  const average = values.reduce((sum, value) => sum + value / values.length, 0);
  const median = calcularMediana(values);
  const lowest = values[0];
  if (median === null || lowest === undefined) {
    throw new RangeError("Não foi possível calcular a série de preços.");
  }
  const dispersion = analisarDispersaoPrecos(values);
  if (method === "outro" && (!Number.isFinite(otherUnitPrice) || (otherUnitPrice ?? -1) < 0)) {
    throw new RangeError("Informe um preço unitário válido para o método alternativo.");
  }
  const approvedUnitPrice =
    method === "media"
      ? average
      : method === "mediana"
        ? median
        : method === "menor"
          ? lowest
          : otherUnitPrice!;
  return {
    quantidadeAmostras: values.length,
    media: average,
    mediana: median,
    menor: lowest,
    desvioPadraoAmostral: dispersion.desvioPadraoAmostral,
    coeficienteVariacao: dispersion.coeficienteVariacao,
    precoUnitarioAprovado: approvedUnitPrice,
    precoTotalAprovado: Math.round((approvedUnitPrice * itemQuantity + Number.EPSILON) * 100) / 100,
  };
}

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
      "Tipo de fonte",
      "Identificador da fonte",
      "Data da cotação",
      "Data/hora de acesso",
      "Validade da proposta",
      "Data de envio da solicitação",
      "Prazo concedido para resposta",
      "CPF/CNPJ da fonte",
      "Responsável pela cotação",
      "E-mail de contato",
      "Telefone de contato",
      "Endereço da fonte",
      "Marca/modelo",
      "Prazo de entrega",
      "Condição de pagamento",
      "Garantia",
      "Observações da fonte",
      "Justificativa da escolha do fornecedor",
      "Quantidade cotada",
      "Preço unitário",
      "Frete",
      "Preço total",
      "Preço unitário equivalente com frete",
      "Situação da cotação",
      "Selecionada como referência",
      "Justificativa do expurgo",
      "Comprovante anexado",
      "Tipo do comprovante",
      "Tamanho do comprovante (bytes)",
      "Média unitária (amostras ativas)",
      "Mediana unitária (amostras ativas)",
      "Menor unitário (amostras ativas)",
      "Coeficiente de variação (%)",
      "Referência consultada",
    ],
  ];
  for (const item of items) {
    const itemQuotes = quotes.filter((quote) => quote.procurement_item_id === item.id);
    const activeQuotes = itemQuotes.filter((quote) => quote.is_active !== false);
    const summary = calcularResumoDePrecos(activeQuotes);
    for (const quote of itemQuotes) {
      rows.push([
        processNumber,
        item.line_number,
        item.description,
        item.unit,
        item.quantity,
        quote.source_name,
        quote.source_type ?? "",
        quote.reference_identifier ?? "",
        quote.quoted_at,
        quote.accessed_at ?? "",
        quote.supplier_response_deadline ?? "",
        quote.supplier_consultation_sent_at ?? "",
        quote.supplier_consultation_response_deadline ?? "",
        quote.source_tax_id ?? "",
        quote.source_contact_name ?? "",
        quote.source_contact_email ?? "",
        quote.source_contact_phone ?? "",
        quote.source_address ?? "",
        quote.brand_model ?? "",
        quote.delivery_term ?? "",
        quote.payment_terms ?? "",
        quote.warranty_terms ?? "",
        quote.notes ?? "",
        quote.supplier_selection_justification ?? "",
        quote.quantity,
        quote.unit_price,
        quote.delivery_cost,
        quote.total_price,
        precoUnitarioComFrete(quote),
        quote.is_active === false ? "Expurgada" : "Ativa",
        quote.selected_for_estimate ? "Sim" : "Não",
        quote.justificativa_expurgo ?? "",
        quote.evidence_file_name ?? "",
        quote.evidence_mime_type ?? "",
        quote.evidence_file_size ?? "",
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
