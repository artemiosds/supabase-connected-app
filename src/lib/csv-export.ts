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
