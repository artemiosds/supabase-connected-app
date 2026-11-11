import { W_NS, wChildren, wDescendants, wEl } from "./xml";
import { paragraphPlainText, replaceInParagraph, type Resolver } from "./placeholders";

export type DocumentItem = {
  numero: string;
  descricao: string;
  especificacao: string;
  unidade: string;
  quantidade: string;
  valor_unitario: string;
  valor_total: string;
  local_entrega: string;
};

export const ITEM_FIELDS: readonly (keyof DocumentItem)[] = [
  "numero",
  "descricao",
  "especificacao",
  "unidade",
  "quantidade",
  "valor_unitario",
  "valor_total",
  "local_entrega",
];

export const ITEMS_MARKER = "tabela_itens";

const DEFAULT_COLUMNS: { field: keyof DocumentItem; label: string; width: number }[] = [
  { field: "numero", label: "Item", width: 700 },
  { field: "descricao", label: "Descrição", width: 3400 },
  { field: "unidade", label: "Unid.", width: 900 },
  { field: "quantidade", label: "Qtd.", width: 1000 },
  { field: "valor_unitario", label: "Valor unitário", width: 1650 },
  { field: "valor_total", label: "Valor total", width: 1650 },
];

function rowText(row: Element): string {
  return wDescendants(row, "p").map(paragraphPlainText).join(" ");
}

function isItemRow(row: Element): boolean {
  const text = rowText(row);
  return /\{\{\s*(tabela_itens|item\.[a-z_]+)\s*\}\}/i.test(text);
}

function itemResolver(item: DocumentItem | null, fallback: Resolver): Resolver {
  return (key) => {
    if (key === ITEMS_MARKER) return { text: "" };
    if (key.startsWith("item.")) {
      const field = key.slice(5) as keyof DocumentItem;
      if (!item) return { text: "[PENDENTE: itens do processo]", pending: true };
      if (!ITEM_FIELDS.includes(field)) {
        return { text: `[CAMPO DE ITEM NÃO SUPORTADO: ${field}]`, pending: true };
      }
      return { text: item[field] ?? "" };
    }
    return fallback(key);
  };
}

function cell(doc: Document, text: string, width: number, bold: boolean): Element {
  const tc = wEl(doc, "tc");
  const tcPr = wEl(doc, "tcPr");
  const tcW = wEl(doc, "tcW");
  tcW.setAttributeNS(W_NS, "w:w", String(width));
  tcW.setAttributeNS(W_NS, "w:type", "dxa");
  tcPr.appendChild(tcW);
  tc.appendChild(tcPr);
  const p = wEl(doc, "p");
  const r = wEl(doc, "r");
  if (bold) {
    const rPr = wEl(doc, "rPr");
    rPr.appendChild(wEl(doc, "b"));
    r.appendChild(rPr);
  }
  const t = wEl(doc, "t");
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
  tc.appendChild(p);
  return tc;
}

function buildDefaultTable(doc: Document, items: DocumentItem[]): Element {
  const tbl = wEl(doc, "tbl");
  const tblPr = wEl(doc, "tblPr");
  const tblW = wEl(doc, "tblW");
  tblW.setAttributeNS(W_NS, "w:w", String(DEFAULT_COLUMNS.reduce((a, c) => a + c.width, 0)));
  tblW.setAttributeNS(W_NS, "w:type", "dxa");
  tblPr.appendChild(tblW);
  const borders = wEl(doc, "tblBorders");
  for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
    const b = wEl(doc, side);
    b.setAttributeNS(W_NS, "w:val", "single");
    b.setAttributeNS(W_NS, "w:sz", "4");
    b.setAttributeNS(W_NS, "w:color", "808080");
    borders.appendChild(b);
  }
  tblPr.appendChild(borders);
  tbl.appendChild(tblPr);
  const grid = wEl(doc, "tblGrid");
  for (const c of DEFAULT_COLUMNS) {
    const g = wEl(doc, "gridCol");
    g.setAttributeNS(W_NS, "w:w", String(c.width));
    grid.appendChild(g);
  }
  tbl.appendChild(grid);
  const header = wEl(doc, "tr");
  const trPr = wEl(doc, "trPr");
  trPr.appendChild(wEl(doc, "tblHeader"));
  header.appendChild(trPr);
  for (const c of DEFAULT_COLUMNS) header.appendChild(cell(doc, c.label, c.width, true));
  tbl.appendChild(header);
  for (const item of items) {
    const tr = wEl(doc, "tr");
    for (const c of DEFAULT_COLUMNS) tr.appendChild(cell(doc, item[c.field] ?? "", c.width, false));
    tbl.appendChild(tr);
  }
  return tbl;
}

export type ItemsExpansion = {
  /** True when the document referenced items in any form. */
  used: boolean;
  /** True when items were referenced but none were available. */
  missing: boolean;
};

/**
 * Expands repeatable item rows. A table row containing {{tabela_itens}} or
 * {{item.campo}} is cloned once per item (formatting of the row is kept). A paragraph
 * whose only content is {{tabela_itens}} is replaced by a generated bordered table.
 */
export function expandItems(
  doc: Document,
  items: DocumentItem[],
  fallback: Resolver,
): ItemsExpansion {
  let used = false;
  for (const row of wDescendants(doc, "tr")) {
    if (!row.parentNode || !isItemRow(row)) continue;
    used = true;
    const parent = row.parentNode;
    if (items.length === 0) {
      for (const p of wDescendants(row, "p")) replaceInParagraph(p, itemResolver(null, fallback));
      continue;
    }
    for (const item of items) {
      const clone = row.cloneNode(true) as Element;
      for (const p of wDescendants(clone, "p")) replaceInParagraph(p, itemResolver(item, fallback));
      parent.insertBefore(clone, row);
    }
    parent.removeChild(row);
  }

  for (const p of wDescendants(doc, "p")) {
    if (!p.parentNode) continue;
    const text = paragraphPlainText(p).trim();
    if (!/^\{\{\s*tabela_itens\s*\}\}$/i.test(text)) continue;
    used = true;
    if (items.length === 0) continue; // left for the normal resolver -> pending marker
    const table = buildDefaultTable(doc, items);
    p.parentNode.insertBefore(table, p);
    // Word requires a paragraph after a table that ends a cell; keep an empty one.
    for (const child of wChildren(p, "r")) p.removeChild(child);
  }
  return { used, missing: used && items.length === 0 };
}
