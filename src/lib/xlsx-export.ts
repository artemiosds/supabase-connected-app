import JSZip from "jszip";
import type { CsvColumn } from "./csv-export";

const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_CELL_CHARACTERS = 32_767;
const MAX_EXPORT_ROWS = 10_000;

function xmlText(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (text.length > MAX_CELL_CHARACTERS) {
    throw new Error("Uma célula excede o limite de 32.767 caracteres do Excel.");
  }

  return Array.from(text)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const valid =
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint >= 32 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff);
      return valid ? character : " ";
    })
    .join("")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function columnName(index: number): string {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function cell(reference: string, value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" t="n"><v>${value}</v></c>`;
  }
  // Texto inline nunca é executado como fórmula, mesmo quando começa com =, +, - ou @.
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function worksheet<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  const header = `<row r="1">${columns.map((column, index) => cell(`${columnName(index)}1`, column.header)).join("")}</row>`;
  const body = rows
    .map(
      (row, index) =>
        `<row r="${index + 2}">${columns
          .map((column, columnIndex) =>
            cell(`${columnName(columnIndex)}${index + 2}`, column.value(row)),
          )
          .join("")}</row>`,
    )
    .join("");
  const range = `A1:${columnName(columns.length - 1)}${rows.length + 1}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SHEET_NS}"><dimension ref="${range}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetData>${header}${body}</sheetData><autoFilter ref="${range}"/></worksheet>`;
}

export async function gerarXlsx<Row>(
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[],
): Promise<Uint8Array> {
  if (columns.length < 1 || columns.length > MAX_COLUMNS || rows.length + 1 > MAX_ROWS) {
    throw new Error("O relatório ultrapassa os limites de linhas ou colunas do Excel.");
  }
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Error("O XLSX aceita até 10.000 registros por vez. Refine os filtros da lista.");
  }

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file("xl/worksheets/sheet1.xml", worksheet(columns, rows));

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function exportarXlsx<Row>(
  filename: string,
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[],
): Promise<void> {
  if (typeof document === "undefined") return;
  const bytes = await gerarXlsx(columns, rows);
  const base =
    filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/\.(csv|xlsx)$/iu, "")
      .replace(/[^a-zA-Z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 115) || "relatorio";
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}.xlsx`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
