import JSZip from "jszip";
import { W_NS, escapeXml } from "./xml";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`;

function runs(text: string, bold = false): string {
  return text
    .split("\t")
    .map((part, i) => `${i > 0 ? "<w:r><w:tab/></w:r>" : ""}<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`)
    .join("");
}

function paragraph(text: string, style?: string, align?: string): string {
  const pPr = style || align ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>` : "";
  return `<w:p>${pPr}${text ? runs(text) : ""}</w:p>`;
}

function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 120 || t.includes("{{")) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function table(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = Math.floor(9000 / cols);
  const border = (s: string) => `<w:${s} w:val="single" w:sz="4" w:color="808080"/>`;
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows
    .map(
      (r, ri) =>
        `<w:tr>${ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: cols }, (_, ci) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p>${runs(r[ci] ?? "", ri === 0)}</w:p></w:tc>`).join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width * cols}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl><w:p/>`;
}

/**
 * Builds a clean DOCX from plain text (models saved without an original Word file).
 * Consecutive tab-separated lines become a bordered table; short uppercase lines
 * become headings. Placeholders are kept so the regular generator can fill them.
 */
export async function buildDocxFromText(text: string, title?: string): Promise<Uint8Array> {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const parts: string[] = [];
  if (title?.trim()) parts.push(paragraph(title.trim(), "Title"));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.includes("\t")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("\t")) {
        rows.push(lines[i]!.split("\t"));
        i += 1;
      }
      i -= 1;
      parts.push(table(rows));
      continue;
    }
    parts.push(isHeading(line) ? paragraph(line.trim(), "Heading1") : paragraph(line, undefined, line.trim() ? "both" : undefined));
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${parts.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/document.xml", document);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
