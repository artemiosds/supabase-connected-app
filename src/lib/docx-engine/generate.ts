import JSZip from "jszip";
import { documentVariableLabel, isKnownDocumentVariable } from "@/lib/document-variables";
import {
  CT_NS,
  DocxEngineError,
  PKG_REL_NS,
  R_NS,
  W_NS,
  escapeXml,
  parseXml,
  serializeXml,
  wChildren,
  wDescendants,
  wEl,
  wFirst,
} from "./xml";
import { analyzeDocx, openDocx, storyPartNames, base64ToBytes, type DocxWarning } from "./package";
import { listPlaceholders, paragraphPlainText, replaceInParagraph, type Resolver } from "./placeholders";
import { expandItems, ITEMS_MARKER, type DocumentItem } from "./items";
import {
  brandingHasHeader,
  imageSize,
  mmToTwips,
  type DocumentBranding,
} from "./branding";

export type PendingField = { key: string; label: string };

export type GenerateInput = {
  template: ArrayBuffer | Uint8Array;
  /** Values calculated by the server (generated_documents.variables_snapshot). */
  values: Record<string, string>;
  /** Items read under RLS from procurement_items for the document's process. */
  items: DocumentItem[];
  branding?: DocumentBranding | null;
};

export type GenerateResult = {
  bytes: Uint8Array;
  pending: PendingField[];
  warnings: DocxWarning[];
  brandingApplied: boolean;
};

const SERVER_PENDING = /^\s*\[(PREENCHER|PENDENTE)[:\]]/i;

export function isPendingValue(value: string | undefined | null): boolean {
  return !value || !value.trim() || SERVER_PENDING.test(value);
}

export function buildResolver(values: Record<string, string>, pending: Map<string, PendingField>): Resolver {
  const normalized = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return (key) => {
    const known = isKnownDocumentVariable(key) || normalized.has(key);
    if (!known) {
      pending.set(key, { key, label: `Campo não configurado: ${key}` });
      return { text: `[CAMPO NÃO CONFIGURADO: ${key}]`, pending: true };
    }
    const value = normalized.get(key);
    if (isPendingValue(value)) {
      const label = documentVariableLabel(key);
      pending.set(key, { key, label });
      return { text: `[PENDENTE: ${label}]`, pending: true };
    }
    return { text: value!.trim() };
  };
}

function headerXml(b: DocumentBranding, imageRelId: string | null, img: { cx: number; cy: number } | null): string {
  const drawing =
    imageRelId && img
      ? `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${img.cx}" cy="${img.cy}"/><wp:docPr id="9001" name="Brasao"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="brasao"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${imageRelId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${img.cx}" cy="${img.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
      : "";
  const line = (text: string, bold: boolean, size: number) =>
    text.trim()
      ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text.trim())}</w:t></w:r></w:p>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">${
    drawing ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr>${drawing}</w:p>` : ""
  }${line(b.headerTitle, true, 24)}${line(b.headerSubtitle, false, 20)}<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p></w:hdr>`;
}

function footerXml(b: DocumentBranding): string {
  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const text = b.footerText.trim()
    ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(b.footerText.trim())}</w:t></w:r></w:p>`
    : "";
  const pages = b.showPageNumbers
    ? `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">Página </w:t></w:r>${field("PAGE")}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> de </w:t></w:r>${field("NUMPAGES")}</w:p>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${text}${pages}${text || pages ? "" : "<w:p/>"}</w:ftr>`;
}

async function ensureRels(zip: JSZip, path: string): Promise<Document> {
  const file = zip.file(path);
  const xml = file
    ? await file.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"/>`;
  return parseXml(xml, path);
}

function addRel(rels: Document, type: string, target: string): string {
  const existing = new Set(
    Array.from(rels.getElementsByTagNameNS(PKG_REL_NS, "Relationship"), (r) => r.getAttribute("Id")),
  );
  let n = 900;
  while (existing.has(`rIdPrimus${n}`)) n += 1;
  const id = `rIdPrimus${n}`;
  const rel = rels.createElementNS(PKG_REL_NS, "Relationship");
  rel.setAttribute("Id", id);
  rel.setAttribute("Type", type);
  rel.setAttribute("Target", target);
  rels.documentElement.appendChild(rel);
  return id;
}

/**
 * Adds the Secretaria letterhead (brasão, title, subtitle, footer, page numbers) and
 * its margins, but only when the model has no header of its own: models with their
 * own letterhead keep their header and margins untouched.
 */
async function applyBranding(zip: JSZip, documentXml: Document, b: DocumentBranding): Promise<boolean> {
  const body = documentXml.getElementsByTagNameNS(W_NS, "body").item(0)!;
  let sectPr = wFirst(body, "sectPr");
  if (!sectPr) {
    sectPr = wEl(documentXml, "sectPr");
    body.appendChild(sectPr);
  }
  if (wChildren(sectPr, "headerReference").length > 0) return false;

  const docRels = await ensureRels(zip, "word/_rels/document.xml.rels");
  const ct = parseXml(await zip.file("[Content_Types].xml")!.async("string"), "[Content_Types].xml");
  const addOverride = (part: string, type: string) => {
    const o = ct.createElementNS(CT_NS, "Override");
    o.setAttribute("PartName", part);
    o.setAttribute("ContentType", type);
    ct.documentElement.appendChild(o);
  };

  let imageRelId: string | null = null;
  let img: { cx: number; cy: number } | null = null;
  if (b.logoBase64 && b.logoMime) {
    const bytes = base64ToBytes(b.logoBase64);
    const size = imageSize(bytes);
    if (size && size.width > 0 && size.height > 0) {
      const ext = b.logoMime === "image/png" ? "png" : "jpeg";
      zip.file(`word/media/primus_brasao.${ext}`, bytes);
      const hasDefault = Array.from(ct.getElementsByTagNameNS(CT_NS, "Default")).some(
        (d) => d.getAttribute("Extension")?.toLowerCase() === ext,
      );
      if (!hasDefault) {
        const d = ct.createElementNS(CT_NS, "Default");
        d.setAttribute("Extension", ext);
        d.setAttribute("ContentType", b.logoMime);
        ct.documentElement.insertBefore(d, ct.documentElement.firstChild);
      }
      const hdrRels = await ensureRels(zip, "word/_rels/header_primus.xml.rels");
      imageRelId = addRel(hdrRels, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `media/primus_brasao.${ext}`);
      zip.file("word/_rels/header_primus.xml.rels", serializeXml(hdrRels));
      const heightEmu = Math.round((18 / 25.4) * 914400); // 18 mm tall
      img = { cy: heightEmu, cx: Math.round((heightEmu * size.width) / size.height) };
    }
  }

  const hdr = headerXml(b, imageRelId, img);
  const ftr = footerXml(b);
  parseXml(hdr, "header_primus.xml");
  parseXml(ftr, "footer_primus.xml");
  zip.file("word/header_primus.xml", hdr);
  zip.file("word/footer_primus.xml", ftr);
  addOverride("/word/header_primus.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml");
  addOverride("/word/footer_primus.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml");
  const hId = addRel(docRels, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", "header_primus.xml");
  const fId = addRel(docRels, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", "footer_primus.xml");
  zip.file("word/_rels/document.xml.rels", serializeXml(docRels));
  zip.file("[Content_Types].xml", serializeXml(ct));

  const ref = (name: string, id: string) => {
    const el = wEl(documentXml, name);
    el.setAttributeNS(W_NS, "w:type", "default");
    el.setAttributeNS(R_NS, "r:id", id);
    return el;
  };
  sectPr.insertBefore(ref("footerReference", fId), sectPr.firstChild);
  sectPr.insertBefore(ref("headerReference", hId), sectPr.firstChild);

  // Margins (CT_SectPr order: refs, footnotePr, endnotePr, type, pgSz, pgMar, ...)
  let pgSz = wFirst(sectPr, "pgSz");
  if (!pgSz) {
    pgSz = wEl(documentXml, "pgSz");
    pgSz.setAttributeNS(W_NS, "w:w", "11906");
    pgSz.setAttributeNS(W_NS, "w:h", "16838");
    const after = wChildren(sectPr, "footerReference").at(-1)!;
    sectPr.insertBefore(pgSz, after.nextSibling);
  }
  let pgMar = wFirst(sectPr, "pgMar");
  if (!pgMar) {
    pgMar = wEl(documentXml, "pgMar");
    sectPr.insertBefore(pgMar, pgSz.nextSibling);
  }
  const set = (k: string, v: number) => pgMar!.setAttributeNS(W_NS, `w:${k}`, String(v));
  set("top", mmToTwips(b.marginTopMm));
  set("bottom", mmToTwips(b.marginBottomMm));
  set("left", mmToTwips(b.marginLeftMm));
  set("right", mmToTwips(b.marginRightMm));
  set("header", mmToTwips(Math.min(12, b.marginTopMm / 2)));
  set("footer", mmToTwips(Math.min(10, b.marginBottomMm / 2)));
  set("gutter", 0);
  return true;
}

/**
 * Fills a DOCX model, preserving paragraphs, styles, tables, headers and footers.
 * The output is re-opened and re-parsed before it is returned; any inconsistency
 * throws instead of producing a broken file.
 */
export async function generateDocx(input: GenerateInput): Promise<GenerateResult> {
  const zip = await openDocx(input.template);
  const analysis = await analyzeDocx(zip);
  const pending = new Map<string, PendingField>();
  const resolver = buildResolver(input.values, pending);
  let brandingApplied = false;

  for (const name of storyPartNames(zip)) {
    const doc = parseXml(await zip.file(name)!.async("string"), name);
    if (name === "word/document.xml") {
      const exp = expandItems(doc, input.items, resolver);
      if (exp.missing) pending.set(ITEMS_MARKER, { key: ITEMS_MARKER, label: documentVariableLabel(ITEMS_MARKER) });
      if (input.branding && brandingHasHeader(input.branding) && !analysis.hasOwnHeader) {
        brandingApplied = await applyBranding(zip, doc, input.branding);
      }
    }
    for (const p of wDescendants(doc, "p")) replaceInParagraph(p, resolver);
    zip.file(name, serializeXml(doc));
  }

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  // Integrity check on the produced package.
  const check = await openDocx(bytes);
  for (const name of storyPartNames(check)) {
    const doc = parseXml(await check.file(name)!.async("string"), name);
    for (const p of wDescendants(doc, "p")) {
      if (listPlaceholders(paragraphPlainText(p)).length > 0) {
        throw new DocxEngineError("Falha de integridade: restaram campos sem substituição no Word gerado.");
      }
    }
  }
  return { bytes, pending: [...pending.values()], warnings: analysis.warnings, brandingApplied };
}
