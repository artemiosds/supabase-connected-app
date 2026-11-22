export const AI_FEATURES = [
  {
    key: "assistant",
    label: "Assistente operacional",
    description: "Ajuda contextual e orientação sobre o uso do Primus.",
  },
  {
    key: "documents",
    label: "Documentos preparatórios",
    description: "Rascunhos de DFD, ETP, TR, mapas de risco e minutas.",
  },
  {
    key: "price_research",
    label: "Pesquisa de preços",
    description: "Apoio à comparação de referências e análise da cesta.",
  },
  {
    key: "supplier_documents",
    label: "Certidões de fornecedores",
    description: "Análise orientativa dos metadados cadastrados; não lê arquivos privados.",
  },
  {
    key: "contract_monitoring",
    label: "Contratos e renovações",
    description: "Acompanhamento de vigência, reajustes, saldo e providências.",
  },
  {
    key: "delivery_receiving",
    label: "Entregas e fiscalização",
    description: "Apoio ao confronto entre ordens, recebimentos e ocorrências.",
  },
  {
    key: "tasks",
    label: "Tarefas e pendências",
    description: "Resumo e priorização de trabalho operacional autorizado.",
  },
  {
    key: "email_alerts",
    label: "E-mails operacionais",
    description: "Preparação de alertas e comunicações para revisão.",
  },
] as const;

export type AiFeatureKey = (typeof AI_FEATURES)[number]["key"];
export type AiFeatureSettings = Record<AiFeatureKey, boolean>;

export const EMPTY_AI_FEATURES: AiFeatureSettings = {
  assistant: false,
  documents: false,
  price_research: false,
  supplier_documents: false,
  contract_monitoring: false,
  delivery_receiving: false,
  tasks: false,
  email_alerts: false,
};

export function parseAiFeatureSettings(value: unknown): AiFeatureSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_AI_FEATURES };
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    AI_FEATURES.map(({ key }) => [key, source[key] === true]),
  ) as AiFeatureSettings;
}

export function isAiFeatureKey(value: unknown): value is AiFeatureKey {
  return AI_FEATURES.some((feature) => feature.key === value);
}
