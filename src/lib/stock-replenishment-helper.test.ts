import { describe, expect, it } from "vitest";
import {
  filtrarItensCriticosParaReposicao,
  montarSugestaoProcessoReposicao,
  prepararProcurementItemsParaInsercao,
  resumirContratosComSaldoCritico,
} from "./stock-replenishment-helper";

const item = (id: string) => ({
  id,
  line_number: 1,
  description: "Dipirona",
  specification: "500mg",
  unit: "AMPOLA",
  quantity_total: 10,
  unit_value: 2.5,
});

describe("reposição de estoque contratual", () => {
  it("seleciona somente saldos esgotados e críticos, incluindo o limite de 20%", () => {
    const result = filtrarItensCriticosParaReposicao(
      [item("zero"), item("vinte"), item("atencao"), item("normal"), item("sem")],
      {
        zero: [{ movement_type: "consumption", quantity: 10 }],
        vinte: [{ movement_type: "consumption", quantity: 8 }],
        atencao: [{ movement_type: "consumption", quantity: 6 }],
        normal: [{ movement_type: "consumption", quantity: 2 }],
      },
    );

    expect(result.map((entry) => [entry.id, entry.nivel, entry.percentualDisponivel])).toEqual([
      ["zero", "esgotado", 0],
      ["vinte", "critico", 20],
    ]);
    expect(result.every((entry) => entry.selecionado && entry.quantidadeSugerida === 10)).toBe(
      true,
    );
  });

  it("trata ausência de movimentações como saldo integral e respeita estornos", () => {
    expect(filtrarItensCriticosParaReposicao([item("sem")], {})).toHaveLength(0);
    expect(
      filtrarItensCriticosParaReposicao([item("a")], {
        a: [
          { movement_type: "consumption", quantity: 9 },
          { movement_type: "reversal", quantity: 2 },
        ],
      }),
    ).toHaveLength(0);
  });

  it("sugere prioridade urgente quando há item esgotado e alta para apenas críticos", () => {
    const critico = filtrarItensCriticosParaReposicao([item("a")], {
      a: [{ movement_type: "consumption", quantity: 8 }],
    })[0]!;

    const alta = montarSugestaoProcessoReposicao({
      contractNumber: "004/2026",
      contractObject: "Fornecimento de medicamentos",
      itensCriticos: [critico],
      year: 2026,
    });

    expect(alta.priority).toBe("alta");
    expect(alta.modality).toBe("dispensa");
    expect(alta.requesting_unit).toBe("Fundo Municipal de Saúde / Almoxarifado Central");
    expect(alta.number).toBe("PROC-REP-042026-2026");
    expect(alta.title).toContain("004/2026");
    expect(alta.description).toContain("004/2026");
    expect(alta.description).toContain("Fornecimento de medicamentos");
    expect(alta.description).toContain("referências históricas");
    expect(alta.description).toContain("não substituem a pesquisa de preços");

    expect(
      montarSugestaoProcessoReposicao({
        contractNumber: "004/2026",
        itensCriticos: [{ ...critico, nivel: "esgotado" }],
        year: 2026,
      }).priority,
    ).toBe("urgente");
  });

  it("mapeia itens ordenados, tenant, processo e autor usando somente colunas graváveis", () => {
    const payload = prepararProcurementItemsParaInsercao({
      processId: "process",
      tenantId: "tenant",
      userId: "user",
      itens: [item("a"), { ...item("b"), unit_value: 0 }].map((entry) => ({
        description: entry.description,
        specification: entry.specification,
        unit: entry.unit,
        quantidadeSugerida: 10,
        unit_value: entry.unit_value,
      })),
    });

    expect(payload.map((entry) => entry.line_number)).toEqual([1, 2]);
    expect(payload[0]).toMatchObject({
      tenant_id: "tenant",
      process_id: "process",
      created_by: "user",
      updated_by: "user",
      quantity: 10,
      estimated_unit_price: 2.5,
      estimated_price_source: "manual",
    });
    expect(payload[1]).toMatchObject({
      estimated_unit_price: null,
      estimated_price_source: "manual",
    });
    expect(payload[0]).not.toHaveProperty("estimated_total");
    expect(payload[1]).not.toHaveProperty("estimated_total");
  });

  it("recusa dados incompatíveis com as restrições existentes da tabela", () => {
    expect(() =>
      prepararProcurementItemsParaInsercao({
        processId: "process",
        tenantId: "tenant",
        userId: "user",
        itens: [
          {
            description: "Dipirona",
            specification: null,
            unit: "UNIDADE DE FORNECIMENTO COM MAIS DE TRINTA CARACTERES",
            quantidadeSugerida: 10,
            unit_value: 2.5,
          },
        ],
      }),
    ).toThrow("A unidade do item deve ter entre 1 e 30 caracteres.");

    expect(() =>
      prepararProcurementItemsParaInsercao({
        processId: "process",
        tenantId: "tenant",
        userId: "user",
        itens: [
          {
            description: "Dipirona",
            specification: null,
            unit: "AMPOLA",
            quantidadeSugerida: 0,
            unit_value: 2.5,
          },
        ],
      }),
    ).toThrow("A quantidade a adquirir deve ser positiva e válida.");
  });

  it("resume e ordena contratos com itens esgotados ou críticos para alertas globais", () => {
    const resumo = resumirContratosComSaldoCritico({
      contracts: [
        { id: "c1", number: "010/2026", object: "Insumos hospitalares" },
        { id: "c2", number: "005/2026", object: "Medicamentos essenciais" },
        { id: "c3", number: "020/2026", object: "Saldo normal" },
      ],
      items: [
        { ...item("i1"), contract_id: "c1" },
        { ...item("i2"), contract_id: "c2" },
        { ...item("i3"), contract_id: "c3" },
      ],
      movements: [
        { contract_item_id: "i1", movement_type: "consumption", quantity: 8 },
        { contract_item_id: "i2", movement_type: "consumption", quantity: 10 },
        { contract_item_id: "i3", movement_type: "consumption", quantity: 1 },
      ],
    });

    expect(resumo.map((entry) => entry.contractId)).toEqual(["c2", "c1"]);
    expect(resumo[0]).toMatchObject({
      contractNumber: "005/2026",
      esgotadosCount: 1,
      criticosCount: 0,
    });
    expect(resumo[1]).toMatchObject({
      contractNumber: "010/2026",
      esgotadosCount: 0,
      criticosCount: 1,
    });
  });
});
