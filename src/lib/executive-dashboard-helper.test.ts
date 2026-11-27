import { describe, expect, it } from "vitest";
import {
  avaliarProntidaoSecretaria,
  resumirEsteiraProcessos,
  type ProcessoResumoPainel,
} from "@/lib/executive-dashboard-helper";

function criarProcesso(
  overrides: Partial<ProcessoResumoPainel> = {},
): ProcessoResumoPainel {
  return {
    id: "p1",
    number: "001/2026",
    title: "Aquisição de medicamentos",
    stage: "planejamento",
    status: "em_andamento",
    responsible_user_id: "user-1",
    responsible_name: "Ana",
    estimated_value: 25000,
    due_date: "2026-12-10",
    updated_at: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

describe("resumirEsteiraProcessos", () => {
  it("agrupa processos ativos por etapa e identifica o que está na mesa do usuário", () => {
    const lista: ProcessoResumoPainel[] = [
      criarProcesso({ id: "p1", stage: "planejamento", responsible_user_id: "u1", estimated_value: 10000 }),
      criarProcesso({ id: "p2", stage: "pesquisa", responsible_user_id: "u2", estimated_value: 20000 }),
      criarProcesso({
        id: "p3",
        stage: "pesquisa",
        responsible_user_id: null,
        responsible_name: null,
        estimated_value: 5000,
      }),
      criarProcesso({ id: "p4", stage: "assinatura", status: "concluido", estimated_value: 99999 }),
    ];

    const resumo = resumirEsteiraProcessos(lista, "u1");

    expect(resumo.totalAtivos).toBe(3);
    expect(resumo.naMinhaMesa).toBe(1);
    expect(resumo.semResponsavel).toBe(1);
    expect(resumo.valorTotalEstimado).toBe(35000);
    expect(resumo.processosNaMinhaMesa.map((p) => p.id)).toEqual(["p1"]);

    const pesquisa = resumo.porEtapa.find((e) => e.id === "pesquisa");
    expect(pesquisa?.total).toBe(2);
    expect(pesquisa?.naMinhaMesa).toBe(0);
  });

  it("ordena processos na minha mesa priorizando prazo mais próximo", () => {
    const lista: ProcessoResumoPainel[] = [
      criarProcesso({ id: "p-sem-prazo", due_date: null, updated_at: "2026-11-25T10:00:00Z" }),
      criarProcesso({ id: "p-tarde", due_date: "2026-12-20" }),
      criarProcesso({ id: "p-cedo", due_date: "2026-12-01" }),
    ];

    const resumo = resumirEsteiraProcessos(lista, "user-1");
    expect(resumo.processosNaMinhaMesa.map((p) => p.id)).toEqual([
      "p-cedo",
      "p-tarde",
      "p-sem-prazo",
    ]);
  });
});

describe("avaliarProntidaoSecretaria", () => {
  it("retorna pronta quando todos os dados da Lei 14.133 estão configurados", () => {
    const res = avaliarProntidaoSecretaria(
      {
        trade_name: "Fundo Municipal de Saúde",
        manager_name: "Dra. Joana",
        ibge_code: "3550308",
      },
      true,
    );
    expect(res.pronta).toBe(true);
    expect(res.pendencias).toHaveLength(0);
  });

  it("lista pendências faltantes quando ficha ou regulamento está incompleto", () => {
    const res = avaliarProntidaoSecretaria(
      { trade_name: "FMS", manager_name: null, ibge_code: "" },
      false,
    );
    expect(res.pronta).toBe(false);
    expect(res.pendencias).toHaveLength(3);
  });
});
