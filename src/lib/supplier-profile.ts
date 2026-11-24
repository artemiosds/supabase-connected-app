// =============================================================================
// supplier-profile.ts — Lógica de dados e resumo consolidado da Ficha 360º
// Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores (Entrega 5)
// =============================================================================

import { isSanctionCurrentlyEffective } from "./supplier-sanctions";

export type DocumentoPerfil = { status: string; expires_at: string | null };
export type SancaoPerfil = { status: string; start_date: string; end_date: string | null };
export type InstrumentoPerfil = { instrument_type: string; status: string; end_date: string };

export type HomologacaoPerfil = {
  id?: string;
  status: string;
  conclusion_status: string | null;
  concluded_at: string | null;
  created_at: string;
};

export type RegularidadePerfil = {
  id?: string;
  source: string;
  source_label?: string;
  status: string;
  valid_until: string | null;
  requires_action?: boolean;
};

export type TarefaPerfil = {
  id?: string;
  task_type: string;
  priority: string;
  status: string;
  due_date: string | null;
};

export type StatusConsolidado360 =
  | "apto"
  | "atencao"
  | "inapto"
  | "em_homologacao"
  | "sem_historico";

export function dataLocalIso(data = new Date()): string {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

export function diasAteDataIso(data: string | null, hoje: string): number | null {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const valor = Date.parse(`${data}T00:00:00Z`);
  const referencia = Date.parse(`${hoje}T00:00:00Z`);
  if (!Number.isFinite(valor) || !Number.isFinite(referencia)) return null;
  return Math.round((valor - referencia) / 86_400_000);
}

export type SituacaoDocumentoPerfil =
  | "arquivado"
  | "sem_vencimento"
  | "vencido"
  | "vence_hoje"
  | "a_vencer"
  | "em_dia";

export function situacaoDocumentoPerfil(
  documento: DocumentoPerfil,
  hoje: string,
): SituacaoDocumentoPerfil {
  if (documento.status !== "active") return "arquivado";
  const dias = diasAteDataIso(documento.expires_at, hoje);
  if (dias === null) return "sem_vencimento";
  if (dias < 0) return "vencido";
  if (dias === 0) return "vence_hoje";
  if (dias <= 30) return "a_vencer";
  return "em_dia";
}

/**
 * Calcula o Status Consolidado 360º de Aptidão do Fornecedor.
 * Nível 1 - Copiloto: Consolidação objetiva para subsidiar decisão da autoridade.
 */
export function calcularStatusConsolidado360({
  sancoesVigentes,
  regularidadesIrregulares,
  tarefasCriticas,
  documentosVencidos,
  documentosAVencer,
  tarefasAbertas,
  ultimaHomologacao,
  cadastroAtivo,
}: {
  sancoesVigentes: number;
  regularidadesIrregulares: number;
  tarefasCriticas: number;
  documentosVencidos: number;
  documentosAVencer: number;
  tarefasAbertas: number;
  ultimaHomologacao?: HomologacaoPerfil | null;
  cadastroAtivo?: boolean;
}): StatusConsolidado360 {
  // Se cadastro explicitamente inativo
  if (cadastroAtivo === false) return "inapto";

  // Fatores de inaptidão / impedimento direto
  if (sancoesVigentes > 0 || regularidadesIrregulares > 0 || tarefasCriticas > 0) {
    return "inapto";
  }

  // Em processo de homologação aberto
  if (
    ultimaHomologacao &&
    (ultimaHomologacao.status === "in_review" ||
      ultimaHomologacao.status === "awaiting_completion" ||
      ultimaHomologacao.status === "draft")
  ) {
    return "em_homologacao";
  }

  // Pendências de atenção (documentos vencidos/a vencer ou tarefas pendentes)
  if (documentosVencidos > 0 || documentosAVencer > 0 || tarefasAbertas > 0) {
    return "atencao";
  }

  return "apto";
}

/**
 * Retorna rótulo, descrição e estilos do Badge Consolidado 360º.
 */
export function rotuloStatusConsolidado360(status: StatusConsolidado360): {
  label: string;
  descricao: string;
  variante: "default" | "destructive" | "outline" | "secondary";
  corBadge: string;
} {
  switch (status) {
    case "apto":
      return {
        label: "Apto / Regular",
        descricao: "Fornecedor regular sem sanções vigentes ou certidões impeditivas.",
        variante: "default",
        corBadge: "bg-emerald-600 hover:bg-emerald-700 text-white",
      };
    case "atencao":
      return {
        label: "Atenção / Pendências",
        descricao: "Existem certidões próximas do vencimento ou pendências operacionais ativas.",
        variante: "outline",
        corBadge: "border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30",
      };
    case "inapto":
      return {
        label: "Inapto / Impedimento",
        descricao: "Fornecedor com sanção vigente, certidão irregular ou pendência crítica impeditiva.",
        variante: "destructive",
        corBadge: "bg-destructive text-destructive-foreground",
      };
    case "em_homologacao":
      return {
        label: "Em Homologação",
        descricao: "Processo de homologação ou habilitação cadastral em andamento.",
        variante: "secondary",
        corBadge: "border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30",
      };
    case "sem_historico":
    default:
      return {
        label: "Sem Avaliação",
        descricao: "Aguardando primeiras verificações e análise documental.",
        variante: "outline",
        corBadge: "text-muted-foreground",
      };
  }
}

/**
 * Resumo consolidado da Ficha 360º.
 * Preserva compatibilidade com parâmetros legados e expande com Entregas 1-4.
 */
export function resumirFichaFornecedor(
  documentos: DocumentoPerfil[],
  cotacoes: readonly unknown[],
  instrumentos: InstrumentoPerfil[],
  sancoes: SancaoPerfil[],
  hoje: string,
  homologacoes: HomologacaoPerfil[] = [],
  regularidades: RegularidadePerfil[] = [],
  tarefas: TarefaPerfil[] = [],
  cadastroAtivo = true,
) {
  const documentosAtivos = documentos.filter((d) => d.status === "active").length;
  const vencidos = documentos.filter((d) => situacaoDocumentoPerfil(d, hoje) === "vencido").length;
  const aVencer = documentos.filter((d) =>
    ["vence_hoje", "a_vencer"].includes(situacaoDocumentoPerfil(d, hoje)),
  ).length;

  const contratos = instrumentos.filter((c) => c.instrument_type !== "ata_registro_precos").length;
  const atas = instrumentos.filter((c) => c.instrument_type === "ata_registro_precos").length;
  const vencimentosContratuais = instrumentos.filter((c) => {
    const dias = diasAteDataIso(c.end_date, hoje);
    return c.status === "vigente" && dias !== null && dias >= 0 && dias <= 30;
  }).length;

  const sancoesVigentes = sancoes.filter((s) => isSanctionCurrentlyEffective(s, hoje)).length;

  // Entrega 1: Homologação
  const ultimaHomologacao = homologacoes.length > 0 ? homologacoes[0] : null;

  // Entrega 2: Regularidade oficial
  const regulares = regularidades.filter((r) => r.status === "regular").length;
  const irregulares = regularidades.filter((r) => r.status === "irregular").length;
  const pendentesRegularidade = regularidades.filter((r) => r.status === "pending_review").length;

  // Entrega 4: Fila de Tarefas
  const tarefasAbertas = tarefas.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const tarefasCriticas = tarefas.filter(
    (t) => (t.status === "open" || t.status === "in_progress") && t.priority === "critical",
  ).length;
  const tarefasVencidas = tarefas.filter((t) => {
    if (!t.due_date) return false;
    if (t.status !== "open" && t.status !== "in_progress") return false;
    const dias = diasAteDataIso(t.due_date, hoje);
    return dias !== null && dias < 0;
  }).length;

  // Status Consolidado 360º
  const statusConsolidado360 = calcularStatusConsolidado360({
    sancoesVigentes,
    regularidadesIrregulares: irregulares,
    tarefasCriticas,
    documentosVencidos: vencidos,
    documentosAVencer: aVencer,
    tarefasAbertas,
    ultimaHomologacao,
    cadastroAtivo,
  });

  return {
    documentos: documentosAtivos,
    vencidos,
    aVencer,
    cotacoes: cotacoes.length,
    contratos,
    atas,
    vencimentosContratuais,
    sancoesVigentes,

    // Métricas consolidadas da Fase 2.1
    ultimaHomologacao,
    regularidade: {
      total: regularidades.length,
      regulares,
      irregulares,
      pendentes: pendentesRegularidade,
    },
    tarefas: {
      abertas: tarefasAbertas,
      criticas: tarefasCriticas,
      vencidas: tarefasVencidas,
    },
    statusConsolidado360,
  };
}
