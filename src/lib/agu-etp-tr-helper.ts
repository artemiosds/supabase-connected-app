// =============================================================================
// agu-etp-tr-helper.ts — Assistente AGU Opcional (ETP e Termo de Referência)
// Primus Gestão — Modelos Padronizados AGU · IN SEGES nº 58/2022 e nº 81/2022
// =============================================================================

export type TipoDocumentoAgu = "etp" | "tr";

export interface ContextoAguDocumento {
  tipo: TipoDocumentoAgu;
  objeto: string;
  justificativa?: string | null;
  modalidade?: string | null;
  quantidadeItens?: number;
  valorEstimado?: number | null;
}

export function gerarRoteiroEstruturadoAgu(ctx: ContextoAguDocumento): string {
  const objeto = ctx.objeto.trim() || "[Descrever o objeto da contratação]";
  const justificativa =
    ctx.justificativa?.trim() ||
    "Atendimento à demanda operacional da unidade requisitante, visando à continuidade e eficiência do serviço público.";
  const itensTexto =
    typeof ctx.quantidadeItens === "number" && ctx.quantidadeItens > 0
      ? `${ctx.quantidadeItens} item(ns) especificado(s) na pesquisa de preços`
      : "conforme planilha de itens e quantitativos anexa";

  if (ctx.tipo === "etp") {
    return [
      "## ROTEIRO ORIENTATIVO AGU — ESTUDO TÉCNICO PRELIMINAR (IN SEGES nº 58/2022)",
      "",
      "### 1. Descrição da Necessidade da Contratação (Art. 18, § 1º, I)",
      `Objeto pretendido: ${objeto}.`,
      `Fundamentação: ${justificativa}`,
      "",
      "### 2. Requisitos da Contratação e Critérios de Sustentabilidade (Art. 18, § 1º, III)",
      "- Exigir conformidade com normas técnicas da ABNT/ANVISA/INMETRO aplicáveis ao objeto.",
      "- Priorizar fornecedores que adotem práticas de logística reversa e menor impacto ambiental (Guia Nacional de Contratações Sustentáveis da AGU).",
      "",
      "### 3. Estimativa das Quantidades e Valor da Contratação (Art. 18, § 1º, IV e VI)",
      `Quantitativo apurado com base no histórico de consumo e demanda atual (${itensTexto}).`,
      "",
      "### 4. Justificativa para o Parcelamento ou Não da Solução (Art. 18, § 1º, VIII)",
      "- Regra geral: adjudicação por item visando à ampla competitividade (Súmula nº 247 do TCU), salvo inviabilidade técnica ou perda de economia de escala devidamente motivada.",
      "",
      "### 5. Posicionamento Conclusivo sobre a Viabilidade (Art. 18, § 1º, XIII)",
      "Diante do levantamento de mercado e da disponibilidade orçamentária, declara-se viável e necessária a presente contratação.",
    ].join("\n");
  }

  return [
    "## ROTEIRO ORIENTATIVO AGU — TERMO DE REFERÊNCIA (IN SEGES nº 81/2022)",
    "",
    "### 1. Definição do Objeto e Condições Gerais (Art. 6º, XXIII, 'a')",
    `Constitui objeto deste Termo de Referência: ${objeto} (${itensTexto}).`,
    "",
    "### 2. Fundamentação e Descrição da Necessidade (Art. 6º, XXIII, 'b')",
    justificativa,
    "",
    "### 3. Modelo de Execução do Objeto e Prazos de Entrega (Art. 6º, XXIII, 'e')",
    "- Fornecimento/execução mediante Ordem de Fornecimento (OF) emitida pelo setor competente.",
    "- Recebimento provisório para conferência quantitativa e qualitativo definitivo conforme art. 140 da Lei nº 14.133/2021.",
    "",
    "### 4. Modelo de Gestão e Fiscalização do Contrato (Art. 6º, XXIII, 'f')",
    "- A execução será acompanhada e fiscalizada por fiscal designado em portaria, com registro formal de ocorrências e notificações nos termos do art. 117 da Lei nº 14.133/2021.",
    "",
    "### 5. Critérios de Medição, Pagamento e Reajuste (Art. 6º, XXIII, 'g')",
    "- Pagamento efetuado após liquidação da despesa e atesto da Nota Fiscal, mantidas as condições de regularidade fiscal e trabalhista.",
    "- Reajuste anual permitido após 12 meses da data do orçamento estimado mediante índice oficial (IPCA/INPC).",
  ].join("\n");
}
