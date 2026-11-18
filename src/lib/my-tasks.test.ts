import { describe, expect, it } from "vitest";
import {
  criticidadeTarefa,
  montarMinhasTarefas,
  type ProcessoMinhaTarefa,
  type EtapaMinhaTarefa,
  type ContratoMinhaTarefa,
  type DocumentoMinhaTarefa,
} from "./my-tasks";

const hoje = new Date(2026, 10, 18);
const processo = (overrides: Partial<ProcessoMinhaTarefa> = {}): ProcessoMinhaTarefa => ({
  id: "p1",
  number: "17/2026",
  title: "Aquisição de medicamentos",
  stage: "planejamento",
  status: "em_andamento",
  responsible_user_id: null,
  responsible_name: null,
  due_date: null,
  ...overrides,
});
const etapa = (overrides: Partial<EtapaMinhaTarefa> = {}): EtapaMinhaTarefa => ({
  process_id: "p1",
  stage: "planejamento",
  title: "Preparar DFD",
  is_done: false,
  responsible_user_id: "user-1",
  responsible_name: "Equipe",
  ...overrides,
});
const contrato = (overrides: Partial<ContratoMinhaTarefa> = {}): ContratoMinhaTarefa => ({
  id: "c1",
  number: "28/2026",
  supplier_id: "s1",
  end_date: "2026-12-01",
  status: "vigente",
  manager_user_id: "user-1",
  inspector_user_id: null,
  ...overrides,
});
const certidao = (overrides: Partial<DocumentoMinhaTarefa> = {}): DocumentoMinhaTarefa => ({
  id: "d1",
  supplier_id: "s1",
  title: "Certidão Federal",
  document_type: "certidao_federal",
  expires_at: "2026-11-17",
  status: "active",
  ...overrides,
});

describe("minhas tarefas municipais", () => {
  it("mostra atribuição direta e etapa atual não concluída", () => {
    const tasks = montarMinhasTarefas("user-1", null, [processo()], [etapa()], [], [], hoje);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ tipo: "processo", titulo: "Processo nº 17/2026" });
    expect(tasks[0]?.descricao).toContain("Preparar DFD");
  });

  it("não confunde atribuições de outras pessoas ou de etapas anteriores", () => {
    const tasks = montarMinhasTarefas(
      "user-1",
      "João Souza",
      [processo({ id: "p1", responsible_name: "Maria Silva" })],
      [etapa({ responsible_user_id: "user-2" }), etapa({ stage: "estudos" })],
      [],
      [],
      hoje,
    );
    expect(tasks).toEqual([]);
  });

  it("usa o nome confirmado apenas quando não existe vínculo por UUID", () => {
    const tasks = montarMinhasTarefas(
      "user-1",
      "Ana Silva",
      [
        processo({ responsible_name: "ana silva" }),
        processo({
          id: "p2",
          number: "18/2026",
          responsible_name: "Ana Silva",
          responsible_user_id: "user-2",
        }),
      ],
      [],
      [],
      [],
      hoje,
    );
    expect(tasks.map((task) => task.entityId)).toEqual(["p1"]);
  });

  it("filtra contratos de 90 dias e certidões apenas de fornecedores fiscalizados", () => {
    const tasks = montarMinhasTarefas(
      "user-1",
      null,
      [],
      [],
      [
        contrato(),
        contrato({ id: "c2", end_date: "2027-04-01" }),
        contrato({ id: "c3", supplier_id: "s2", manager_user_id: "user-2" }),
      ],
      [
        certidao(),
        certidao({ id: "d2", supplier_id: "s2" }),
        certidao({ id: "d3", document_type: "contrato" }),
      ],
      hoje,
    );
    expect(tasks.map((task) => task.id)).toEqual(["certidao-d1", "contrato-c1"]);
  });

  it("define as faixas de criticidade solicitadas", () => {
    expect(criticidadeTarefa(-1)).toBe("critical");
    expect(criticidadeTarefa(29)).toBe("critical");
    expect(criticidadeTarefa(30)).toBe("attention");
    expect(criticidadeTarefa(60)).toBe("attention");
    expect(criticidadeTarefa(61)).toBe("info");
    expect(criticidadeTarefa(120)).toBe("info");
    expect(criticidadeTarefa(null)).toBe("normal");
  });

  it("não apresenta tarefas sem sessão de usuário", () => {
    expect(
      montarMinhasTarefas(
        "",
        "Ana Silva",
        [processo()],
        [etapa()],
        [contrato()],
        [certidao()],
        hoje,
      ),
    ).toEqual([]);
  });
});
