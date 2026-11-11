import type JSZip from "jszip";
import { PKG_REL_NS, R_NS, W_NS, parseXml, wAncestor, wAttr, wChildren, wDescendants, wFirst } from "./xml";
import { openDocx } from "./package";

export type TextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  sizePt: number;
  highlight: boolean;
};

export type ParagraphBlock = {
  kind: "paragraph";
  runs: TextRun[];
  align: "left" | "center" | "right" | "justify";
  heading: number | null;
  indentPt: number;
  spaceAfterPt: number;
  bullet: boolean;
};

export type TableCellBlock = { paragraphs: ParagraphBlock[]; span: number };
export type TableBlock = {
  kind: "table";
  columnWidths: number[];
  rows: { cells: TableCellBlock[]; header: boolean }[];
};

export type Block = ParagraphBlock | TableBlock;

export type DocumentModel = {
  blocks: Block[];
  headerText: string[];
  footerText: string[];
};

type StyleInfo = { bold?: boolean; italic?: boolean; sizePt?: number; heading?: number | null; align?: ParagraphBlock["align"] };

function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = wAttr(el, "val");
  return !(v === "0" || v === "false" || v === "none");
}

async function readStyles(zip: JSZip): Promise<{ defaultSize: number; styles: Map<string, StyleInfo> }> {
  const styles = new Map<string, StyleInfo>();
  let defaultSize = 11;
  const file = zip.file("word/styles.xml");
  if (!file) return { defaultSize, styles };
  const doc = parseXml(await file.async("string"), "word/styles.xml");
  const defSz = wDescendants(doc, "rPrDefault")[0];
  const sz = defSz ? wDescendants(defSz, "sz")[0] : undefined;
  if (sz) defaultSize = Number(wAttr(sz, "val")) / 2 || defaultSize;
  const raw = new Map<string, { info: StyleInfo; basedOn: string | null }>();
  for (const s of wDescendants(doc, "style")) {
    const id = wAttr(s, "styleId");
    if (!id) continue;
    const name = (wAttr(wFirst(s, "name"), "val") ?? "").toLowerCase();
    const rPr = wFirst(s, "rPr");
    const pPr = wFirst(s, "pPr");
    const hm = /^(heading|t[ií]tulo)\s*(\d)$/.exec(name) ?? /^(heading|titulo|ttulo)(\d)$/i.exec(id);
    const outline = pPr ? wFirst(pPr, "outlineLvl") : null;
    const info: StyleInfo = {
      bold: onOff(rPr ? wFirst(rPr, "b") : null),
      italic: onOff(rPr ? wFirst(rPr, "i") : null),
      sizePt: rPr && wFirst(rPr, "sz") ? Number(wAttr(wFirst(rPr, "sz"), "val")) / 2 : undefined,
      heading: hm ? Number(hm[2]) : outline ? Number(wAttr(outline, "val")) + 1 : name === "title" ? 1 : undefined,
      align: pPr && wFirst(pPr, "jc") ? mapAlign(wAttr(wFirst(pPr, "jc"), "val")) : undefined,
    };
    raw.set(id, { info, basedOn: wAttr(wFirst(s, "basedOn"), "val") });
  }
  const resolve = (id: string, depth = 0): StyleInfo => {
    const r = raw.get(id);
    if (!r || depth > 10) return {};
    const base = r.basedOn ? resolve(r.basedOn, depth + 1) : {};
    const out: StyleInfo = { ...base };
    for (const [k, v] of Object.entries(r.info)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    return out;
  };
  for (const id of raw.keys()) styles.set(id, resolve(id));
  return { defaultSize, styles };
}

function mapAlign(v: string | null): ParagraphBlock["align"] {
  if (v === "center") return "center";
  if (v === "right" || v === "end") return "right";
  if (v === "both" || v === "distribute") return "justify";
  return "left";
}

function parseParagraph(p: Element, ctx: { defaultSize: number; styles: Map<string, StyleInfo> }): ParagraphBlock {
  const pPr = wFirst(p, "pPr");
  const styleId = pPr ? wAttr(wFirst(pPr, "pStyle"), "val") : null;
  const style = (styleId && ctx.styles.get(styleId)) || {};
  const jc = pPr ? wFirst(pPr, "jc") : null;
  const ind = pPr ? wFirst(pPr, "ind") : null;
  const spacing = pPr ? wFirst(pPr, "spacing") : null;
  const runs: TextRun[] = [];
  for (const r of wDescendants(p, "r")) {
    if (wAncestor(r, "p") !== p || wAncestor(r, "del") || wAncestor(r, "txbxContent")) continue;
    const rPr = wFirst(r, "rPr");
    const sz = rPr ? wFirst(rPr, "sz") : null;
    const u = rPr ? wFirst(rPr, "u") : null;
    const hl = rPr ? wFirst(rPr, "highlight") : null;
    const base: Omit<TextRun, "text"> = {
      bold: onOff(rPr ? wFirst(rPr, "b") : null) ?? style.bold ?? false,
      italic: onOff(rPr ? wFirst(rPr, "i") : null) ?? style.italic ?? false,
      underline: Boolean(u && wAttr(u, "val") !== "none"),
      sizePt: sz ? Number(wAttr(sz, "val")) / 2 : (style.sizePt ?? ctx.defaultSize),
      highlight: Boolean(hl && wAttr(hl, "val") !== "none"),
    };
    for (const child of Array.from(r.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== W_NS) continue;
      if (el.localName === "t") runs.push({ ...base, text: el.textContent ?? "" });
      else if (el.localName === "tab") runs.push({ ...base, text: "\t" });
      else if (el.localName === "br" || el.localName === "cr") runs.push({ ...base, text: "\n" });
      else if (el.localName === "noBreakHyphen") runs.push({ ...base, text: "-" });
    }
  }
  return {
    kind: "paragraph",
    runs,
    align: jc ? mapAlign(wAttr(jc, "val")) : (style.align ?? "left"),
    heading: style.heading ?? null,
    indentPt: ind ? (Number(wAttr(ind, "left") ?? wAttr(ind, "start") ?? 0) || 0) / 20 : 0,
    spaceAfterPt: spacing && wAttr(spacing, "after") !== null ? Number(wAttr(spacing, "after")) / 20 : 6,
    bullet: Boolean(pPr && wFirst(pPr, "numPr")),
  };
}

function parseTable(tbl: Element, ctx: { defaultSize: number; styles: Map<string, StyleInfo> }): TableBlock {
  const grid = wFirst(tbl, "tblGrid");
  const columnWidths = grid ? wChildren(grid, "gridCol").map((g) => Number(wAttr(g, "w")) || 1) : [];
  const rows = wChildren(tbl, "tr").map((tr) => {
    const trPr = wFirst(tr, "trPr");
    const cells = wChildren(tr, "tc").map((tc) => {
      const tcPr = wFirst(tc, "tcPr");
      const span = Number(wAttr(tcPr ? wFirst(tcPr, "gridSpan") : null, "val")) || 1;
      // Nested tables are flattened into the cell as paragraphs.
      const paragraphs = wDescendants(tc, "p").map((p) => parseParagraph(p, ctx));
      return { paragraphs, span };
    });
    return { cells, header: Boolean(trPr && wFirst(trPr, "tblHeader")) };
  });
  const cols = Math.max(columnWidths.length, ...rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)), 1);
  while (columnWidths.length < cols) columnWidths.push(columnWidths.length ? columnWidths[0]! : 1);
  return { kind: "table", columnWidths: columnWidths.slice(0, cols), rows };
}

function bodyBlocks(container: Element, ctx: { defaultSize: number; styles: Map<string, StyleInfo> }): Block[] {
  const out: Block[] = [];
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== W_NS) continue;
    if (el.localName === "p") out.push(parseParagraph(el, ctx));
    else if (el.localName === "tbl") out.push(parseTable(el, ctx));
    else if (el.localName === "sdt") {
      const content = wFirst(el, "sdtContent");
      if (content) out.push(...bodyBlocks(content, ctx));
    }
  }
  return out;
}

async function storyText(zip: JSZip, rels: Document | null, sectPr: Element | null, kind: "header" | "footer"): Promise<string[]> {
  if (!rels || !sectPr) return [];
  const ref = wChildren(sectPr, `${kind}Reference`).find((r) => wAttr(r, "type") === "default");
  const id = ref?.getAttributeNS(R_NS, "id") ?? ref?.getAttribute("r:id");
  if (!id) return [];
  const rel = Array.from(rels.getElementsByTagNameNS(PKG_REL_NS, "Relationship")).find((r) => r.getAttribute("Id") === id);
  const target = rel?.getAttribute("Target");
  if (!target) return [];
  const file = zip.file("word/" + target.replace(/^\/?word\//, "").replace(/^\//, ""));
  if (!file) return [];
  const doc = parseXml(await file.async("string"), target);
  return wDescendants(doc, "p")
    .map((p) => wDescendants(p, "t").map((t) => t.textContent ?? "").join("").trim())
    .filter(Boolean);
}

/** Reads a DOCX into a simplified, renderer-neutral model used by the preview and the PDF. */
export async function docxToModel(input: ArrayBuffer | Uint8Array): Promise<DocumentModel> {
  const zip = await openDocx(input);
  const ctx = await readStyles(zip);
  const doc = parseXml(await zip.file("word/document.xml")!.async("string"), "word/document.xml");
  const body = doc.getElementsByTagNameNS(W_NS, "body").item(0);
  if (!body) throw new Error("Documento Word sem corpo.");
  const relsFile = zip.file("word/_rels/document.xml.rels");
  const rels = relsFile ? parseXml(await relsFile.async("string"), "document.xml.rels") : null;
  const sectPr = wFirst(body, "sectPr");
  return {
    blocks: bodyBlocks(body, ctx),
    headerText: await storyText(zip, rels, sectPr, "header"),
    footerText: await storyText(zip, rels, sectPr, "footer"),
  };
}
