import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANDING,
  analyzeDocx,
  assertPdfCompatible,
  buildDocxFromText,
  docxToModel,
  generateDocx,
  renderPdf,
  type DocumentItem,
} from "./index";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;

async function fixture(body: string, opts: { header?: string } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${opts.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${opts.header ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}</Relationships>`,
  );
  zip.file("word/styles.xml", STYLES);
  if (opts.header)
    zip.file(
      "word/header1.xml",
      `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>${opts.header}</w:t></w:r></w:p></w:hdr>`,
    );
  const sect = body.includes("<w:sectPr")
    ? ""
    : opts.header
      ? '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgMar w:top="1000" w:bottom="1000" w:left="1000" w:right="1000"/></w:sectPr>'
      : "<w:sectPr/>";
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}${sect}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function readPart(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file(name)!.async("string");
}

const ITEMS: DocumentItem[] = [
  {
    numero: "1",
    descricao: "Dipirona 500 mg",
    especificacao: "",
    unidade: "CX",
    quantidade: "120",
    valor_unitario: "R$ 10,00",
    valor_total: "R$ 1.200,00",
    local_entrega: "",
  },
  {
    numero: "2",
    descricao: "Luva de procedimento",
    especificacao: "",
    unidade: "CX",
    quantidade: "300",
    valor_unitario: "R$ 25,00",
    valor_total: "R$ 7.500,00",
    local_entrega: "",
  },
];

// Placeholder {{numero_processo}} split in three runs with different formatting.
const SPLIT_PARAGRAPH = `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Processo nº {{numero_</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>proc</w:t></w:r><w:r><w:t>esso}} – fim.</w:t></w:r></w:p>`;
const ITEMS_TABLE = `<w:tbl><w:tblPr><w:tblStyle w:val="Grade"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Descrição</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qtd.</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr><w:p><w:r><w:t>{{tabela_itens}}{{item.</w:t></w:r><w:r><w:t>descricao}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{item.quantidade}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

describe("docx engine — generation", () => {
  it("replaces a placeholder split across runs and keeps the first run formatting", async () => {
    const tpl = await fixture(
      `<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>TERMO DE REFERÊNCIA</w:t></w:r></w:p>${SPLIT_PARAGRAPH}`,
    );
    const out = await generateDocx({
      template: tpl,
      values: { numero_processo: "42/2026" },
      items: [],
    });
    const xml = await readPart(out.bytes, "word/document.xml");
    expect(xml).not.toContain("{{");
    expect(xml).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">Processo nº 42\/2026<\/w:t>/);
    expect(xml).toContain("esso}}".replace("esso}}", " – fim."));
    expect(xml).toContain('<w:pStyle w:val="Ttulo1"/>');
    expect(xml).toContain('<w:jc w:val="both"/>');
    expect(out.pending).toEqual([]);
    // Untouched parts are preserved byte for byte.
    expect(await readPart(out.bytes, "word/styles.xml")).toBe(STYLES);
  });

  it("clones the repeatable item row once per item, keeping table and cell formatting", async () => {
    const tpl = await fixture(ITEMS_TABLE);
    const out = await generateDocx({ template: tpl, values: {}, items: ITEMS });
    const xml = await readPart(out.bytes, "word/document.xml");
    expect(xml.match(/<w:tr\b/g)?.length).toBe(3); // header + 2 items
    expect(xml).toContain("Dipirona 500 mg");
    expect(xml).toContain("Luva de procedimento");
    expect(xml.match(/w:fill="EEEEEE"/g)?.length).toBe(2);
    expect(xml).toContain('<w:tblStyle w:val="Grade"/>');
    expect(xml).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">300<\/w:t>/);
    expect(out.pending).toEqual([]);
  });

  it("builds a bordered table when {{tabela_itens}} is alone in a paragraph", async () => {
    const tpl = await fixture(`<w:p><w:r><w:t>{{tabela_itens}}</w:t></w:r></w:p>`);
    const out = await generateDocx({ template: tpl, values: {}, items: ITEMS });
    const model = await docxToModel(out.bytes);
    const table = model.blocks.find((b) => b.kind === "table");
    expect(table?.kind).toBe("table");
    if (table?.kind === "table") {
      expect(table.rows).toHaveLength(3);
      expect(table.rows[0]!.header).toBe(true);
      expect(table.rows[2]!.cells[1]!.paragraphs[0]!.runs[0]!.text).toBe("Luva de procedimento");
    }
  });

  it("marks absent data as highlighted pending fields and reports them", async () => {
    const tpl = await fixture(
      `<w:p><w:r><w:t>Fiscal: {{fiscal_nome}}; Dotação: {{dotacao_orcamentaria}}; Extra: {{campo_inexistente}}</w:t></w:r></w:p>${ITEMS_TABLE}`,
    );
    const out = await generateDocx({
      template: tpl,
      values: { dotacao_orcamentaria: "[PREENCHER: Dotação orçamentária]" },
      items: [],
    });
    const keys = out.pending.map((p) => p.key).sort();
    expect(keys).toEqual([
      "campo_inexistente",
      "dotacao_orcamentaria",
      "fiscal_nome",
      "tabela_itens",
    ]);
    const xml = await readPart(out.bytes, "word/document.xml");
    expect(xml).toContain("[PENDENTE: Nome do fiscal do contrato]");
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect(xml).toContain("[PENDENTE: itens do processo]");
    expect(xml).not.toContain("{{");
  });

  it("applies the Secretaria letterhead only when the model has no header", async () => {
    const branding = {
      ...DEFAULT_BRANDING,
      headerTitle: "Secretaria Municipal de Saúde",
      footerText: "Rua A, 1",
      marginLeftMm: 25,
    };
    const plain = await generateDocx({
      template: await fixture("<w:p/>"),
      values: {},
      items: [],
      branding,
    });
    expect(plain.brandingApplied).toBe(true);
    const doc = await readPart(plain.bytes, "word/document.xml");
    expect(doc).toContain("headerReference");
    expect(doc).toContain('w:left="1417"');
    expect(await readPart(plain.bytes, "word/header_primus.xml")).toContain(
      "Secretaria Municipal de Saúde",
    );
    expect(await readPart(plain.bytes, "[Content_Types].xml")).toContain("/word/footer_primus.xml");

    const own = await generateDocx({
      template: await fixture("<w:p/>", { header: "Cabeçalho {{secretaria}}" }),
      values: { secretaria: "SMS Exemplo" },
      items: [],
      branding,
    });
    expect(own.brandingApplied).toBe(false);
    expect(await readPart(own.bytes, "word/header1.xml")).toContain("Cabeçalho SMS Exemplo");
    expect(await readPart(own.bytes, "word/document.xml")).toContain('w:left="1000"');
  });

  it("rejects files that are not DOCX packages", async () => {
    await expect(
      generateDocx({
        template: new TextEncoder().encode("isto não é um docx, apenas texto"),
        values: {},
        items: [],
      }),
    ).rejects.toThrow(/Word/);
  });
});

describe("docx engine — analysis, model and PDF", () => {
  it("warns about first-page and even-page header variants before PDF export", async () => {
    const tpl = await fixture(
      '<w:p><w:r><w:t>Documento</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="first" r:id="rId2"/></w:sectPr>',
    );
    const analysis = await analyzeDocx(tpl);
    expect(analysis.warnings.some((warning) => warning.code === "header-variants")).toBe(true);
  });

  it("blocks PDF export when unsupported Word content would be lost", () => {
    expect(() =>
      assertPdfCompatible([{ code: "images", message: "Imagens não são reproduzidas." }]),
    ).toThrow(/PDF foi bloqueado/);
    expect(() =>
      assertPdfCompatible([{ code: "table-style", message: "Estilo de tabela simples." }]),
    ).not.toThrow();
    expect(() =>
      assertPdfCompatible([{ code: "header-variants", message: "Cabeçalho de primeira página." }]),
    ).toThrow(/PDF foi bloqueado/);
  });

  it("embeds the Secretaria logo in a valid branded PDF", async () => {
    const model = await docxToModel(await buildDocxFromText("Documento institucional", "Termo"));
    const bytes = await renderPdf(model, {
      branding: {
        ...DEFAULT_BRANDING,
        headerTitle: "Secretaria Municipal de Saúde",
        footerText: "Documento institucional",
        logoBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
        logoMime: "image/png",
      },
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("reads original page size and margins for predictable PDF pagination", async () => {
    const tpl = await fixture(
      '<w:p><w:r><w:t>Documento paisagem</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080"/></w:sectPr>',
    );
    const model = await docxToModel(tpl);
    expect(model.pageLayout).toEqual({
      widthPt: 792,
      heightPt: 612,
      topPt: 36,
      rightPt: 54,
      bottomPt: 36,
      leftPt: 54,
    });
    const bytes = await renderPdf(model, {
      branding: DEFAULT_BRANDING,
      useTemplatePageSetup: true,
    });
    const page = (await PDFDocument.load(bytes)).getPage(0);
    expect(Math.round(page.getWidth())).toBe(792);
    expect(Math.round(page.getHeight())).toBe(612);

    const brandedPdf = await renderPdf(model, {
      branding: { ...DEFAULT_BRANDING, marginLeftMm: 40 },
      useTemplatePageSize: true,
    });
    const brandedPage = (await PDFDocument.load(brandedPdf)).getPage(0);
    expect(Math.round(brandedPage.getWidth())).toBe(792);
    expect(Math.round(brandedPage.getHeight())).toBe(612);
  });

  it("lists placeholders even when split between runs and warns about unsupported features", async () => {
    const tpl = await fixture(`${SPLIT_PARAGRAPH}<w:p><w:r><w:drawing/></w:r></w:p>`);
    const analysis = await analyzeDocx(tpl);
    expect(analysis.placeholders).toContain("numero_processo");
    expect(analysis.warnings.map((w) => w.code)).toContain("images");
  });

  it("reads styles, alignment and tables into the model", async () => {
    const out = await generateDocx({
      template: await fixture(
        `<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>OBJETO</w:t></w:r></w:p>${ITEMS_TABLE}`,
      ),
      values: {},
      items: ITEMS,
    });
    const model = await docxToModel(out.bytes);
    const heading = model.blocks[0];
    expect(heading?.kind === "paragraph" && heading.heading).toBe(1);
    expect(heading?.kind === "paragraph" && heading.runs[0]?.bold).toBe(true);
    expect(heading?.kind === "paragraph" && heading.runs[0]?.sizePt).toBe(16);
    const table = model.blocks[1];
    expect(table?.kind === "table" && table.columnWidths).toEqual([4000, 2000]);
  });

  it("renders a paginated A4 PDF with repeated table header and page numbers", async () => {
    const many: DocumentItem[] = Array.from({ length: 90 }, (_, i) => ({
      ...ITEMS[0]!,
      numero: String(i + 1),
      descricao: `Item número ${i + 1} com descrição ação`,
    }));
    const out = await generateDocx({
      template: await fixture(ITEMS_TABLE),
      values: {},
      items: many,
    });
    const pdfBytes = await renderPdf(await docxToModel(out.bytes), {
      branding: { ...DEFAULT_BRANDING, headerTitle: "Secretaria" },
      title: "TR",
    });
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it("refuses to export a PDF with characters the PDF fonts cannot represent", async () => {
    const out = await generateDocx({
      template: await fixture(`<w:p><w:r><w:t>Assinatura 漢字</w:t></w:r></w:p>`),
      values: {},
      items: [],
    });
    await expect(
      renderPdf(await docxToModel(out.bytes), { branding: DEFAULT_BRANDING }),
    ).rejects.toThrow(/caracteres/);
  });

  it("turns tab-separated text into a Word table when a model has no original DOCX", async () => {
    const bytes = await buildDocxFromText(
      "1. OBJETO\nAquisição para {{secretaria}}\nItem\tQtd\nLuva\t10",
      "Termo",
    );
    const model = await docxToModel(bytes);
    expect(model.blocks.some((b) => b.kind === "table" && b.rows.length === 2)).toBe(true);
    const out = await generateDocx({ template: bytes, values: { secretaria: "SMS" }, items: [] });
    expect(await readPart(out.bytes, "word/document.xml")).toContain("Aquisição para SMS");
  });
});
