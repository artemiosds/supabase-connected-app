import { ETAPAS } from "./contratacao";
import {
  buildDocumentVariableValues,
  isKnownDocumentVariable,
  renderDocumentTemplate,
  type DocumentVariableContext,
} from "./document-variables";

export const TEMPLATE_AVAILABILITY_SCOPES = [
  {
    id: "processos",
    label: "Fluxo de Processos",
    description: "Exibe o modelo dentro dos processos de contratação (por etapa) e ao vincular um processo.",
  },
  {
    id: "contratos",
    label: "Contratos e Atas",
    description: "Disponível para aditivos, apostilamentos, notificações e documentos de contratos/ARPs.",
  },
  {
    id: "fornecedores",
    label: "Fornecedores / Habilitação",
    description: "Disponível ao emitir ofícios, notificações ou solicitações vinculadas a fornecedores.",
  },
  {
    id: "avulso",
    label: "Documentos Avulsos (GED)",
    description: "Permite gerar o documento livremente no módulo de Documentos sem vínculo obrigatório.",
  },
] as const;

export type TemplateAvailabilityScope = (typeof TEMPLATE_AVAILABILITY_SCOPES)[number]["id"];

export const TEMPLATE_SCOPE_IDS = new Set<string>(TEMPLATE_AVAILABILITY_SCOPES.map((s) => s.id));
export const PROCESS_STAGE_IDS = new Set<string>(ETAPAS.map((e) => e.id));

export const TEMPLATE_CATEGORY_OPTIONS = [
  { value: "dfd", label: "DFD" },
  { value: "etp", label: "ETP" },
  { value: "risk_analysis", label: "Análise de riscos" },
  { value: "risk_matrix", label: "Matriz contratual de riscos" },
  { value: "tr", label: "Termo de Referência" },
  { value: "edital", label: "Edital / Aviso de Contratação" },
  { value: "parecer_juridico", label: "Parecer Jurídico / Controle Interno" },
  { value: "contrato", label: "Minuta de Contrato / Ata" },
  { value: "term_addendum_renewal", label: "Termo aditivo de prorrogação" },
  { value: "notificacao", label: "Ofício / Notificação" },
  { value: "despacho", label: "Despacho / Autorização" },
  { value: "custom", label: "Outro documento" },
] as const;

export const ROTULOS_CATEGORIA_MODELO: Record<string, string> = Object.fromEntries(
  TEMPLATE_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
);

export const ROTULOS_ESCOPO_MODELO: Record<string, string> = Object.fromEntries(
  TEMPLATE_AVAILABILITY_SCOPES.map((scope) => [scope.id, scope.label]),
);

export const ROTULOS_ETAPA_MODELO: Record<string, string> = Object.fromEntries(
  ETAPAS.map((etapa) => [etapa.id, etapa.nome]),
);

export function defaultTemplateScopeConfig(templateType: string): {
  availability_scopes: TemplateAvailabilityScope[];
  process_stages: string[];
} {
  switch (templateType) {
    case "dfd":
      return { availability_scopes: ["processos", "avulso"], process_stages: ["planejamento"] };
    case "etp":
    case "risk_analysis":
      return { availability_scopes: ["processos", "avulso"], process_stages: ["estudos"] };
    case "tr":
    case "risk_matrix":
      return { availability_scopes: ["processos", "avulso"], process_stages: ["objeto"] };
    case "parecer_juridico":
      return { availability_scopes: ["processos", "contratos"], process_stages: ["parecer"] };
    case "edital":
      return { availability_scopes: ["processos"], process_stages: ["publicacao"] };
    case "contrato":
      return {
        availability_scopes: ["processos", "contratos"],
        process_stages: ["assinatura"],
      };
    case "term_addendum_renewal":
      return { availability_scopes: ["contratos"], process_stages: [] };
    case "notificacao":
      return {
        availability_scopes: ["fornecedores", "contratos", "avulso"],
        process_stages: ["fiscalizacao"],
      };
    case "despacho":
      return {
        availability_scopes: ["processos", "contratos", "avulso"],
        process_stages: ["conclusao", "julgamento"],
      };
    default:
      return {
        availability_scopes: ["processos", "contratos", "fornecedores", "avulso"],
        process_stages: [],
      };
  }
}

export function sanitizeAvailabilityScopes(
  raw: readonly string[] | null | undefined,
  fallbackType = "custom",
): TemplateAvailabilityScope[] {
  const valid = (raw ?? []).filter((item): item is TemplateAvailabilityScope =>
    TEMPLATE_SCOPE_IDS.has(item),
  );
  if (valid.length > 0) return Array.from(new Set(valid));
  return defaultTemplateScopeConfig(fallbackType).availability_scopes;
}

export function sanitizeProcessStages(raw: readonly string[] | null | undefined): string[] {
  const valid = (raw ?? []).filter((item) => PROCESS_STAGE_IDS.has(item));
  return Array.from(new Set(valid));
}

export interface TemplateFilterable {
  id: string;
  title: string;
  description?: string | null;
  content: string;
  template_type: string;
  legal_basis?: string | null;
  is_active: boolean;
  availability_scopes?: readonly string[] | null;
  process_stages?: readonly string[] | null;
}

export function filterAndSortTemplatesForContext<T extends TemplateFilterable>(
  templates: readonly T[],
  options: {
    scope?: TemplateAvailabilityScope | "todos" | null;
    processStage?: string | null;
    category?: string | null;
    status?: "active" | "inactive" | "all";
    search?: string;
    includeOutOfScope?: boolean;
  },
): Array<T & { recommendedForStage: boolean; scopesResolved: TemplateAvailabilityScope[] }> {
  const status = options.status ?? "active";
  const normalizedSearch = (options.search ?? "").trim().toLocaleLowerCase("pt-BR");
  const targetScope = options.scope && options.scope !== "todos" ? options.scope : null;

  type Entry = {
    template: T;
    matchesScope: boolean;
    recommendedForStage: boolean;
    scopesResolved: TemplateAvailabilityScope[];
  };

  const entries: Entry[] = [];
  for (const template of templates) {
    if (status === "active" && !template.is_active) continue;
    if (status === "inactive" && template.is_active) continue;
    if (options.category && options.category !== "todas" && template.template_type !== options.category) {
      continue;
    }
    if (normalizedSearch) {
      const haystack = [
        template.title,
        template.description ?? "",
        template.legal_basis ?? "",
        ROTULOS_CATEGORIA_MODELO[template.template_type] ?? template.template_type,
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      if (!haystack.includes(normalizedSearch)) continue;
    }

    const scopesResolved = sanitizeAvailabilityScopes(
      template.availability_scopes,
      template.template_type,
    );
    const stagesResolved = sanitizeProcessStages(template.process_stages);
    const matchesScope = !targetScope || scopesResolved.includes(targetScope);
    if (!options.includeOutOfScope && !matchesScope) continue;

    const recommendedForStage =
      Boolean(options.processStage) &&
      scopesResolved.includes("processos") &&
      stagesResolved.includes(options.processStage!);

    entries.push({
      template,
      matchesScope,
      recommendedForStage,
      scopesResolved,
    });
  }

  entries.sort((a, b) => {
    if (a.recommendedForStage !== b.recommendedForStage) {
      return a.recommendedForStage ? -1 : 1;
    }
    if (a.matchesScope !== b.matchesScope) {
      return a.matchesScope ? -1 : 1;
    }
    return a.template.title.localeCompare(b.template.title, "pt-BR");
  });

  return entries.map((entry) => ({
    ...entry.template,
    recommendedForStage: entry.recommendedForStage,
    scopesResolved: entry.scopesResolved,
  }));
}

export function extractTemplatePlaceholders(content: string): {
  all: string[];
  automatic: string[];
  manualOrCustom: string[];
} {
  const matches = content.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? [];
  const all = Array.from(
    new Set(matches.map((token) => token.replace(/\{\{|\}\}/g, "").trim().toLowerCase())),
  );
  const automatic: string[] = [];
  const manualOrCustom: string[] = [];

  for (const key of all) {
    if (isKnownDocumentVariable(key) && !key.startsWith("fundamento_") && !key.startsWith("analise_")) {
      automatic.push(key);
    } else {
      manualOrCustom.push(key);
    }
  }

  return { all, automatic, manualOrCustom };
}

export function buildSamplePreviewContext(params: {
  tenantName?: string | null;
  municipality?: string | null;
  state?: string | null;
  cnpj?: string | null;
  ibgeCode?: string | null;
  userEmail?: string | null;
  overrideContext?: Partial<Pick<DocumentVariableContext, "process" | "contract" | "supplier">>;
}): DocumentVariableContext {
  return {
    organization: {
      name: params.tenantName?.trim() || "Secretaria Municipal de Saúde (Exemplo)",
      municipality: params.municipality?.trim() || "Município Exemplo",
      state: params.state?.trim() || "SP",
      cnpj: params.cnpj?.trim() || "12.345.678/0001-99",
      ibgeCode: params.ibgeCode?.trim() || "3550308",
    },
    user: {
      name: "Servidor Responsável (Exemplo)",
      email: params.userEmail?.trim() || "servidor@saude.gov.br",
    },
    supplier:
      params.overrideContext?.supplier !== undefined
        ? params.overrideContext.supplier
        : {
            legalName: "Distribuidora Hospitalar Exemplo Ltda.",
            tradeName: "MedExemplo Saúde",
            cnpj: "98.765.432/0001-10",
            email: "contato@medexemplo.com.br",
            phone: "(11) 3333-4444",
          },
    process:
      params.overrideContext?.process !== undefined
        ? params.overrideContext.process
        : {
            number: "PA-042/2026",
            title: "Aquisição de medicamentos básicos e insumos ambulatoriais para UBS",
            description:
              "Necessidade contínua de abastecimento da rede de atenção básica conforme programação anual.",
            modality: "pregao",
            stage: "planejamento",
            status: "em_andamento",
            priority: "alta",
            requestingUnit: "Coordenação de Assistência Farmacêutica",
            responsibleName: "Dra. Maria Clara Silva",
            estimatedValue: 185400,
            dueDate: "2026-12-20",
          },
    contract:
      params.overrideContext?.contract !== undefined
        ? params.overrideContext.contract
        : {
            number: "CT-015/2026",
            object: "Fornecimento parcelado de insumos hospitalares para unidades de saúde",
            modality: "pregao",
            totalValue: 120000,
            startDate: "2026-01-15",
            endDate: "2027-01-14",
            managerName: "Carlos Eduardo Souza",
            inspectorName: "Ana Paula Ferreira",
            ordinance: "Portaria SMS nº 18/2026",
          },
  };
}

export function renderTemplateSamplePreview(params: {
  content: string;
  context: DocumentVariableContext;
  manualSampleValues?: Record<string, string>;
}) {
  const autoValues = buildDocumentVariableValues(params.context);
  const sampleManualDefaults: Record<string, string> = {
    quantitativos: "Item 01 — Dipirona 500mg (10.000 comprimidos)\nItem 02 — Gaze estéril 7,5x7,5cm (2.500 pacotes)",
    tabela_itens: "Item 01 | Dipirona 500mg | 10.000 un | R$ 0,25 | R$ 2.500,00",
    levantamento_mercado: "Pesquisa realizada no Painel de Preços e 3 cotações diretas com fornecedores regionais.",
    metodo_estimativa: "Mediana dos preços válidos coletados (IN SEGES nº 65/2021).",
    dotacao_orcamentaria: "Dotação: 10.301.0012.2045 · Elemento 3.3.90.30 · Fonte 1.600",
    fundamento_prorrogacao: "Art. 107 da Lei nº 14.133/2021 e Cláusula Quarta do instrumento contratual.",
    prazo_prorrogacao: "12 meses",
    nova_vigencia_fim: "14/01/2028",
    valor_periodo_prorrogado: "R$ 120.000,00",
    local_data_assinatura: `${params.context.organization.municipality || "Município"}/${params.context.organization.state || "UF"}, ${autoValues["data"] ?? ""}`,
  };
  const values = {
    ...sampleManualDefaults,
    ...autoValues,
    ...(params.manualSampleValues ?? {}),
  };
  return renderDocumentTemplate(params.content, values);
}
