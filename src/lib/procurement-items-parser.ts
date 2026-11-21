export const UNIDADES_SAUDE_PADRAO = [
  "AMPOLA",
  "BISNAGA",
  "BOLSA",
  "CAIXA",
  "COMPRIMIDO",
  "FRASCO",
  "FRASCO-AMPOLA",
  "KIT",
  "LITRO",
  "METRO",
  "PACOTE",
  "PAR",
  "ROLO",
  "SERVIÇO",
  "TUBETE",
  "UNIDADE",
] as const;

export type ParsedItemPreview = {
  sourceLine: number;
  description: string;
  technical_specification: string;
  unit: string;
  quantity: number;
  estimated_unit_price: number | null;
  estimated_total: number | null;
  delivery_location: string;
  isValid: boolean;
  erros: string[];
};

const key = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export function normalizeHealthUnit(value: string): string {
  const normalized = key(value).replace(/\.$/, "");
  const units: Record<string, string> = {
    comp: "COMPRIMIDO",
    cp: "COMPRIMIDO",
    comprimidos: "COMPRIMIDO",
    amp: "AMPOLA",
    ampolas: "AMPOLA",
    fr: "FRASCO",
    frascos: "FRASCO",
    cx: "CAIXA",
    caixas: "CAIXA",
    fa: "FRASCO-AMPOLA",
    un: "UNIDADE",
    und: "UNIDADE",
    unidades: "UNIDADE",
    pct: "PACOTE",
    pac: "PACOTE",
    lt: "LITRO",
    l: "LITRO",
    m: "METRO",
    rl: "ROLO",
    bs: "BISNAGA",
    servico: "SERVIÇO",
  };
  return units[normalized] ?? value.trim().toLocaleUpperCase("pt-BR");
}

export function parseBrazilianNumber(value: string): number {
  let text = value
    .trim()
    .replace(/^R\$\s*/, "")
    .trim();
  if (!text) return NaN;
  if (text.includes(",")) {
    if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text)) return NaN;
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  } else if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return NaN;
  return Number(text);
}

type CellRow = { cells: string[]; line: number; error: boolean };
function readRows(text: string, delimiter: string): CellRow[] {
  const rows: CellRow[] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false,
    closed = false,
    invalid = false,
    line = 1,
    start = 1;
  const push = () => {
    cells.push(cell.trim());
    if (cells.some((value) => value !== ""))
      rows.push({ cells, line: start, error: invalid || quoted });
    cells = [];
    cell = "";
    closed = false;
    invalid = false;
  };
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]!;
    if (char === '"') {
      if (quoted && normalized[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (quoted) {
        quoted = false;
        closed = true;
      } else if (!cell.trim() && !closed) {
        quoted = true;
        cell = "";
      } else {
        invalid = true;
        cell += char;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
      closed = false;
    } else if (char === "\n" && !quoted) {
      push();
      line++;
      start = line;
    } else {
      if (closed && char.trim()) invalid = true;
      cell += char;
      if (char === "\n") line++;
    }
  }
  push();
  return rows;
}

type Field =
  | "description"
  | "unit"
  | "quantity"
  | "estimated_unit_price"
  | "technical_specification"
  | "delivery_location";
function headerField(value: string): Field | null {
  const name = key(value).replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(descricao(?: do item)?|produto|medicamento|material)$/.test(name)) return "description";
  if (/^(unidade|un|und|unid)$/.test(name)) return "unit";
  if (/^(quantidade|qtd|qtde|quant)$/.test(name)) return "quantity";
  if (/^(preco|valor)(?: unitario| unit)?(?: \(r\$\))?$/.test(name)) return "estimated_unit_price";
  if (/^(especificacao(?: tecnica)?)$/.test(name)) return "technical_specification";
  if (/^(local de entrega|entrega)$/.test(name)) return "delivery_location";
  return null;
}

export function calculateItemTotal(quantity: number, unitPrice: number): number {
  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(unitPrice) ||
    quantity < 0 ||
    unitPrice < 0 ||
    quantity >= 1e10 ||
    unitPrice >= 1e12
  )
    return NaN;
  const scaledQuantity = BigInt(quantity.toFixed(4).replace(".", ""));
  const scaledPrice = BigInt(unitPrice.toFixed(4).replace(".", ""));
  return Number((scaledQuantity * scaledPrice + 500000n) / 1000000n) / 100;
}

export function parsePastedItems(
  rawText: string,
  defaultDeliveryLocation = "",
): ParsedItemPreview[] {
  if (!rawText.trim()) return [];
  // Prefer the consistent column structure, rather than decimal commas inside cells.
  const candidates = ["\t", ";", ","].map((delimiter) => ({
    delimiter,
    rows: readRows(rawText, delimiter),
  }));
  const chosen =
    candidates.find((c) => c.rows.some((row) => row.cells.length >= 3)) ?? candidates[0]!;
  const first = chosen.rows[0];
  if (!first) return [];
  const mapped = first.cells.map(headerField);
  if (!mapped.includes("description")) {
    const itemHeader = first.cells.findIndex((cell) => key(cell) === "item");
    if (itemHeader >= 0) mapped[itemHeader] = "description";
  }
  const hasHeader =
    mapped.includes("description") &&
    (mapped.includes("quantity") || mapped.includes("estimated_unit_price"));
  const mapping = hasHeader ? mapped : null;
  return chosen.rows.slice(hasHeader ? 1 : 0).map((row) => {
    const erros: string[] = [];
    if (row.error) erros.push("Aspas inválidas: confira os campos da planilha.");
    const numbered = !mapping && row.cells.length === 5 && /^\d+$/.test(row.cells[0] ?? "");
    const offset = numbered ? 1 : 0;
    const get = (field: Field, index: number) =>
      row.cells[mapping ? mapping.indexOf(field) : index + offset] ?? "";
    if (!mapping && ![3, 4].includes(row.cells.length - offset))
      erros.push(
        "Use Descrição, Unidade, Quantidade e Preço. Valores com vírgula em CSV devem estar entre aspas.",
      );
    const description = get("description", 0).trim();
    const unit = normalizeHealthUnit(get("unit", 1));
    const quantity = parseBrazilianNumber(get("quantity", 2));
    const priceText = get("estimated_unit_price", 3);
    const estimated_unit_price = priceText.trim() ? parseBrazilianNumber(priceText) : null;
    if (description.length < 3 || description.length > 500)
      erros.push("Descrição deve ter de 3 a 500 caracteres.");
    if (!unit || unit.length > 30) erros.push("Unidade deve ter de 1 a 30 caracteres.");
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity >= 1e10 ||
      Number(quantity.toFixed(4)) !== quantity
    )
      erros.push("Quantidade deve ser positiva, numérica e ter até 4 casas decimais.");
    if (
      estimated_unit_price !== null &&
      (!Number.isFinite(estimated_unit_price) ||
        estimated_unit_price < 0 ||
        estimated_unit_price >= 1e12 ||
        Number(estimated_unit_price.toFixed(4)) !== estimated_unit_price)
    )
      erros.push("Preço deve ser não negativo, numérico e ter até 4 casas decimais.");
    const total =
      estimated_unit_price === null ? null : calculateItemTotal(quantity, estimated_unit_price);
    if (total !== null && (!Number.isFinite(total) || total >= 1e14))
      erros.push("Subtotal excede o limite de valor do item.");
    return {
      sourceLine: row.line,
      description,
      unit,
      quantity,
      estimated_unit_price,
      estimated_total: total,
      technical_specification: mapping ? get("technical_specification", -1) : "",
      delivery_location:
        (mapping ? get("delivery_location", -1) : "") || defaultDeliveryLocation.trim(),
      isValid: erros.length === 0,
      erros,
    };
  });
}
