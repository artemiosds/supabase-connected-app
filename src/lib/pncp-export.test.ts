import { describe, expect, it } from "vitest";
import {
  mapModalidadePncp,
  mapTipoContratoPncp,
  validarContratoPncp,
  validarProcessoPncp,
} from "./pncp-export";

describe("pncp-export: pré-validação e pacote PNCP (Lei 14.133/2021)", () => {
  it("mapeia modalidades e tipos de instrumento para códigos PNCP oficiais", () => {
    expect(mapModalidadePncp("pregao_eletronico").codigo).toBe(6);
    expect(mapModalidadePncp("dispensa").codigo).toBe(8);
    expect(mapModalidadePncp("inexigibilidade").codigo).toBe(9);
    expect(mapTipoContratoPncp("contrato").codigo).toBe(1);
    expect(mapTipoContratoPncp("ata_registro_precos").codigo).toBe(4);
  });

  it("valida contrato completo como apto (ready) e gera payload estruturado", () => {
    const res = validarContratoPncp(
      {
        name: "Secretaria Municipal de Saúde",
        cnpj: "12.345.678/0001-90",
        ibge_code: "1501402",
        municipality: "Belém",
        state: "PA",
      },
      {
        id: "ctr-1",
        number: "045/2026",
        object: "Fornecimento parcelado de medicamentos básicos",
        instrument_type: "contrato",
        modality: "pregao_eletronico",
        start_date: "2026-01-10",
        end_date: "2026-12-31",
        total_value: 250000,
        status: "vigente",
        manager_name: "Maria Silva",
        inspector_name: "João Souza",
        ordinance: "Portaria nº 12/2026",
        process_number: "PRC-010/2026",
        supplier_name: "Med Distribuidora Ltda",
        supplier_tax_id: "08.393.709/0001-06",
      },
    );

    expect(res.status).toBe("ready");
    expect(res.blockers).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
    expect((res.payload["contrato"] as Record<string, unknown>)["modalidadeId"]).toBe(6);
  });

  it("bloqueia exportação quando CNPJ do órgão ou vigência são inválidos", () => {
    const res = validarContratoPncp(
      { name: "Secretaria Sem CNPJ", cnpj: null },
      {
        id: "ctr-2",
        number: "001/2026",
        object: "Curto",
        instrument_type: "contrato",
        modality: "dispensa",
        start_date: "2026-05-10",
        end_date: "2026-01-01",
        total_value: 0,
        status: "vigente",
        supplier_tax_id: "123",
      },
    );

    expect(res.status).toBe("blocked");
    expect(res.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("valida processo de dispensa e alerta quando ainda sem valor estimado", () => {
    const res = validarProcessoPncp(
      { name: "SMS", cnpj: "12345678000190" },
      {
        id: "proc-1",
        number: "DISP-002/2026",
        title: "Aquisição emergencial de insumos hospitalares",
        modality: "dispensa",
        stage: "pesquisa_precos",
        status: "em_andamento",
        estimated_value: null,
        items: [
          {
            line_number: 1,
            description: "Luva de procedimento",
            unit: "CX",
            quantity: 100,
          },
        ],
      },
    );

    expect(res.status).toBe("ready_with_warnings");
    expect(res.blockers).toHaveLength(0);
    expect(res.warnings).toHaveLength(1);
  });
});
