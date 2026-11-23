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

  it("filtra contratos de até 120 dias e certidões apenas de fornecedores fiscalizados", () => {
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

  it("inclui planejamento antecipado e contratos vencidos ainda vigentes", () => {
    const tasks = montarMinhasTarefas(
      "user-1",
      null,
      [],
      [],
      [
        contrato({ id: "overdue", end_date: "2026-11-17" }),
        contrato({ id: "planning", end_date: "2027-03-01" }),
        contrato({ id: "closed", status: "encerrado", end_date: "2026-11-17" }),
      ],
      [],
      hoje,
    );
    expect(tasks.map((task) => task.entityId)).toEqual(["overdue", "planning"]);
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
  it("integra providências atribuídas do checklist de renovação à Central de Tarefas", () => {
    const tasks = montarMinhasTarefas("user-1", null, [], [], [], [], hoje, [
      {
        id: "renewal-task-1",
        contract_id: "c1",
        title: "Emitir relatório de execução",
        due_date: "2026-11-20",
        status: "pending",
        item_key: "relatorio_execucao",
      },
    ]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "renovacao-renewal-task-1",
      tipo: "renovacao",
      destino: "/contratos",
      entityId: "c1",
      dias: 2,
    });
  });
});

describe("radar de desabastecimento em minhas tarefas", () => {
  const item = (quantity: number, movements: Array<{ movement_type: string; quantity: number }>) => ({
    contract_id: "c1",
    contract_number: "28/2026",
    item_id: "i1",
    description: "Dipirona 500mg",
    quantity_total: quantity,
    movements,
  });
  const tasks = (items: ReturnType<typeof item>[], contracts = [contrato()]) =>
    montarMinhasTarefas("user-1", null, [], [], contracts, [], hoje, [], items);

  it("gera uma tarefa crítica por contrato para item esgotado ou até 20%", () => {
    const result = tasks([
      item(10, [{ movement_type: "consumption", quantity: 10 }]),
      { ...item(10, [{ movement_type: "consumption", quantity: 8 }]), item_id: "i2", description: "Amoxicilina" },
    ]).filter((task) => task.tipo === "saldo_critico");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "saldo-critico-c1", dias: 0, destino: "/contratos", entityId: "c1" });
    expect(result[0]?.descricao).toContain("Dipirona 500mg, Amoxicilina");
    expect(criticidadeTarefa(result[0]?.dias ?? null)).toBe("critical");
  });

  it("não alerta com saldo acima de 20%", () => {
    expect(tasks([item(10, [{ movement_type: "consumption", quantity: 7.9 }])])
      .filter((task) => task.tipo === "saldo_critico")).toHaveLength(0);
  });

  it("ignora contratos sem vínculo e instrumentos encerrados", () => {
    expect(tasks([item(10, [{ movement_type: "consumption", quantity: 10 }])], [
      contrato({ manager_user_id: "outro", inspector_user_id: "outro" }),
      contrato({ id: "encerrado", status: "encerrado" }),
    ]).filter((task) => task.tipo === "saldo_critico")).toHaveLength(0);
  });

  it("considera estornos ao calcular o saldo disponível", () => {
    const movements = [
      { movement_type: "consumption", quantity: 9 },
      { movement_type: "reversal", quantity: 2 },
    ];
    expect(tasks([item(10, movements)]).filter((task) => task.tipo === "saldo_critico")).toHaveLength(0);
    expect(tasks([item(10, movements.slice(0, 1))]).filter((task) => task.tipo === "saldo_critico")).toHaveLength(1);
  });
});
