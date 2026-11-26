import { describe, expect, it } from "vitest";
import {
  resumirDetalhesAuditoria,
  rotuloAcaoAuditoria,
  rotuloEntidadeAuditoria,
} from "./audit-history-helper";

describe("audit-history-helper", () => {
  it("traduz entidades e ações críticas do sistema para rótulos humanos", () => {
    expect(rotuloEntidadeAuditoria("procurement_processes")).toBe("Processo licitatório");
    expect(rotuloEntidadeAuditoria("annual_procurement_demands")).toBe("Demanda anual (PCA / DFD)");
    expect(rotuloEntidadeAuditoria("contract_movements")).toBe("Movimentação de saldo (OF)");
    expect(rotuloAcaoAuditoria("DELETE")).toBe("Excluído");
    expect(rotuloAcaoAuditoria("annual_demand.rejected")).toBe("Demanda PCA devolvida para ajuste");
    expect(rotuloAcaoAuditoria("procurement.price_estimated.approved")).toBe(
      "Preço estimado aprovado",
    );
  });

  it("extrai campos alterados e destaques estruturados dos detalhes JSON", () => {
    const resumo = resumirDetalhesAuditoria({
      changed_fields: ["total_value", "status"],
      process_number: "015/2026",
      reason: "Ajuste após cotação oficial",
      plan_year: 2027,
    });

    expect(resumo.camposAlterados).toEqual(["total_value", "status"]);
    expect(resumo.destaques).toContain("Processo: 015/2026");
    expect(resumo.destaques).toContain("Motivo: Ajuste após cotação oficial");
    expect(resumo.destaques).toContain("Exercício PCA: 2027");
  });
});
