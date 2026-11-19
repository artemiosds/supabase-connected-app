import { describe, expect, it } from "vitest";
import {
  necessitaAcompanhamentoDocumental,
  prioridadeDocumental,
  resumirMonitoramentoDocumental,
} from "./supplier-document-monitor";

const hoje = "2026-11-19";

describe("monitoramento documental da Fase 2.1", () => {
  it("prioriza vencidos, vencimento de hoje e próximos 30 dias", () => {
    const resumos = resumirMonitoramentoDocumental(
      [{ id: "vencido" }, { id: "hoje" }, { id: "proximo" }],
      [
        { supplier_id: "vencido", status: "active", expires_at: "2026-11-18" },
        { supplier_id: "vencido", status: "active", expires_at: "2026-11-29" },
        { supplier_id: "hoje", status: "active", expires_at: hoje },
        { supplier_id: "proximo", status: "active", expires_at: "2026-12-19" },
      ],
      hoje,
    );
    expect(resumos.get("vencido")).toMatchObject({
      total: 2,
      vencidos: 1,
      aVencer: 1,
      situacao: "vencido",
      vencimentoMaisProximo: "2026-11-18",
    });
    expect(resumos.get("hoje")?.situacao).toBe("vence_hoje");
    expect(resumos.get("proximo")?.situacao).toBe("a_vencer");
    expect(necessitaAcompanhamentoDocumental("vence_hoje")).toBe(true);
    expect(prioridadeDocumental("vencido")).toBeLessThan(prioridadeDocumental("sem_alerta"));
  });

  it("não inclui documentos arquivados ou fornecedores fora da lista autorizada", () => {
    const resumos = resumirMonitoramentoDocumental(
      [{ id: "visivel" }],
      [
        { supplier_id: "visivel", status: "archived", expires_at: "2026-01-01" },
        { supplier_id: "outro", status: "active", expires_at: "2026-01-01" },
      ],
      hoje,
    );
    expect(resumos.size).toBe(1);
    expect(resumos.get("visivel")).toMatchObject({
      total: 0,
      situacao: "sem_documentos",
      vencidos: 0,
    });
    expect(resumos.has("outro")).toBe(false);
  });

  it("diferencia sem documento, sem validade e sem alerta de prazo", () => {
    const resumos = resumirMonitoramentoDocumental(
      [{ id: "vazio" }, { id: "indefinido" }, { id: "futuro" }],
      [
        { supplier_id: "indefinido", status: "active", expires_at: null },
        { supplier_id: "futuro", status: "active", expires_at: "2027-01-01" },
        { supplier_id: "futuro", status: "active", expires_at: null },
      ],
      hoje,
    );
    expect(resumos.get("vazio")?.situacao).toBe("sem_documentos");
    expect(resumos.get("indefinido")).toMatchObject({
      situacao: "sem_validade",
      semValidade: 1,
    });
    expect(resumos.get("futuro")).toMatchObject({
      situacao: "sem_alerta",
      semValidade: 1,
      vencimentoMaisProximo: "2027-01-01",
    });
    expect(necessitaAcompanhamentoDocumental("sem_alerta")).toBe(false);
  });

  it("documento ativo com validade inválida não recebe selo de regularidade", () => {
    const resumo = resumirMonitoramentoDocumental(
      [{ id: "erro" }],
      [{ supplier_id: "erro", status: "active", expires_at: "invalida" }],
      hoje,
    ).get("erro");
    expect(resumo?.situacao).toBe("sem_validade");
    expect(resumo?.vencimentoMaisProximo).toBeNull();
  });
});
