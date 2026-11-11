import { describe, expect, it } from "vitest";
import {
  buildDocumentTemplateSchema,
  buildDocumentVariableValues,
  extractDocumentTemplateVariables,
  renderDocumentTemplate,
  type DocumentVariableContext,
} from "./document-variables";

const context: DocumentVariableContext = {
  organization: {
    name: "Secretaria Municipal de Saúde",
    municipality: "Campinas",
    state: "SP",
    cnpj: "12345678000199",
    ibgeCode: "3509502",
  },
  user: { name: null, email: "servidor@campinas.sp.gov.br" },
  supplier: {
    legalName: "Fornecedor Hospitalar Ltda.",
    tradeName: "Fornecedor Saúde",
    cnpj: "98765432000111",
    email: "contato@fornecedor.example",
    phone: "(19) 3333-4444",
  },
  process: {
    number: "042/2026",
    title: "Aquisição de materiais hospitalares",
    description: "Atender às unidades municipais.",
    modality: "pregao",
    stage: "pesquisa",
    status: "em_andamento",
    priority: "alta",
    requestingUnit: "Almoxarifado Central",
    responsibleName: "Maria da Silva",
    estimatedValue: 1250.5,
    dueDate: "2026-12-31",
  },
  contract: {
    number: "17/2026",
    object: "Fornecimento de materiais",
    modality: "pregao",
    totalValue: 2500,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    managerName: "João de Souza",
    inspectorName: "Ana Pereira",
    ordinance: "Portaria 12/2026",
  },
};

describe("preenchimento de modelos documentais", () => {
  it("extrai campos únicos e aceita espaços e diferenças entre maiúsculas/minúsculas", () => {
    expect(extractDocumentTemplateVariables("{{ objeto }} {{OBJETO}} {{ numero_processo}}")).toEqual(
      ["objeto", "numero_processo"],
    );
  });

  it("preserva campos configurados anteriormente ao reconstruir o schema do modelo", () => {
    expect(
      buildDocumentTemplateSchema("{{resultado_esperado}} {{numero_processo}}", [
        { key: "resultado_esperado", label: "Resultado local", required: false, source: "manual" },
      ]),
    ).toEqual([
      { key: "resultado_esperado", label: "Resultado local", required: false, source: "manual" },
      {
        key: "numero_processo",
        label: "Número do processo",
        required: true,
        source: "process",
      },
    ]);
  });

  it("resolve dados da Secretaria, fornecedor, processo e contrato", () => {
    const values = buildDocumentVariableValues(context, new Date("2026-11-11T12:00:00Z"));
    const result = renderDocumentTemplate(
      "{{secretaria}} — {{numero_processo}} — {{objeto}} — {{valor_estimado}} — {{numero_contrato}} — {{gestor}} — {{data_fim}} — {{fornecedor}}",
      values,
    );

    expect(result.content).toContain("Secretaria Municipal de Saúde");
    expect(result.content).toContain("042/2026");
    expect(result.content).toContain("Fornecimento de materiais");
    expect(result.content).toContain("R$");
    expect(result.content).toContain("17/2026");
    expect(result.content).toContain("João de Souza");
    expect(result.content).toContain("31/12/2026");
    expect(result.content).toContain("Fornecedor Hospitalar Ltda.");
    expect(result.missingKeys).toEqual([]);
    expect(result.unknownKeys).toEqual([]);
  });

  it("marca campos conhecidos vazios e identificadores não cadastrados sem removê-los silenciosamente", () => {
    const values = buildDocumentVariableValues(
      { ...context, contract: null },
      new Date("2026-11-11T12:00:00Z"),
    );
    const result = renderDocumentTemplate("{{numero_contrato}} / {{campo_novo}}", values);

    expect(result.content).toContain("[PREENCHER: Número do contrato]");
    expect(result.content).toContain("[CAMPO NÃO CONFIGURADO: campo_novo]");
    expect(result.missingKeys).toEqual(["numero_contrato"]);
    expect(result.unknownKeys).toEqual(["campo_novo"]);
  });
});
