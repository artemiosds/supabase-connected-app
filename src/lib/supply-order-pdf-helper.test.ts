import { describe, expect, it } from "vitest";
import {
  buildSupplyOrderDocumentText,
  type SupplyOrderPdfPayload,
} from "./supply-order-pdf-helper";
const payload: SupplyOrderPdfPayload = {
  tenantName: "Secretaria Municipal de Saúde",
  contractNumber: "CT 014/2026",
  contractObject: "Fornecimento de medicamentos",
  processNumber: "PE 032/2026",
  supplierName: "Distribuidora Saúde Ltda.",
  supplierCnpj: "12345678000190",
  referenceNumber: "OF nº 004/2026 - NE 2026NE00120",
  reason: "Abastecimento da Farmácia Central",
  createdAt: "22/11/2026",
  items: [
    {
      lineNumber: 1,
      description: "Amoxicilina 500 mg",
      unit: "COMPRIMIDO",
      quantity: 100,
      unitValue: 1.25,
      subtotal: 125,
    },
    {
      lineNumber: 2,
      description: "Dipirona 500 mg",
      unit: "AMPOLA",
      quantity: 10,
      unitValue: 110.956,
      subtotal: 1109.56,
    },
  ],
  totalValue: 1234.56,
  responsibleName: "Fiscal Designado",
};
describe("buildSupplyOrderDocumentText", () => {
  it("includes title, order reference, supplier, formatted CNPJ and process", () => {
    const text = buildSupplyOrderDocumentText(payload);
    expect(text).toContain("ORDEM DE FORNECIMENTO / AUTORIZAÇÃO DE COMPRA Nº OF nº 004/2026");
    expect(text).toContain("Distribuidora Saúde Ltda.");
    expect(text).toContain("CNPJ: 12.345.678/0001-90");
    expect(text).toContain("Processo Administrativo de Origem: PE 032/2026");
  });
  it("builds tabular rows for each requested item", () => {
    const lines = buildSupplyOrderDocumentText(payload).split("\n");
    const header = lines.indexOf(
      "Item\tDescrição\tUnidade\tQtd. Solicitada\tPreço Unit. (R$)\tTotal (R$)",
    );
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]?.split("\t")).toHaveLength(6);
    expect(lines[header + 2]?.split("\t")).toHaveLength(6);
    expect(lines[header + 1]).toContain("Amoxicilina 500 mg");
    expect(lines[header + 2]).toContain("Dipirona 500 mg");
  });
  it("formats item count, Brazilian currency and total in words", () => {
    const text = buildSupplyOrderDocumentText(payload);
    expect(text).toContain("Itens solicitados: 2");
    expect(text).toContain(
      "VALOR TOTAL DA ORDEM: R$\u00a01.234,56 (mil duzentos e trinta e quatro reais e cinquenta e seis centavos)",
    );
  });
  it("sanitizes line breaks and tabs in untrusted field values", () => {
    const text = buildSupplyOrderDocumentText({
      ...payload,
      reason: "Entrega para o posto\ncentral\tprioridade",
      items: [{ ...payload.items[0]!, description: "Amoxicilina\n\tHACK\u0000" }],
    });
    const lines = text.split("\n");
    const header = lines.indexOf(
      "Item\tDescrição\tUnidade\tQtd. Solicitada\tPreço Unit. (R$)\tTotal (R$)",
    );
    expect(lines[header + 1]?.split("\t")).toHaveLength(6);
    expect(lines[header + 1]).toContain("Amoxicilina HACK");
    expect(lines).toContain("Entrega para o posto central prioridade");
    expect(text).not.toContain("\u0000");
    expect(lines.filter((line) => line.includes("HACK"))).toHaveLength(1);
  });
});
