import { describe, expect, it } from "vitest";
import { listarProcessosParados, type ProcessoParaAlertaDeParalisacao } from "./process-stagnation";

const agora = new Date("2026-11-11T12:00:00.000Z");
const processo = (
  overrides: Partial<ProcessoParaAlertaDeParalisacao> = {},
): ProcessoParaAlertaDeParalisacao => ({
  id: "processo-1",
  number: "42/2026",
  title: "Aquisição de insumos",
  stage: "pesquisa",
  status: "em_andamento",
  responsible_name: "Equipe de compras",
  updated_at: "2026-11-01T12:00:00.000Z",
  ...overrides,
});

describe("alertas de processos parados", () => {
  it("identifica processos ativos sem atividade há mais de oito dias", () => {
    const parados = listarProcessosParados(
      [
        processo(),
        processo({ id: "recente", number: "43/2026", updated_at: "2026-11-05T12:00:00.000Z" }),
        processo({ id: "limite", number: "44/2026", updated_at: "2026-11-03T12:00:00.000Z" }),
      ],
      [],
      agora,
    );

    expect(parados).toHaveLength(1);
    expect(parados[0]).toMatchObject({ id: "processo-1", diasSemAtividade: 10 });
  });

  it("considera a atualização recente do checklist como atividade", () => {
    const parados = listarProcessosParados(
      [processo()],
      [{ process_id: "processo-1", updated_at: "2026-11-10T12:00:00.000Z" }],
      agora,
    );

    expect(parados).toEqual([]);
  });

  it("ignora processos concluídos, arquivados ou com data inválida", () => {
    const parados = listarProcessosParados(
      [
        processo({ id: "concluido", status: "concluido" }),
        processo({ id: "arquivado", status: "arquivado" }),
        processo({ id: "sem-data", updated_at: "inválida" }),
      ],
      [],
      agora,
    );

    expect(parados).toEqual([]);
  });
});
