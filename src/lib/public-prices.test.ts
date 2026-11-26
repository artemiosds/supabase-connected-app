import { describe, expect, it } from "vitest";
import {
  calcularEstatisticasPrecosPublicos,
  montarPayloadCotacaoPublica,
  type PublicPriceRecord,
} from "./public-prices";

describe("public-prices: consulta oficial Compras.gov.br / PNCP", () => {
  it("calcula estatísticas (mínimo, mediana, média, máximo e CV%) corretamente", () => {
    const stats = calcularEstatisticasPrecosPublicos([0.1, 0.2, 0.3, 0.4]);
    expect(stats.count).toBe(4);
    expect(stats.min).toBe(0.1);
    expect(stats.median).toBe(0.25);
    expect(stats.average).toBe(0.25);
    expect(stats.max).toBe(0.4);
    expect(stats.cvPercent).toBeGreaterThan(50);

    const empty = calcularEstatisticasPrecosPublicos([0, -5, Number.NaN]);
    expect(empty).toEqual({
      count: 0,
      min: null,
      median: null,
      average: null,
      max: null,
      cvPercent: null,
    });
  });

  it("monta payload compatível com fn_guard_procurement_quote_source_metadata", () => {
    const record: PublicPriceRecord = {
      id: "92585205900022025-13321617",
      idCompra: "92585205900022025",
      numeroItemCompra: 54,
      codigoItemCatalogo: "267203",
      description: "DIPIRONA SÓDICA, DOSAGEM: 500 MG",
      unit: "COMPR",
      quantity: 400000,
      unitPrice: 0.15,
      brand: "PRATI-DONADUZZI",
      supplierName: "SILVA E DELGADO LTDA",
      supplierCnpj: "08.393.709/0001-06",
      organName: "SEAP/PA",
      uasgCode: "925852",
      uasgName: "EPA - SEAP",
      uf: "PA",
      municipio: "BELÉM",
      esfera: "E",
      poder: "E",
      purchaseDate: "2026-11-24",
      objectSummary: "Aquisição de medicamentos",
      referenceIdentifier: "Compras.gov.br #92585205900022025 · CATMAT 267203 · Item 54",
      referenceUrl:
        "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial?tipo=codigoItemCatalogo&codigo=267203",
    };

    const payload = montarPayloadCotacaoPublica({
      tenantId: "tenant-1",
      procurementItemId: "item-1",
      itemQuantity: 1000,
      userId: "user-1",
      queriedAt: "2026-11-25T23:40:00.000Z",
      record,
    });

    expect(payload.source_type).toBe("painel_precos");
    expect(payload.accessed_at).toBe("2026-11-25T23:40:00.000Z");
    expect(payload.quoted_at).toBe("2026-11-24");
    expect(payload.source_name).toBe("SEAP/PA (PA)");
    expect(payload.source_tax_id).toBe("08.393.709/0001-06");
    expect(payload.reference_identifier).toContain("CATMAT 267203");
    expect(payload.unit_price).toBe(0.15);
    expect(payload.quantity).toBe(1000);
    expect(payload.delivery_cost).toBe(0);
    expect(payload.brand_model).toBe("PRATI-DONADUZZI");
    expect(payload.notes).toContain("BELÉM/PA");
  });
});
