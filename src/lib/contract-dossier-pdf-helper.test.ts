import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, buildDocxFromText, docxToModel, renderPdf } from "./docx-engine";
import {
  buildContractDossierDocumentText,
  calcularResumoDossieContratual,
  formatCnpj,
  formatarDataIsoPtBr,
  reconstruirValorOriginalContrato,
  traduzirTipoAditivo,
  type ContractDossierPdfPayload,
} from "./contract-dossier-pdf-helper";

describe("contract-dossier-pdf-helper", () => {
  it("formata CNPJ e datas ISO corretamente", () => {
    expect(formatCnpj("12345678000199")).toBe("12.345.678/0001-99");
    expect(formatCnpj("123")).toBe("123");
    expect(formatarDataIsoPtBr("2026-11-23")).toBe("23/11/2026");
    expect(formatarDataIsoPtBr("2026-11-23T12:30:00.000Z")).toBe("23/11/2026");
    expect(formatarDataIsoPtBr("2026-02-30")).toBe("2026-02-30");
    expect(formatarDataIsoPtBr(null)).toBe("Não informada");
  });

  it("traduz tipos de aditivos e reconhece apostilamentos", () => {
    expect(traduzirTipoAditivo("prorrogacao")).toBe("Prorrogação de Vigência");
    expect(traduzirTipoAditivo("acrescimo")).toBe("Acréscimo de Valor/Quantitativo");
    expect(traduzirTipoAditivo("apostilamento")).toBe("Apostilamento");
    expect(traduzirTipoAditivo("outro")).toBe("outro");
  });

  it("reconstrói o valor original sem duplicar aditivos já aplicados", () => {
    expect(
      reconstruirValorOriginalContrato(2500, [
        {
          number: "1º Termo Aditivo",
          kind: "acrescimo",
          signedAt: "2026-06-01",
          valueChange: 500,
        },
      ]),
    ).toBe(2000);

    expect(
      reconstruirValorOriginalContrato(1800, [
        {
          number: "1º Termo Aditivo",
          kind: "supressao",
          signedAt: "2026-06-01",
          valueChange: -200,
        },
      ]),
    ).toBe(2000);
  });

  it("calcula execução líquida, saldos físicos e resumo financeiro com aditivos", () => {
    const items = [
      {
        id: "item-1",
        lineNumber: 1,
        description: "Dipirona 500mg",
        unit: "cx",
        quantityTotal: 100,
        unitValue: 10,
      },
      {
        id: "item-2",
        lineNumber: 2,
        description: "Luvas de Procedimento",
        unit: "cx",
        quantityTotal: 50,
        unitValue: 20,
      },
    ];

    const movements = [
      { contract_item_id: "item-1", movement_type: "consumption", quantity: 30 },
      { contract_item_id: "item-1", movement_type: "reversal", quantity: 10 },
      { contract_item_id: "item-2", movement_type: "consumption", quantity: 50 },
    ];

    const result = calcularResumoDossieContratual({
      contractTotalValue: 2000,
      items,
      movements,
      amendments: [
        {
          number: "1º Termo Aditivo",
          kind: "acrescimo",
          signedAt: "2026-06-01",
          valueChange: 500,
        },
      ],
      ordersCount: 2,
    });

    expect(result.summary).toEqual({
      originalValue: 2000,
      amendmentsValueChange: 500,
      updatedValue: 2500,
      executedValue: 1200,
      balanceValue: 1300,
      executionPercentage: 48,
      totalItems: 2,
      totalOrders: 2,
    });
    expect(result.itemsCalculated).toHaveLength(2);
    expect(result.itemsCalculated[0]).toMatchObject({
      quantityConsumed: 20,
      quantityBalance: 80,
      percentConsumed: 20,
      totalConsumed: 200,
      totalBalance: 800,
    });
    expect(result.itemsCalculated[1]).toMatchObject({
      quantityConsumed: 50,
      quantityBalance: 0,
      percentConsumed: 100,
      totalConsumed: 1000,
      totalBalance: 0,
    });
  });

  it("não contabiliza consumo líquido negativo após estorno", () => {
    const result = calcularResumoDossieContratual({
      contractTotalValue: 100,
      items: [
        {
          id: "item-1",
          lineNumber: 1,
          description: "Soro",
          unit: "frasco",
          quantityTotal: 10,
          unitValue: 10,
        },
      ],
      movements: [
        { contract_item_id: "item-1", movement_type: "consumption", quantity: 2 },
        { contract_item_id: "item-1", movement_type: "reversal", quantity: 3 },
      ],
      amendments: [],
      ordersCount: 0,
    });

    expect(result.itemsCalculated[0]).toMatchObject({
      quantityConsumed: 0,
      quantityBalance: 10,
      percentConsumed: 0,
    });
    expect(result.summary.executedValue).toBe(0);
    expect(result.summary.balanceValue).toBe(100);
  });

  it("consolida supressões e limita a execução ao valor atualizado do instrumento", () => {
    const result = calcularResumoDossieContratual({
      contractTotalValue: 300,
      items: [
        {
          id: "item-1",
          lineNumber: 1,
          description: "Soro",
          unit: "frasco",
          quantityTotal: 10,
          unitValue: 20,
        },
      ],
      movements: [{ contract_item_id: "item-1", movement_type: "consumption", quantity: 10 }],
      amendments: [
        {
          number: "1º Termo Aditivo",
          kind: "supressao",
          signedAt: "2026-11-01",
          valueChange: -100,
        },
      ],
      ordersCount: 1,
    });

    expect(result.summary).toMatchObject({
      originalValue: 300,
      amendmentsValueChange: -100,
      updatedValue: 200,
      executedValue: 200,
      balanceValue: 0,
      executionPercentage: 100,
    });
  });

  it("propaga a validação de quantidades inválidas do motor de saldo", () => {
    expect(() =>
      calcularResumoDossieContratual({
        contractTotalValue: 100,
        items: [
          {
            id: "item-1",
            lineNumber: 1,
            description: "Soro",
            unit: "frasco",
            quantityTotal: 10,
            unitValue: 10,
          },
        ],
        movements: [{ contract_item_id: "item-1", movement_type: "consumption", quantity: -1 }],
        amendments: [],
        ordersCount: 0,
      }),
    ).toThrow(RangeError);
  });

  it("rejeita valores financeiros e quantidades de ordens inválidos", () => {
    expect(() =>
      calcularResumoDossieContratual({
        contractTotalValue: -1,
        items: [],
        movements: [],
        amendments: [],
        ordersCount: 0,
      }),
    ).toThrow(RangeError);

    expect(() =>
      calcularResumoDossieContratual({
        contractTotalValue: 100,
        items: [],
        movements: [],
        amendments: [],
        ordersCount: 1.5,
      }),
    ).toThrow(RangeError);

    expect(() =>
      calcularResumoDossieContratual({
        contractTotalValue: 100,
        items: [],
        movements: [],
        amendments: [
          {
            number: "Aditivo",
            kind: "acrescimo",
            signedAt: "2026-01-01",
            valueChange: Number.NaN,
          },
        ],
        ordersCount: 0,
      }),
    ).toThrow(RangeError);
  });

  it("gera todas as seções, valores, ordens cronológicas e campos de assinatura", () => {
    const payload: ContractDossierPdfPayload = {
      tenantName: "Fundo Municipal de Saúde de Teste",
      contract: {
        number: "CT-2026/001",
        instrumentType: "contrato",
        modality: "pregao",
        object: "Aquisição de medicamentos para a rede municipal",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        totalValue: 50000,
        status: "vigente",
        managerName: "Dr. Gestor",
        inspectorName: "Enf. Fiscal",
        ordinance: "Portaria 123/2026",
      },
      processNumber: "PROC-2026/045",
      supplier: {
        name: "Distribuidora Farmacêutica Ltda",
        cnpj: "12345678000199",
      },
      amendments: [
        {
          number: "2º Termo Aditivo",
          kind: "acrescimo",
          signedAt: "2026-11-21",
          valueChange: 500,
        },
        {
          number: "1º Termo Aditivo",
          kind: "prorrogacao",
          signedAt: "2026-06-01",
          newEndDate: "2027-12-31",
          valueChange: 0,
        },
      ],
      items: [
        {
          lineNumber: 1,
          description: "Dipirona\n500mg",
          unit: "cx",
          quantityTotal: 1000,
          quantityConsumed: 400,
          quantityBalance: 600,
          unitValue: 12.5,
          totalContracted: 12500,
          totalConsumed: 5000,
          totalBalance: 7500,
          percentConsumed: 40,
        },
      ],
      orders: [
        {
          referenceNumber: "OF-2026/002",
          createdAt: "2026-03-10",
          reason: "Abastecimento do Hospital Municipal",
          itemsCount: 1,
          totalValue: 2500,
        },
        {
          referenceNumber: "OF-2026/001",
          createdAt: "2026-02-10",
          reason: "Abastecimento da UBS Central",
          itemsCount: 1,
          totalValue: 5000,
        },
      ],
      summary: {
        originalValue: 50000,
        amendmentsValueChange: 500,
        updatedValue: 50500,
        executedValue: 5000,
        balanceValue: 45500,
        executionPercentage: 9.9,
        totalItems: 1,
        totalOrders: 2,
      },
      generatedAt: "23/11/2026 10:00",
    };

    const docText = buildContractDossierDocumentText(payload);

    expect(docText).toContain("DOSSIÊ DE EXECUÇÃO CONTRATUAL E PRESTAÇÃO DE CONTAS");
    expect(docText).toContain("CT-2026/001");
    expect(docText).toContain("Fundo Municipal de Saúde de Teste");
    expect(docText).toContain("PROC-2026/045");
    expect(docText).toContain("12.345.678/0001-99");
    expect(docText).toContain("1º Termo Aditivo");
    expect(docText).toContain("Dipirona 500mg / cx");
    expect(docText).toContain("40,0%");
    expect(docText).toContain("9,90%");
    expect(docText).toContain("OF-2026/001");
    expect(docText.indexOf("2º Termo Aditivo")).toBeGreaterThan(
      docText.indexOf("1º Termo Aditivo"),
    );
    expect(docText.indexOf("OF-2026/001")).toBeLessThan(docText.indexOf("OF-2026/002"));
    expect(docText).toContain("Lei Federal nº 14.133/2021");
    expect(docText).toContain("Fiscal Designado");
    expect(docText).toContain("Gestor do Contrato");
    expect(docText).toContain("Ordenador(a) de Despesas");
    expect(docText).toContain("Representante Legal da Contratada");
    expect(docText).not.toContain("Dipirona\n500mg");
  });

  it("renderiza PDF timbrado válido em paisagem com tabelas", async () => {
    const payload: ContractDossierPdfPayload = {
      tenantName: "Secretaria Municipal de Saúde",
      contract: {
        number: "CT-2026/001",
        instrumentType: "contrato",
        modality: "pregao",
        object: "Aquisição de medicamentos",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        totalValue: 1000,
        status: "vigente",
        managerName: "Gestor",
        inspectorName: "Fiscal",
        ordinance: "Portaria 123/2026",
      },
      supplier: { name: "Fornecedor Teste Ltda.", cnpj: "12345678000199" },
      amendments: [],
      items: [
        {
          lineNumber: 1,
          description: "Dipirona 500mg",
          unit: "caixa",
          quantityTotal: 10,
          quantityConsumed: 2,
          quantityBalance: 8,
          unitValue: 10,
          totalContracted: 100,
          totalConsumed: 20,
          totalBalance: 80,
          percentConsumed: 20,
        },
      ],
      orders: [],
      summary: {
        originalValue: 1000,
        amendmentsValueChange: 0,
        updatedValue: 1000,
        executedValue: 20,
        balanceValue: 980,
        executionPercentage: 2,
        totalItems: 1,
        totalOrders: 0,
      },
      generatedAt: "23/11/2026 10:00",
    };

    const docxBytes = await buildDocxFromText(
      buildContractDossierDocumentText(payload),
      "Dossiê TCE",
      "landscape",
    );
    const model = await docxToModel(docxBytes);
    expect(model.pageLayout.widthPt).toBeGreaterThan(model.pageLayout.heightPt);

    const pdfBytes = await renderPdf(model, {
      branding: {
        ...DEFAULT_BRANDING,
        headerTitle: "Secretaria Municipal de Saúde",
        logoBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
        logoMime: "image/png",
      },
      title: "Dossiê TCE - Contrato CT-2026/001",
      useTemplatePageSize: true,
    });
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getPage(0)!.getWidth()).toBeGreaterThan(pdf.getPage(0)!.getHeight());
  });
});
