import { describe, expect, it } from "vitest";
import {
  calcularProgressoFluxoProcesso,
  mapearDocumentoParaEtapaChecklist,
  validarTransicaoEtapa,
  type ItemChecklistEtapa,
  type ProcessoTransicao,
} from "@/lib/process-stage-transition-helper";

function criarProcessoBase(
  overrides: Partial<ProcessoTransicao> = {},
): ProcessoTransicao {
  return {
    id: "proc-1",
    stage: "planejamento",
    modality: "pregao",
    estimated_value: 50000,
    responsible_name: "Maria Silva",
    responsible_user_id: "user-1",
    due_date: "2026-12-31",
    status: "em_andamento",
    ...overrides,
  };
}

describe("validarTransicaoEtapa", () => {
  it("bloqueia avanço quando há itens pendentes na etapa atual", () => {
    const itens: ItemChecklistEtapa[] = [
      { stage: "planejamento", title: "DFD assinado", is_done: false },
      { stage: "planejamento", title: "Autorização", is_done: true },
    ];
    const res = validarTransicaoEtapa(criarProcessoBase(), itens);

    expect(res.podeAvancar).toBe(false);
    expect(res.itensPendentesEtapaAtual).toEqual(["DFD assinado"]);
    expect(res.pendenciasBloqueantes[0]).toContain("1 item(ns) pendente(s)");
  });

  it("permite avanço quando todos os itens da etapa atual estão concluídos", () => {
    const itens: ItemChecklistEtapa[] = [
      { stage: "planejamento", title: "DFD assinado", is_done: true },
    ];
    const res = validarTransicaoEtapa(criarProcessoBase(), itens);

    expect(res.podeAvancar).toBe(true);
    expect(res.pendenciasBloqueantes).toHaveLength(0);
    expect(res.etapaDestinoNome).toContain("Estudo Técnico");
  });

  it("bloqueia saída da etapa objeto sem nenhum item cadastrado", () => {
    const res = validarTransicaoEtapa(
      criarProcessoBase({ stage: "objeto" }),
      [],
      0,
    );

    expect(res.podeAvancar).toBe(false);
    expect(res.pendenciasBloqueantes[0]).toContain("Cadastre ao menos 1 item");
  });

  it("bloqueia saída da etapa pesquisa sem valor estimado válido", () => {
    const res = validarTransicaoEtapa(
      criarProcessoBase({ stage: "pesquisa", estimated_value: 0 }),
      [],
      3,
    );

    expect(res.podeAvancar).toBe(false);
    expect(res.pendenciasBloqueantes[0]).toContain("valor estimado");
  });

  it("emite aviso de teto do Decreto 12.343/2024 em dispensa acima de R$ 62.725,58", () => {
    const res = validarTransicaoEtapa(
      criarProcessoBase({
        stage: "planejamento",
        modality: "dispensa",
        estimated_value: 80000,
      }),
      [],
    );

    expect(res.podeAvancar).toBe(true);
    expect(res.avisos.some((a) => a.includes("62.725,58"))).toBe(true);
  });

  it("emite aviso quando há itens sem preço aprovado ou ausência de dotação ao avançar", () => {
    const res = validarTransicaoEtapa(
      criarProcessoBase({ stage: "parecer" }),
      [],
      2,
      { itensSemPrecoAprovado: 2, totalDotacoes: 0 },
    );

    expect(res.podeAvancar).toBe(true);
    expect(res.avisos.some((a) => a.includes("2 item(ns) sem preço"))).toBe(true);
    expect(res.avisos.some((a) => a.includes("dotação orçamentária"))).toBe(true);
  });
});

describe("calcularProgressoFluxoProcesso", () => {
  it("calcula progresso dual (fluxo macro e etapa atual)", () => {
    const itens: ItemChecklistEtapa[] = [
      { stage: "planejamento", title: "DFD", is_done: true },
      { stage: "estudos", title: "ETP", is_done: true },
      { stage: "estudos", title: "Riscos", is_done: false },
    ];
    const prog = calcularProgressoFluxoProcesso("estudos", itens, "em_andamento");

    expect(prog.etapaAtualNumero).toBe(2);
    expect(prog.totalEtapas).toBe(10);
    expect(prog.percentualFluxo).toBe(20);
    expect(prog.etapaAtualConcluidos).toBe(1);
    expect(prog.etapaAtualTotal).toBe(2);
    expect(prog.percentualEtapaAtual).toBe(50);
    expect(prog.percentualChecklistGeral).toBe(67);
    expect(prog.etapasStatus[0]?.estado).toBe("concluida");
    expect(prog.etapasStatus[1]?.estado).toBe("atual");
    expect(prog.etapasStatus[2]?.estado).toBe("pendente");
  });

  it("marca 100% quando status é concluido", () => {
    const prog = calcularProgressoFluxoProcesso("fiscalizacao", [], "concluido");
    expect(prog.percentualFluxo).toBe(100);
    expect(prog.etapasStatus.every((e) => e.estado === "concluida")).toBe(true);
  });
});

describe("mapearDocumentoParaEtapaChecklist", () => {
  it("mapeia tipos documentais principais para suas etapas", () => {
    expect(mapearDocumentoParaEtapaChecklist("dfd")).toBe("planejamento");
    expect(mapearDocumentoParaEtapaChecklist("etp")).toBe("estudos");
    expect(mapearDocumentoParaEtapaChecklist("tr")).toBe("objeto");
    expect(mapearDocumentoParaEtapaChecklist("mapa_precos")).toBe("pesquisa");
    expect(mapearDocumentoParaEtapaChecklist("parecer_juridico")).toBe("parecer");
    expect(mapearDocumentoParaEtapaChecklist("edital")).toBe("publicacao");
    expect(mapearDocumentoParaEtapaChecklist("contrato")).toBe("assinatura");
    expect(mapearDocumentoParaEtapaChecklist("desconhecido")).toBeNull();
  });
});
