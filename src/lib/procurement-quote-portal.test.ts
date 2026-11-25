import { describe, expect, it } from "vitest";
import {
  buildFormalQuotePdfText,
  buildQuotePortalUrl,
  montarEnderecoFornecedorPortal,
  rotuloStatusSolicitacaoCotacao,
} from "./procurement-quote-portal";

describe("portal de cotação eletrônica do fornecedor", () => {
  it("gera URL segura com query param cotacao codificado", () => {
    expect(buildQuotePortalUrl("abc+123/xyz", "https://primus.saude.gov.br")).toBe(
      "https://primus.saude.gov.br/portal-fornecedor?cotacao=abc%2B123%2Fxyz",
    );
  });

  it("mapeia rótulos e variantes de status da solicitação", () => {
    expect(rotuloStatusSolicitacaoCotacao("pending")).toEqual({
      label: "Aguardando resposta",
      variante: "outline",
    });
    expect(rotuloStatusSolicitacaoCotacao("submitted")).toEqual({
      label: "Proposta recebida",
      variante: "secondary",
    });
    expect(rotuloStatusSolicitacaoCotacao("imported")).toEqual({
      label: "Importada para matriz",
      variante: "default",
    });
    expect(rotuloStatusSolicitacaoCotacao("cancelled")).toEqual({
      label: "Cancelada",
      variante: "destructive",
    });
  });

  it("monta endereço completo ignorando partes ausentes", () => {
    expect(
      montarEnderecoFornecedorPortal({
        id: "sup-1",
        legal_name: "Med Farma Ltda",
        trade_name: null,
        cnpj: "12345678000195",
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        street: "Rua Central",
        street_number: "100",
        complement: null,
        neighborhood: "Centro",
        city: "Belém",
        state: "PA",
        postal_code: "66000-000",
      }),
    ).toBe("Rua Central, 100, Centro, Belém, PA, 66000-000");
  });

  it("gera documento formal com protocolo, itens cotados, soma global e hash SHA-256", () => {
    const text = buildFormalQuotePdfText({
      tenantName: "Secretaria Municipal de Saúde",
      processNumber: "015/2026",
      processTitle: "Aquisição de medicamentos básicos",
      supplierName: "Med Farma Ltda",
      supplierCnpj: "12345678000195",
      protocol: "COT-ABCD1234",
      sha256: "e3b0c44298fc1c149afbf4c8996fb924",
      sentAt: "2026-11-25",
      responseDeadline: "2026-11-30",
      submittedAt: "2026-11-25T16:30:00.000Z",
      payload: {
        request_id: "req-1",
        process_id: "proc-1",
        supplier_id: "sup-1",
        contact_name: "Ana Costa",
        contact_email: "ana@medfarma.com.br",
        contact_phone: "(91) 99999-0000",
        address: "Rua Central, 100, Belém, PA",
        delivery_term: "5 dias úteis",
        payment_terms: "30 dias após atesto",
        warranty_terms: "12 meses",
        notes: "Entrega fracionada conforme pedido",
        items: [
          {
            item_id: "i1",
            line_number: 1,
            description: "Dipirona 500mg",
            unit: "CX",
            quantity: 100,
            quoted: true,
            unit_price: 12.5,
            delivery_cost: 50,
            total_price: 1300,
            brand_model: "MedGenérico",
          },
          {
            item_id: "i2",
            line_number: 2,
            description: "Item não cotado",
            unit: "UN",
            quantity: 10,
            quoted: false,
            unit_price: null,
            delivery_cost: 0,
            total_price: 0,
            brand_model: null,
          },
        ],
      },
    });

    expect(text).toContain("COT-ABCD1234");
    expect(text).toContain("12.345.678/0001-95");
    expect(text).toContain("Item 1: Dipirona 500mg (100 CX)");
    expect(text).toContain("MedGenérico");
    expect(text).not.toContain("Item não cotado");
    expect(text).toContain("e3b0c44298fc1c149afbf4c8996fb924");
  });
});
