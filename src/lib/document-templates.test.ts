import { describe, expect, it } from "vitest";
import {
  buildSamplePreviewContext,
  classificarEtapaFluxoModelo,
  contarModelosPorFluxo,
  defaultTemplateScopeConfig,
  extractTemplatePlaceholders,
  filterAndSortTemplatesForContext,
  renderTemplateSamplePreview,
  sanitizeAvailabilityScopes,
  sanitizeProcessStages,
} from "./document-templates";

describe("defaultTemplateScopeConfig e sanitização", () => {
  it("atribui escopos e etapas adequados para cada tipo de modelo", () => {
    expect(defaultTemplateScopeConfig("dfd")).toEqual({
      availability_scopes: ["processos", "avulso"],
      process_stages: ["planejamento"],
    });
    expect(defaultTemplateScopeConfig("term_addendum_renewal")).toEqual({
      availability_scopes: ["contratos"],
      process_stages: [],
    });
    expect(defaultTemplateScopeConfig("parecer_juridico")).toEqual({
      availability_scopes: ["processos", "contratos"],
      process_stages: ["parecer"],
    });
  });

  it("remove escopos e etapas inválidos preservando o fallback seguro", () => {
    expect(sanitizeAvailabilityScopes(["processos", "invalido", "processos"])).toEqual([
      "processos",
    ]);
    expect(sanitizeAvailabilityScopes([], "etp")).toEqual(["processos", "avulso"]);
    expect(sanitizeProcessStages(["estudos", "etapa_falsa", "objeto", "estudos"])).toEqual([
      "estudos",
      "objeto",
    ]);
  });
});

describe("filterAndSortTemplatesForContext", () => {
  const templates = [
    {
      id: "1",
      title: "DFD Padrão",
      content: "DFD",
      template_type: "dfd",
      is_active: true,
      availability_scopes: ["processos", "avulso"],
      process_stages: ["planejamento"],
    },
    {
      id: "2",
      title: "ETP Digital",
      content: "ETP",
      template_type: "etp",
      is_active: true,
      availability_scopes: ["processos"],
      process_stages: ["estudos"],
    },
    {
      id: "3",
      title: "Minuta Aditivo",
      content: "Aditivo",
      template_type: "term_addendum_renewal",
      is_active: true,
      availability_scopes: ["contratos"],
      process_stages: [],
    },
    {
      id: "4",
      title: "Modelo Inativo",
      content: "Antigo",
      template_type: "custom",
      is_active: false,
      availability_scopes: ["avulso"],
      process_stages: [],
    },
  ];

  it("prioriza modelos recomendados para a etapa atual do processo", () => {
    const filtered = filterAndSortTemplatesForContext(templates, {
      scope: "processos",
      processStage: "estudos",
    });

    expect(filtered.map((t) => t.id)).toEqual(["2", "1"]);
    expect(filtered[0]?.recommendedForStage).toBe(true);
    expect(filtered[1]?.recommendedForStage).toBe(false);
  });

  it("filtra por disponibilidade em contratos sem misturar modelos apenas de processo", () => {
    const filtered = filterAndSortTemplatesForContext(templates, {
      scope: "contratos",
    });
    expect(filtered.map((t) => t.id)).toEqual(["3"]);
  });

  it("filtra modelos inativos e pesquisa por texto", () => {
    const inativos = filterAndSortTemplatesForContext(templates, {
      status: "inactive",
      includeOutOfScope: true,
    });
    expect(inativos.map((t) => t.id)).toEqual(["4"]);

    const busca = filterAndSortTemplatesForContext(templates, {
      search: "Aditivo",
      includeOutOfScope: true,
    });
    expect(busca.map((t) => t.id)).toEqual(["3"]);
  });
});

describe("renderTemplateSamplePreview e extractTemplatePlaceholders", () => {
  it("classifica placeholders e gera prévia preenchida com dados de contexto", () => {
    const content =
      "Secretaria: {{secretaria}}\nProcesso: {{numero_processo}}\nFundamento: {{fundamento_prorrogacao}}\nCláusula custom: {{clausula_local}}";
    const info = extractTemplatePlaceholders(content);
    expect(info.automatic).toContain("secretaria");
    expect(info.automatic).toContain("numero_processo");
    expect(info.manualOrCustom).toContain("fundamento_prorrogacao");
    expect(info.manualOrCustom).toContain("clausula_local");

    const ctx = buildSamplePreviewContext({
      tenantName: "Secretaria de Saúde de Campinas",
      municipality: "Campinas",
      state: "SP",
    });
    const preview = renderTemplateSamplePreview({
      content,
      context: ctx,
      manualSampleValues: { fundamento_prorrogacao: "Art. 107 da Lei nº 14.133/2021" },
    });

    expect(preview.content).toContain("Secretaria de Saúde de Campinas");
    expect(preview.content).toContain("PA-042/2026");
    expect(preview.content).toContain("Art. 107 da Lei nº 14.133/2021");
    expect(preview.missingKeys).toHaveLength(0);
    expect(preview.unknownKeys).toEqual(["clausula_local"]);
  });

  it("classifica e contabiliza modelos pelo fluxo da contratação (DFD → ETP → TR → Edital → Contrato)", () => {
    expect(classificarEtapaFluxoModelo({ template_type: "dfd" })).toBe("dfd");
    expect(classificarEtapaFluxoModelo({ template_type: "etp" })).toBe("etp");
    expect(classificarEtapaFluxoModelo({ template_type: "tr" })).toBe("tr");
    expect(classificarEtapaFluxoModelo({ template_type: "edital" })).toBe("edital");
    expect(classificarEtapaFluxoModelo({ template_type: "term_addendum_renewal" })).toBe("contrato");
    expect(
      classificarEtapaFluxoModelo({ template_type: "custom", process_stages: ["estudos"] }),
    ).toBe("etp");

    const contagem = contarModelosPorFluxo([
      { template_type: "dfd", is_active: true },
      { template_type: "etp", is_active: true },
      { template_type: "tr", is_active: true },
      { template_type: "edital", is_active: true },
      { template_type: "contrato", is_active: true },
      { template_type: "dfd", is_active: false },
    ]);
    expect(contagem).toEqual({
      dfd: 1,
      etp: 1,
      tr: 1,
      edital: 1,
      contrato: 1,
    });
  });
});
