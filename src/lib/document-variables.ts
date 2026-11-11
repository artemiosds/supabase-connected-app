export type DocumentVariableSource =
  | "organization"
  | "supplier"
  | "process"
  | "contract"
  | "session"
  | "process.items"
  | "process.quotes"
  | "process.budget"
  | "manual";

export type DocumentVariableDefinition = {
  key: string;
  label: string;
  source: DocumentVariableSource;
};

export type DocumentTemplateSchemaEntry = {
  key: string;
  label: string;
  required: boolean;
  source?: DocumentVariableSource;
};

export type DocumentVariableContext = {
  organization: {
    name: string | null;
    municipality: string | null;
    state: string | null;
    cnpj: string | null;
    ibgeCode: string | null;
  };
  user: {
    name: string | null;
    email: string | null;
  };
  supplier: {
    legalName: string | null;
    tradeName: string | null;
    cnpj: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  process: {
    number: string | null;
    title: string | null;
    description: string | null;
    modality: string | null;
    stage: string | null;
    status: string | null;
    priority: string | null;
    requestingUnit: string | null;
    responsibleName: string | null;
    estimatedValue: number | null;
    dueDate: string | null;
  } | null;
  contract: {
    number: string | null;
    object: string | null;
    modality: string | null;
    totalValue: number | null;
    startDate: string | null;
    endDate: string | null;
    managerName: string | null;
    inspectorName: string | null;
    ordinance: string | null;
  } | null;
};

export const DOCUMENT_TEMPLATE_VARIABLES: readonly DocumentVariableDefinition[] = [
  { key: "secretaria", label: "Nome da Secretaria", source: "organization" },
  { key: "municipio", label: "Município", source: "organization" },
  { key: "uf", label: "Unidade federativa", source: "organization" },
  { key: "cnpj_secretaria", label: "CNPJ da Secretaria", source: "organization" },
  { key: "codigo_ibge", label: "Código IBGE do município", source: "organization" },
  { key: "fornecedor", label: "Razão social do fornecedor", source: "supplier" },
  { key: "nome_fantasia", label: "Nome fantasia do fornecedor", source: "supplier" },
  { key: "cnpj", label: "CNPJ do fornecedor", source: "supplier" },
  { key: "fornecedor_email", label: "E-mail do fornecedor", source: "supplier" },
  { key: "fornecedor_telefone", label: "Telefone do fornecedor", source: "supplier" },
  { key: "numero_processo", label: "Número do processo", source: "process" },
  { key: "objeto", label: "Objeto do processo ou contrato", source: "process" },
  { key: "objeto_contrato", label: "Objeto do contrato", source: "contract" },
  { key: "justificativa", label: "Justificativa do processo", source: "process" },
  { key: "modalidade", label: "Modalidade", source: "process" },
  { key: "etapa_atual", label: "Etapa atual do processo", source: "process" },
  { key: "situacao_processo", label: "Situação do processo", source: "process" },
  { key: "prioridade", label: "Prioridade do processo", source: "process" },
  { key: "unidade_requisitante", label: "Unidade requisitante", source: "process" },
  { key: "responsavel", label: "Responsável pelo processo", source: "process" },
  { key: "valor_estimado", label: "Valor estimado", source: "process" },
  { key: "prazo_desejado", label: "Prazo desejado", source: "process" },
  { key: "numero_contrato", label: "Número do contrato", source: "contract" },
  { key: "valor_contrato", label: "Valor total do contrato", source: "contract" },
  { key: "data_inicio", label: "Início da vigência", source: "contract" },
  { key: "data_fim", label: "Fim da vigência", source: "contract" },
  { key: "gestor", label: "Gestor do contrato", source: "contract" },
  { key: "gestor_nome", label: "Nome do gestor do contrato", source: "contract" },
  { key: "gestor_contrato", label: "Gestor do contrato", source: "contract" },
  { key: "fiscal", label: "Fiscal do contrato", source: "contract" },
  { key: "fiscal_nome", label: "Nome do fiscal do contrato", source: "contract" },
  { key: "fiscal_contrato", label: "Fiscal do contrato", source: "contract" },
  { key: "portaria_fiscal", label: "Portaria de designação do fiscal", source: "contract" },
  {
    key: "quantitativos",
    label: "Itens, quantidades e memória de cálculo",
    source: "process.items",
  },
  {
    key: "tabela_itens",
    label: "Tabela de itens do processo",
    source: "process.items",
  },
  {
    key: "levantamento_mercado",
    label: "Levantamento de mercado e cotações",
    source: "process.quotes",
  },
  { key: "metodo_estimativa", label: "Método da estimativa", source: "process.quotes" },
  { key: "dotacao_orcamentaria", label: "Dotação orçamentária", source: "process.budget" },
  { key: "data", label: "Data de geração", source: "session" },
  { key: "data_geracao", label: "Data de geração", source: "session" },
  { key: "usuario", label: "Usuário responsável", source: "session" },
  { key: "usuario_email", label: "E-mail do usuário", source: "session" },
] as const;

const VARIABLES_BY_KEY = new Map(
  DOCUMENT_TEMPLATE_VARIABLES.map((variable) => [variable.key, variable]),
);

function textOrEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function formatarData(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return match[3] + "/" + match[2] + "/" + match[1];
  return value;
}

function formatarMoeda(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Human label for a catalog placeholder; falls back to the raw key. */
export function documentVariableLabel(key: string): string {
  return VARIABLES_BY_KEY.get(key.toLowerCase())?.label ?? key;
}

export function isKnownDocumentVariable(key: string): boolean {
  return VARIABLES_BY_KEY.has(key.toLowerCase());
}

export function buildDocumentVariableValues(
  context: DocumentVariableContext,
  generatedAt: Date = new Date(),
): Record<string, string> {
  const generatedDate = new Intl.DateTimeFormat("pt-BR").format(generatedAt);
  const process = context.process;
  const contract = context.contract;
  const supplier = context.supplier;
  const processValue = process?.estimatedValue ?? null;
  const contractValue = contract?.totalValue ?? null;

  return {
    secretaria: textOrEmpty(context.organization.name),
    municipio: textOrEmpty(context.organization.municipality),
    uf: textOrEmpty(context.organization.state),
    cnpj_secretaria: textOrEmpty(context.organization.cnpj),
    codigo_ibge: textOrEmpty(context.organization.ibgeCode),
    fornecedor: textOrEmpty(supplier?.legalName),
    nome_fantasia: textOrEmpty(supplier?.tradeName),
    cnpj: textOrEmpty(supplier?.cnpj),
    fornecedor_email: textOrEmpty(supplier?.email),
    fornecedor_telefone: textOrEmpty(supplier?.phone),
    numero_processo: textOrEmpty(process?.number),
    objeto: textOrEmpty(contract?.object ?? process?.title),
    objeto_contrato: textOrEmpty(contract?.object),
    justificativa: textOrEmpty(process?.description),
    modalidade: textOrEmpty(contract?.modality ?? process?.modality),
    etapa_atual: textOrEmpty(process?.stage),
    situacao_processo: textOrEmpty(process?.status),
    prioridade: textOrEmpty(process?.priority),
    unidade_requisitante: textOrEmpty(process?.requestingUnit),
    responsavel: textOrEmpty(process?.responsibleName),
    valor_estimado: formatarMoeda(processValue),
    prazo_desejado: formatarData(process?.dueDate),
    numero_contrato: textOrEmpty(contract?.number),
    valor_contrato: formatarMoeda(contractValue),
    data_inicio: formatarData(contract?.startDate),
    data_fim: formatarData(contract?.endDate),
    gestor: textOrEmpty(contract?.managerName),
    gestor_nome: textOrEmpty(contract?.managerName),
    gestor_contrato: textOrEmpty(contract?.managerName),
    fiscal: textOrEmpty(contract?.inspectorName),
    fiscal_nome: textOrEmpty(contract?.inspectorName),
    fiscal_contrato: textOrEmpty(contract?.inspectorName),
    portaria_fiscal: textOrEmpty(contract?.ordinance),
    quantitativos: "",
    levantamento_mercado: "",
    metodo_estimativa: "",
    dotacao_orcamentaria: "",
    data: generatedDate,
    data_geracao: generatedDate,
    usuario: textOrEmpty(context.user.name) || textOrEmpty(context.user.email),
    usuario_email: textOrEmpty(context.user.email),
  };
}

export function extractDocumentTemplateVariables(content: string): string[] {
  const keys = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  for (const match of content.matchAll(pattern)) {
    const key = match[1]?.toLowerCase();
    if (key) keys.add(key);
  }
  return [...keys];
}

export function buildDocumentTemplateSchema(
  content: string,
  existingSchema: unknown,
): DocumentTemplateSchemaEntry[] {
  const existingEntries = Array.isArray(existingSchema) ? existingSchema : [];
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const candidate of existingEntries) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    if (typeof entry["key"] === "string") existingByKey.set(entry["key"].toLowerCase(), entry);
  }

  return extractDocumentTemplateVariables(content).map((key) => {
    const existing = existingByKey.get(key);
    const definition = VARIABLES_BY_KEY.get(key);
    const label =
      typeof existing?.["label"] === "string" && existing["label"].trim()
        ? existing["label"].trim()
        : (definition?.label ?? key);
    const required = typeof existing?.["required"] === "boolean" ? existing["required"] : true;
    const source =
      typeof existing?.["source"] === "string"
        ? (existing["source"] as DocumentVariableSource)
        : (definition?.source ?? "manual");
    return { key, label, required, source };
  });
}

export function renderDocumentTemplate(
  content: string,
  values: Record<string, string>,
): { content: string; missingKeys: string[]; unknownKeys: string[] } {
  const missingKeys = new Set<string>();
  const unknownKeys = new Set<string>();
  const rendered = content.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_placeholder, rawKey: string) => {
      const key = rawKey.toLowerCase();
      if (!VARIABLES_BY_KEY.has(key)) {
        unknownKeys.add(key);
        return "[CAMPO NÃO CONFIGURADO: " + key + "]";
      }
      const value = values[key]?.trim();
      if (!value) {
        missingKeys.add(key);
        return "[PREENCHER: " + (VARIABLES_BY_KEY.get(key)?.label ?? key) + "]";
      }
      return value;
    },
  );
  return {
    content: rendered,
    missingKeys: [...missingKeys],
    unknownKeys: [...unknownKeys],
  };
}
