import { describe, expect, it } from "vitest";
import {
  filtrarItensCriticosParaReposicao,
  montarSugestaoProcessoReposicao,
  prepararProcurementItemsParaInsercao,
} from "./stock-replenishment-helper";

const item = (id: string) => ({
  id, line_number: 1, description: "Dipirona", specification: "500mg",
  unit: "AMPOLA", quantity_total: 10, unit_value: 2.5,
});

describe("reposição de estoque contratual", () => {
  it("seleciona esgotados e críticos e ignora saldos de atenção, normais e sem consumo", () => {
    const result = filtrarItensCriticosParaReposicao(
      [item("zero"), item("vinte"), item("atencao"), item("normal"), item("sem")],
      {
        zero: [{ movement_type: "consumption", quantity: 10 }],
        vinte: [{ movement_type: "consumption", quantity: 8 }],
        atencao: [{ movement_type: "consumption", quantity: 6 }],
        normal: [{ movement_type: "consumption", quantity: 2 }],
      },
    );
    expect(result.map((entry) => [entry.id, entry.nivel, entry.percentualDisponivel]))
      .toEqual([["zero", "esgotado", 0], ["vinte", "critico", 20]]);
    expect(result.every((entry) => entry.selecionado && entry.quantidadeSugerida === 10)).toBe(true);
  });

  it("respeita estorno na classificação", () => {
    expect(filtrarItensCriticosParaReposicao([item("a")], {
      a: [{ movement_type: "consumption", quantity: 9 }, { movement_type: "reversal", quantity: 2 }],
    })).toHaveLength(0);
  });

  it("sugere prioridade urgente somente quando há item esgotado e referencia o contrato", () => {
    const critico = filtrarItensCriticosParaReposicao([item("a")], {
      a: [{ movement_type: "consumption", quantity: 8 }],
    })[0]!;
    const alta = montarSugestaoProcessoReposicao({ contractNumber: "004/2026", itensCriticos: [critico], year: 2026 });
    expect(alta.priority).toBe("alta");
    expect(alta.title).toContain("004/2026");
    expect(alta.description).toContain("004/2026");
    expect(montarSugestaoProcessoReposicao({
      contractNumber: "004/2026", itensCriticos: [{ ...critico, nivel: "esgotado" }], year: 2026,
    }).priority).toBe("urgente");
  });

  it("mapeia vínculo, autores, numeração e totais sem preço para itens sem valor", () => {
    const payload = prepararProcurementItemsParaInsercao({
      processId: "process", tenantId: "tenant", userId: "user",
      itens: [item("a"), { ...item("b"), unit_value: 0 }].map((entry) => ({
        description: entry.description, specification: entry.specification, unit: entry.unit,
        quantidadeSugerida: 10, unit_value: entry.unit_value,
      })),
    });
    expect(payload.map((entry) => entry.line_number)).toEqual([1, 2]);
    expect(payload[0]).toMatchObject({
      tenant_id: "tenant", process_id: "process", created_by: "user", updated_by: "user",
      estimated_unit_price: 2.5, estimated_total: 25,
    });
    expect(payload[1]).toMatchObject({ estimated_unit_price: null, estimated_total: null });
  });
});
