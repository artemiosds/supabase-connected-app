import { describe, expect, it } from "vitest";
import { gerarCsv, gerarHtmlRelatorio } from "./csv-export";

describe("exportação CSV compatível com Excel", () => {
  it("exporta em UTF-8 com separador regional e aspas escapadas", () => {
    const csv = gerarCsv(
      [{ header: "Nome", value: (row: { nome: string }) => row.nome }],
      [{ nome: 'Fornecedor "A"; Saúde' }],
    );

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Fornecedor ""A""; Saúde"');
  });

  it.each(["=1+1", "+1", "-1+1", "@SUM(A1:A2)", "  =1+1"])(
    "neutraliza conteúdo que poderia ser fórmula: %s",
    (value) => {
      const csv = gerarCsv([{ header: "Campo", value: () => value }], [{}]);
      expect(csv).toContain(`"'${value}"`);
    },
  );

  it("preserva valores numéricos zero e trata nulos como vazio", () => {
    const csv = gerarCsv(
      [{ header: "Valor", value: (row: { value: number | null }) => row.value }],
      [{ value: 0 }, { value: null }],
    );

    expect(csv).toContain('"0"');
    expect(csv).toContain('""');
  });

  it("escapa dados fornecidos por usuário no relatório para impressão", () => {
    const html = gerarHtmlRelatorio(
      "<script>alert(1)</script>",
      [{ header: "Objeto", value: (row: { objeto: string }) => row.objeto }],
      [{ objeto: "<img src=x onerror=alert(1)>" }],
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
