export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => unknown;
};

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const safe = /^\s*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function gerarCsv<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  const header = columns.map((column) => csvCell(column.header)).join(";");
  const body = rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(";"));
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function exportarCsv<Row>(
  filename: string,
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[],
): boolean {
  if (typeof document === "undefined") return false;

  const safeFilename =
    filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-zA-Z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 120) || "relatorio.csv";
  const finalName = safeFilename.toLowerCase().endsWith(".csv")
    ? safeFilename
    : `${safeFilename}.csv`;
  const file = new Blob([gerarCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = finalName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

function escapeHtml(value: unknown): string {
  return (value == null ? "" : String(value)).replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function gerarHtmlRelatorio<Row>(
  title: string,
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[],
): string {
  const header = columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escapeHtml(column.value(row))}</td>`).join("")}</tr>`,
    )
    .join("");
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { color: #111827; font: 12px Arial, sans-serif; margin: 0; }
h1 { font-size: 18px; margin: 0 0 14px; }
p { color: #4b5563; font-size: 10px; margin: 0 0 10px; }
table { border-collapse: collapse; width: 100%; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 700; }
@media screen { body { margin: 24px; } }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<p>Gerado em ${escapeHtml(new Date().toLocaleString("pt-BR"))} · ${rows.length} registro(s)</p>
<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
}

export function imprimirRelatorio<Row>(
  title: string,
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[],
): boolean {
  if (typeof window === "undefined") return false;
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) return false;
  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(gerarHtmlRelatorio(title, columns, rows));
  reportWindow.document.close();
  window.setTimeout(() => {
    reportWindow.focus();
    reportWindow.print();
  }, 250);
  return true;
}
