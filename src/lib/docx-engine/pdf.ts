import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { DocxEngineError } from "./xml";
import { base64ToBytes } from "./package";
import { brandingHasHeader, mmToPoints, type DocumentBranding } from "./branding";
import type { Block, DocumentModel, ParagraphBlock, TextRun } from "./model";

const A4 = { width: 595.28, height: 841.89 };
const LINE_FACTOR = 1.25;
const CELL_PAD = 3;

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

const REPLACEMENTS: Record<string, string> = {
  "\u00a0": " ",
  "\u2011": "-",
  "\u2010": "-",
  "\u2212": "-",
  "\u00ad": "",
  "\u200b": "",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2192": "->",
  "\u25cf": "\u2022",
  "\uf0b7": "\u2022",
};

function fontFor(f: Fonts, r: Pick<TextRun, "bold" | "italic">): PDFFont {
  if (r.bold && r.italic) return f.boldItalic;
  if (r.bold) return f.bold;
  if (r.italic) return f.italic;
  return f.regular;
}

/** Normalizes text to the PDF standard font charset; unsupported characters abort. */
export function sanitizeForPdf(text: string, font: PDFFont, unsupported: Set<string>): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const mapped = REPLACEMENTS[ch] ?? ch;
    for (const c of mapped) {
      try {
        font.widthOfTextAtSize(c, 10);
        out += c;
      } catch {
        unsupported.add(c);
      }
    }
  }
  return out;
}

type Word = { text: string; run: TextRun; width: number; space: number; font: PDFFont };
type Line = { words: Word[]; width: number; height: number; size: number };

function layoutParagraph(p: ParagraphBlock, maxWidth: number, fonts: Fonts, unsupported: Set<string>): Line[] {
  const lines: Line[] = [];
  let current: Word[] = [];
  let width = 0;
  const defaultSize = p.runs[0]?.sizePt ?? 11;
  const push = () => {
    const size = Math.max(defaultSize, ...current.map((w) => w.run.sizePt));
    lines.push({ words: current, width, height: size * LINE_FACTOR, size });
    current = [];
    width = 0;
  };
  for (const run0 of p.runs) {
    const run = p.heading ? { ...run0, bold: true } : run0;
    const font = fontFor(fonts, run);
    const segments = run.text.replace(/\t/g, "    ").split("\n");
    segments.forEach((seg, si) => {
      if (si > 0) push();
      const clean = sanitizeForPdf(seg, font, unsupported);
      const tokens = clean.split(/(\s+)/);
      for (const token of tokens) {
        if (!token) continue;
        if (/^\s+$/.test(token)) {
          const last = current.at(-1);
          if (last) {
            const sp = font.widthOfTextAtSize(" ", run.sizePt);
            last.space += sp;
            width += sp;
          }
          continue;
        }
        let tw = font.widthOfTextAtSize(token, run.sizePt);
        // Break very long tokens (URLs, numbers) character by character.
        if (tw > maxWidth) {
          let chunk = "";
          for (const c of token) {
            const cw = font.widthOfTextAtSize(chunk + c, run.sizePt);
            if (cw > maxWidth - width && chunk) {
              current.push({ text: chunk, run, width: font.widthOfTextAtSize(chunk, run.sizePt), space: 0, font });
              push();
              chunk = c;
            } else chunk += c;
          }
          tw = font.widthOfTextAtSize(chunk, run.sizePt);
          current.push({ text: chunk, run, width: tw, space: 0, font });
          width += tw;
          continue;
        }
        if (width + tw > maxWidth && current.length > 0) {
          const last = current.at(-1)!;
          width -= last.space;
          last.space = 0;
          push();
        }
        current.push({ text: token, run, width: tw, space: 0, font });
        width += tw;
      }
    });
  }
  if (current.length > 0 || lines.length === 0) push();
  return lines;
}

function drawLine(page: PDFPage, line: Line, x: number, y: number, maxWidth: number, align: ParagraphBlock["align"], isLast: boolean) {
  const trailing = line.words.at(-1)?.space ?? 0;
  const used = line.width - trailing;
  let cursor = x;
  let extra = 0;
  if (align === "center") cursor += (maxWidth - used) / 2;
  else if (align === "right") cursor += maxWidth - used;
  else if (align === "justify" && !isLast && line.words.length > 1) extra = (maxWidth - used) / (line.words.length - 1);
  const baseline = y - line.size;
  line.words.forEach((w, i) => {
    if (w.run.highlight) {
      page.drawRectangle({ x: cursor - 1, y: baseline - 2, width: w.width + 2, height: w.run.sizePt + 3, color: rgb(1, 0.95, 0.4) });
    }
    page.drawText(w.text, { x: cursor, y: baseline, size: w.run.sizePt, font: w.font, color: rgb(0, 0, 0) });
    if (w.run.underline) {
      page.drawLine({ start: { x: cursor, y: baseline - 1.5 }, end: { x: cursor + w.width, y: baseline - 1.5 }, thickness: 0.5 });
    }
    cursor += w.width + (i < line.words.length - 1 ? w.space + extra : 0);
  });
}

export type PdfOptions = {
  branding: DocumentBranding;
  title?: string;
  /** Extra paragraphs appended at the end (e.g. signature record). */
  appendix?: string[];
};

/**
 * Renders the document model to an A4 PDF with the Secretaria letterhead, fixed
 * margins and "Página X de Y". It reproduces text, bold/italic/underline, sizes,
 * alignment and tables; it does not reproduce images of the model, text boxes,
 * custom fonts, colors or cell shading. Unsupported characters abort the export.
 */
export async function renderPdf(model: DocumentModel, options: PdfOptions): Promise<Uint8Array> {
  const b = options.branding;
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title ?? "Documento");
  pdf.setCreator("Primus Gestão");
  pdf.setProducer("Primus Gestão");
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const unsupported = new Set<string>();

  let logo: PDFImage | null = null;
  if (b.logoBase64 && b.logoMime) {
    const bytes = base64ToBytes(b.logoBase64);
    try {
      logo = b.logoMime === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      throw new DocxEngineError("O brasão configurado não pôde ser lido. Envie novamente um PNG ou JPEG.");
    }
  }

  const useBrand = brandingHasHeader(b);
  const headerLines = useBrand ? [b.headerTitle.trim(), b.headerSubtitle.trim()].filter(Boolean) : model.headerText.slice(0, 3);
  const footerLines = b.footerText.trim() ? [b.footerText.trim()] : model.footerText.slice(0, 2);
  const logoH = logo ? mmToPoints(16) : 0;
  const headerHeight = (logo ? logoH + 4 : 0) + headerLines.length * 12 + (headerLines.length || logo ? 6 : 0);
  const footerHeight = footerLines.length * 10 + (b.showPageNumbers ? 10 : 0);

  const left = mmToPoints(b.marginLeftMm);
  const right = A4.width - mmToPoints(b.marginRightMm);
  const top = A4.height - Math.max(mmToPoints(b.marginTopMm), mmToPoints(8) + headerHeight + 6);
  const bottom = Math.max(mmToPoints(b.marginBottomMm), mmToPoints(6) + footerHeight + 6);
  const width = right - left;
  if (width < 200 || top - bottom < 200) throw new DocxEngineError("As margens do timbrado deixam pouco espaço para o texto.");

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    y = top;
  };
  newPage();

  const drawParagraph = (p: ParagraphBlock, x: number, maxWidth: number, target: { page: PDFPage; y: number } | null) => {
    const indent = Math.min(p.indentPt + (p.bullet ? 12 : 0), maxWidth / 3);
    const runs = p.bullet ? [{ ...(p.runs[0] ?? { bold: false, italic: false, underline: false, sizePt: 11, highlight: false }), text: "\u2022 " }, ...p.runs] : p.runs;
    const lines = layoutParagraph({ ...p, runs }, maxWidth - indent, fonts, unsupported);
    return { lines, indent };
  };

  const renderBlock = (block: Block) => {
    if (block.kind === "paragraph") {
      const { lines, indent } = drawParagraph(block, left, width, null);
      const before = block.heading ? 6 : 0;
      if (y - before < bottom + (lines[0]?.height ?? 12)) newPage();
      else y -= before;
      lines.forEach((line, i) => {
        if (y - line.height < bottom) newPage();
        drawLine(page, line, left + indent, y, width - indent, block.align, i === lines.length - 1);
        y -= line.height;
      });
      y -= Math.min(block.spaceAfterPt, 24);
      return;
    }
    const total = block.columnWidths.reduce((a, c) => a + c, 0) || 1;
    const cols = block.columnWidths.map((w) => (w / total) * width);
    const headerRows = block.rows.filter((r) => r.header);
    const measure = (row: (typeof block.rows)[number]) => {
      let col = 0;
      const cells = row.cells.map((c) => {
        const w = cols.slice(col, col + c.span).reduce((a, v) => a + v, 0) || cols[col] || width;
        const x = left + cols.slice(0, col).reduce((a, v) => a + v, 0);
        col += c.span;
        const paras = c.paragraphs.map((p) => drawParagraph(row.header ? { ...p, runs: p.runs.map((r) => ({ ...r, bold: true })) } : p, x, w - CELL_PAD * 2, null));
        const h = paras.reduce((a, pr) => a + pr.lines.reduce((s, l) => s + l.height, 0) + 2, 0);
        return { x, w, paras, h, src: c };
      });
      return { cells, height: Math.max(14, ...cells.map((c) => c.h + CELL_PAD * 2)) };
    };
    const drawRow = (m: ReturnType<typeof measure>, isHeader: boolean) => {
      for (const c of m.cells) {
        page.drawRectangle({ x: c.x, y: y - m.height, width: c.w, height: m.height, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.5, color: isHeader ? rgb(0.93, 0.93, 0.93) : undefined });
        let cy = y - CELL_PAD;
        c.paras.forEach((pr, pi) => {
          pr.lines.forEach((line, li) => {
            drawLine(page, line, c.x + CELL_PAD + pr.indent, cy, c.w - CELL_PAD * 2 - pr.indent, c.src.paragraphs[pi]!.align, li === pr.lines.length - 1);
            cy -= line.height;
          });
          cy -= 2;
        });
      }
      y -= m.height;
    };
    const headerMeasures = headerRows.map(measure);
    for (const row of block.rows) {
      const m = measure(row);
      if (m.height > top - bottom - 40) {
        throw new DocxEngineError("Uma linha de tabela é maior que uma página e não pode ser paginada no PDF. Divida o conteúdo da célula.");
      }
      if (y - m.height < bottom) {
        newPage();
        if (!row.header) headerMeasures.forEach((h) => drawRow(h, true));
      }
      drawRow(m, row.header);
    }
    y -= 8;
  };

  if (options.title?.trim()) {
    renderBlock({ kind: "paragraph", runs: [{ text: options.title.trim(), bold: true, italic: false, underline: false, sizePt: 13, highlight: false }], align: "center", heading: 1, indentPt: 0, spaceAfterPt: 12, bullet: false });
  }
  for (const block of model.blocks) renderBlock(block);
  for (const extra of options.appendix ?? []) {
    renderBlock({ kind: "paragraph", runs: [{ text: extra, bold: false, italic: false, underline: false, sizePt: 9, highlight: false }], align: "left", heading: null, indentPt: 0, spaceAfterPt: 2, bullet: false });
  }

  if (unsupported.size > 0) {
    throw new DocxEngineError(
      `O texto contém caracteres que o PDF não suporta: ${[...unsupported].slice(0, 10).join(" ")}. Substitua-os ou exporte em Word.`,
    );
  }

  const total = pages.length;
  pages.forEach((pg, index) => {
    let hy = A4.height - mmToPoints(8);
    if (logo) {
      const scale = logoH / logo.height;
      const lw = logo.width * scale;
      pg.drawImage(logo, { x: (A4.width - lw) / 2, y: hy - logoH, width: lw, height: logoH });
      hy -= logoH + 4;
    }
    headerLines.forEach((text, i) => {
      const font = i === 0 && useBrand ? fonts.bold : fonts.regular;
      const size = i === 0 && useBrand ? 11 : 9;
      const clean = sanitizeForPdf(text, font, new Set());
      const tw = font.widthOfTextAtSize(clean, size);
      pg.drawText(clean, { x: (A4.width - tw) / 2, y: hy - size, size, font });
      hy -= 12;
    });
    if (headerLines.length || logo) pg.drawLine({ start: { x: left, y: hy - 2 }, end: { x: right, y: hy - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    let fy = mmToPoints(6) + footerHeight;
    footerLines.forEach((text) => {
      const clean = sanitizeForPdf(text, fonts.regular, new Set());
      const tw = fonts.regular.widthOfTextAtSize(clean, 8);
      pg.drawText(clean, { x: (A4.width - tw) / 2, y: fy - 8, size: 8, font: fonts.regular });
      fy -= 10;
    });
    if (b.showPageNumbers) {
      const label = `Página ${index + 1} de ${total}`;
      const tw = fonts.regular.widthOfTextAtSize(label, 8);
      pg.drawText(label, { x: right - tw, y: mmToPoints(6), size: 8, font: fonts.regular });
    }
  });

  const bytes = await pdf.save();
  // Integrity check: the produced file must load and keep its page count.
  const reloaded = await PDFDocument.load(bytes);
  if (reloaded.getPageCount() !== total) throw new DocxEngineError("Falha de integridade ao gerar o PDF.");
  return bytes;
}
