import { describe, expect, it } from "vitest";
import {
  avaliarUrgenciaPrazoDefesa,
  calcularPrazoDefesaUtil,
  gerarHtmlNotificacaoFormal,
  sugerirProximoNumeroFiscalizacao,
  validarRegistroFiscalizacao,
} from "./contract-inspections-helper";

describe("contract-inspections-helper (Art. 117 Lei 14.133/2021)", () => {
  it("sugere numeração sequencial separada para registros e notificações no ano", () => {
    const existentes = [
      { record_number: "REG-001/2026", record_type: "vistoria" },
      { record_number: "REG-002/2026", record_type: "ocorrencia" },
      { record_number: "NOTIF-001/2026", record_type: "notificacao" },
    ];
    expect(sugerirProximoNumeroFiscalizacao(existentes, "ocorrencia", 2026)).toBe("REG-003/2026");
    expect(sugerirProximoNumeroFiscalizacao(existentes, "notificacao", 2026)).toBe("NOTIF-002/2026");
    expect(sugerirProximoNumeroFiscalizacao(existentes, "notificacao", 2027)).toBe("NOTIF-001/2027");
  });

  it("calcula prazo em dias úteis pulando sábados e domingos", () => {
    // 2026-11-27 é sexta-feira -> +1 dia útil = segunda 2026-11-30; +5 dias úteis = sexta 2026-12-04
    expect(calcularPrazoDefesaUtil("2026-11-27", 5)).toBe("2026-12-04");
  });

  it("bloqueia ocorrência com data futura e exige prazo em notificação formal", () => {
    expect(
      validarRegistroFiscalizacao(
        {
          record_number: "REG-001/2026",
          record_type: "vistoria",
          title: "Vistoria mensal",
          description: "Conferência presencial dos serviços prestados na unidade.",
          occurred_at: "2026-11-28",
          inspector_name: "Maria Fiscal",
        },
        "2026-11-27",
      ).valido,
    ).toBe(false);

    expect(
      validarRegistroFiscalizacao(
        {
          record_number: "NOTIF-001/2026",
          record_type: "notificacao",
          title: "Atraso na entrega de insumos",
          description: "Entrega prevista para 20/11 não realizada até a presente data.",
          occurred_at: "2026-11-27",
          inspector_name: "Maria Fiscal",
          defense_deadline: null,
        },
        "2026-11-27",
      ).valido,
    ).toBe(false);

    expect(
      validarRegistroFiscalizacao(
        {
          record_number: "NOTIF-001/2026",
          record_type: "notificacao",
          title: "Atraso na entrega de insumos",
          description: "Entrega prevista para 20/11 não realizada até a presente data.",
          occurred_at: "2026-11-27",
          inspector_name: "Maria Fiscal",
          defense_deadline: "2026-12-04",
        },
        "2026-11-27",
      ).valido,
    ).toBe(true);
  });

  it("classifica corretamente urgência do prazo de defesa", () => {
    expect(avaliarUrgenciaPrazoDefesa("aguardando_defesa", "2026-11-26", "2026-11-27")).toBe(
      "vencida",
    );
    expect(avaliarUrgenciaPrazoDefesa("aguardando_defesa", "2026-11-29", "2026-11-27")).toBe(
      "vence_em_breve",
    );
    expect(avaliarUrgenciaPrazoDefesa("aguardando_defesa", "2026-12-05", "2026-11-27")).toBe(
      "no_prazo",
    );
    expect(avaliarUrgenciaPrazoDefesa("regularizada", "2026-11-20", "2026-11-27")).toBeNull();
  });

  it("gera HTML de notificação formal escapando XSS e exibindo prazo legal", () => {
    const html = gerarHtmlNotificacaoFormal({
      orgaoNome: "Secretaria Municipal de Saúde",
      contratoNumero: "042/2026",
      contratoObjeto: "Fornecimento de medicamentos",
      fornecedorNome: "Distribuidora <Teste> Ltda",
      fornecedorCnpj: "12.345.678/0001-90",
      registroNumero: "NOTIF-001/2026",
      tipo: "notificacao",
      titulo: "Desabastecimento parcial",
      descricao: "Item 03 entregue abaixo do quantitativo empenhado na OF 12/2026.",
      fundamentoLegal: "Lei nº 14.133/2021, art. 117, § 2º",
      dataOcorrencia: "2026-11-27",
      prazoDefesa: "2026-12-04",
      fiscalNome: "João da Silva",
    });

    expect(html).toContain("NOTIFICAÇÃO FORMAL DE FISCALIZAÇÃO Nº NOTIF-001/2026");
    expect(html).toContain("Distribuidora &lt;Teste&gt; Ltda");
    expect(html).toContain("04/12/2026");
    expect(html).toContain("arts. 155 e 156 da Lei nº 14.133/2021");
  });
});
