import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { gerarXlsx } from "./xlsx-export";

describe("exportação XLSX", () => {
  it("gera um pacote Excel com valores numéricos, filtro e cabeçalho fixo", async () => {
    const bytes = await gerarXlsx(
      [
        { header: "Número", value: (row: { numero: string; valor: number }) => row.numero },
        { header: "Valor", value: (row: { numero: string; valor: number }) => row.valor },
      ],
      [{ numero: "42/2026", valor: 125.5 }],
    );
    const zip = await JSZip.loadAsync(bytes);
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("_rels/.rels")).not.toBeNull();
    expect(zip.file("xl/_rels/workbook.xml.rels")).not.toBeNull();
    expect(workbook).toContain('sheet name="Relatório"');
    expect(sheet).toContain('autoFilter ref="A1:B2"');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="B2" t="n"><v>125.5</v></c>');
  });

  it("preserva fórmulas recebidas como texto e escapa conteúdo XML", async () => {
    const bytes = await gerarXlsx(
      [{ header: "Objeto", value: (row: { objeto: string }) => row.objeto }],
      [{ objeto: '=HYPERLINK("https://exemplo.invalid","<teste>&")' }],
    );
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

    expect(sheet).toContain('r="A2" t="inlineStr"');
    expect(sheet).toContain("&lt;teste&gt;&amp;");
    expect(sheet).not.toContain("<f>");
  });

  it("rejeita células acima do limite do Excel", async () => {
    await expect(
      gerarXlsx([{ header: "Texto", value: () => "x".repeat(32_768) }], [{}]),
    ).rejects.toThrow("32.767 caracteres");
  });
});
