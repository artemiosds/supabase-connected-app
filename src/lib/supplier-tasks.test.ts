// =============================================================================
// supplier-tasks.test.ts — Testes unitários de Fila de Tarefas
// Primus Gestão — Fase 2.1 — Entrega 4
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  rotuloTipoTarefa,
  rotuloStatusTarefa,
  rotuloPrioridade,
  variantePrioridade,
  corPrioridade,
  estaVencida,
  SupplierPendingTask,
} from "./supplier-tasks";

describe("supplier-tasks: rótulos de tipo", () => {
  it("deve retornar rótulos amigáveis em português para todos os tipos", () => {
    expect(rotuloTipoTarefa("document_expired")).toBe("Documento Vencido");
    expect(rotuloTipoTarefa("document_expiring")).toBe("Documento a Vencer");
    expect(rotuloTipoTarefa("regularity_expired")).toBe("Regularidade Expirada");
    expect(rotuloTipoTarefa("regularity_irregular")).toBe("Irregularidade Detectada");
    expect(rotuloTipoTarefa("homologation_pending")).toBe("Homologação Pendente");
    expect(rotuloTipoTarefa("complementation_requested")).toBe("Complementação Solicitada");
    expect(rotuloTipoTarefa("sanction_recorded")).toBe("Sanção Registrada");
    expect(rotuloTipoTarefa("manual")).toBe("Tarefa Manual");
  });
});

describe("supplier-tasks: status e prioridades", () => {
  it("deve rotular corretamente os status", () => {
    expect(rotuloStatusTarefa("open")).toBe("Aberta");
    expect(rotuloStatusTarefa("in_progress")).toBe("Em Andamento");
    expect(rotuloStatusTarefa("resolved")).toBe("Resolvida");
    expect(rotuloStatusTarefa("dismissed")).toBe("Dispensada");
  });

  it("deve rotular corretamente as prioridades", () => {
    expect(rotuloPrioridade("critical")).toBe("Crítica");
    expect(rotuloPrioridade("high")).toBe("Alta");
    expect(rotuloPrioridade("medium")).toBe("Média");
    expect(rotuloPrioridade("low")).toBe("Baixa");
  });

  it("deve mapear variante de badge shadcn/ui adequada para cada prioridade", () => {
    expect(variantePrioridade("critical")).toBe("destructive");
    expect(variantePrioridade("high")).toBe("default");
    expect(variantePrioridade("medium")).toBe("outline");
    expect(variantePrioridade("low")).toBe("secondary");
  });

  it("deve retornar classe de cor correta", () => {
    expect(corPrioridade("critical")).toContain("text-red-600");
    expect(corPrioridade("high")).toContain("text-amber-600");
    expect(corPrioridade("medium")).toContain("text-blue-600");
  });
});

describe("supplier-tasks: verificação de vencimento", () => {
  const baseTask: SupplierPendingTask = {
    id: "task-1",
    supplier_id: "sup-1",
    task_type: "document_expired",
    priority: "critical",
    status: "open",
    title: "Documento Vencido",
    auto_generated: true,
    created_at: new Date().toISOString(),
  };

  it("deve retornar false se não houver data de vencimento", () => {
    expect(estaVencida(baseTask)).toBe(false);
  });

  it("deve retornar true se a data de vencimento estiver no passado e aberta", () => {
    const pastTask = { ...baseTask, due_date: "2020-01-01" };
    expect(estaVencida(pastTask)).toBe(true);
  });

  it("deve retornar false se a tarefa já estiver resolvida mesmo com data no passado", () => {
    const resolvedTask = { ...baseTask, due_date: "2020-01-01", status: "resolved" as const };
    expect(estaVencida(resolvedTask)).toBe(false);
  });

  it("deve retornar false se a data de vencimento estiver no futuro", () => {
    const futureTask = { ...baseTask, due_date: "2099-12-31" };
    expect(estaVencida(futureTask)).toBe(false);
  });
});
