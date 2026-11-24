// =============================================================================
// process-stage-transition-helper.test.ts — Testes unitários da Transição
// Primus Gestão — Lei nº 14.133/2021 — Fase 2
// =============================================================================

import { describe, expect, it } from "vitest";
import { validarTransicaoEtapa } from "./process-stage-transition-helper";

describe("validarTransicaoEtapa", () => {
  it("bloqueia avanço quando há itens pendentes no checklist da fase", () => {
    const res = validarTransicaoEtapa(
      { id: "p1", stage: "planejamento", estimated_value: 10000, responsible_name: "Ana", due_date: "2026-12-31" },
      [
        { id: "i1", stage: "planejamento", title: "DFD", is_done: true },
        { id: "i2", stage: "planejamento", title: "PCA", is_done: false },
      ],
      5
    );

    expect(res.podeAvancar).toBe(false);
    expect(res.bloqueios.length).toBe(1);
    expect(res.proximaEtapa).toBe("estudos");
  });

  it("bloqueia avanço de 'objeto' para 'pesquisa' se não houver itens cadastrados", () => {
    const res = validarTransicaoEtapa(
      { id: "p1", stage: "objeto", estimated_value: 0, responsible_name: "Carlos", due_date: "2026-12-31" },
      [{ id: "i1", stage: "objeto", title: "Termo de Referência", is_done: true }],
      0 // Sem itens cadastrados
    );

    expect(res.podeAvancar).toBe(false);
    expect(res.bloqueios.some((b) => b.includes("cadastrar ao menos um item"))).toBe(true);
  });

  it("permite avanço com sucesso quando requisitos estão atendidos", () => {
    const res = validarTransicaoEtapa(
      { id: "p1", stage: "objeto", estimated_value: 50000, responsible_name: "Carlos", due_date: "2026-12-31" },
      [{ id: "i1", stage: "objeto", title: "Termo de Referência", is_done: true }],
      3
    );

    expect(res.podeAvancar).toBe(true);
    expect(res.bloqueios.length).toBe(0);
    expect(res.proximaEtapa).toBe("pesquisa");
  });
});
