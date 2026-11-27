import { ETAPAS, MODALIDADES, type EtapaId } from "@/lib/contratacao";
import { LIMITES_LEI_14133 } from "@/lib/tenant-settings-helpers";

export type ModalidadeId = keyof typeof MODALIDADES;

export interface ItemChecklistEtapa {
  id?: string;
  stage: EtapaId;
  title: string;
  is_done: boolean;
  responsible_user_id?: string | null;
}

export interface ProcessoTransicao {
  id: string;
  stage: EtapaId;
  modality: ModalidadeId;
  estimated_value: number | null;
  responsible_name: string | null;
  responsible_user_id?: string | null;
  due_date: string | null;
  status?: string;
}

export interface ContextoValidacaoExtra {
  totalDotacoes?: number | undefined;
  itensSemPrecoAprovado?: number | undefined;
}

export interface ResultadoValidacaoTransicao {
  podeAvancar: boolean;
  pendenciasBloqueantes: string[];
  avisos: string[];
  etapaAtualNome: string;
  etapaDestinoNome: string;
  itensPendentesEtapaAtual: string[];
}

export interface StatusEtapaStepper {
  id: EtapaId;
  nome: string;
  estado: "concluida" | "atual" | "pendente";
}

export interface ProgressoFluxoProcesso {
  etapaAtualNumero: number;
  totalEtapas: number;
  percentualFluxo: number;
  etapaAtualConcluidos: number;
  etapaAtualTotal: number;
  percentualEtapaAtual: number;
  percentualChecklistGeral: number;
  etapasStatus: StatusEtapaStepper[];
}

const ETAPAS_POS_PESQUISA = new Set<EtapaId>([
  "parecer",
  "conclusao",
  "publicacao",
  "julgamento",
  "assinatura",
  "fiscalizacao",
]);

const ETAPAS_POS_PARECER = new Set<EtapaId>([
  "conclusao",
  "publicacao",
  "julgamento",
  "assinatura",
  "fiscalizacao",
]);

/**
 * Calcula o progresso dual do processo: avanço macro no fluxo (10 etapas)
 * e completude do checklist da etapa atual + checklist geral.
 */
export function calcularProgressoFluxoProcesso(
  stage: EtapaId,
  itensChecklist: readonly ItemChecklistEtapa[],
  status?: string,
): ProgressoFluxoProcesso {
  const totalEtapas = ETAPAS.length;
  const idxAtual = Math.max(
    0,
    ETAPAS.findIndex((e) => e.id === stage),
  );
  const concluidoGeral = status === "concluido";
  const etapaAtualNumero = idxAtual + 1;
  const percentualFluxo = concluidoGeral
    ? 100
    : Math.round(((idxAtual + 1) / totalEtapas) * 100);

  const itensAtual = itensChecklist.filter((i) => i.stage === stage);
  const etapaAtualTotal = itensAtual.length;
  const etapaAtualConcluidos = itensAtual.filter((i) => i.is_done).length;
  const percentualEtapaAtual =
    etapaAtualTotal > 0
      ? Math.round((etapaAtualConcluidos / etapaAtualTotal) * 100)
      : concluidoGeral
        ? 100
        : 0;

  const totalGeral = itensChecklist.length;
  const concluidosGeral = itensChecklist.filter((i) => i.is_done).length;
  const percentualChecklistGeral =
    totalGeral > 0 ? Math.round((concluidosGeral / totalGeral) * 100) : 0;

  const etapasStatus: StatusEtapaStepper[] = ETAPAS.map((e, idx) => {
    if (concluidoGeral || idx < idxAtual) {
      return { id: e.id, nome: e.nome, estado: "concluida" };
    }
    if (idx === idxAtual) {
      return { id: e.id, nome: e.nome, estado: "atual" };
    }
    return { id: e.id, nome: e.nome, estado: "pendente" };
  });

  return {
    etapaAtualNumero,
    totalEtapas,
    percentualFluxo,
    etapaAtualConcluidos,
    etapaAtualTotal,
    percentualEtapaAtual,
    percentualChecklistGeral,
    etapasStatus,
  };
}

/**
 * Mapeia o tipo de documento gerado/anexado no processo para a etapa
 * correspondente do checklist da contratação.
 */
export function mapearDocumentoParaEtapaChecklist(docType: string): EtapaId | null {
  const norm = docType.trim().toLowerCase();
  if (!norm) return null;

  if (norm === "dfd" || norm.includes("formalizacao_demanda")) return "planejamento";
  if (norm === "etp" || norm.includes("estudo_tecnico")) return "estudos";
  if (norm === "tr" || norm === "pb" || norm.includes("termo_referencia")) return "objeto";
  if (norm.includes("pesquisa") || norm.includes("mapa_precos") || norm.includes("cotacao")) {
    return "pesquisa";
  }
  if (norm.includes("parecer") || norm.includes("juridico")) return "parecer";
  if (norm.includes("edital") || norm.includes("aviso") || norm.includes("pncp")) {
    return "publicacao";
  }
  if (
    norm.includes("julgamento") ||
    norm.includes("habilitacao") ||
    norm.includes("adjudicacao") ||
    norm.includes("homologacao")
  ) {
    return "julgamento";
  }
  if (
    norm === "contrato" ||
    norm === "ata" ||
    norm.includes("ata_registro") ||
    norm.includes("ordem_fornecimento")
  ) {
    return "assinatura";
  }
  if (norm.includes("fiscal") || norm.includes("recebimento")) return "fiscalizacao";
  return null;
}

/**
 * Valida regras de governança e conformidade da Lei nº 14.133/2021 antes de
 * avançar o processo para a etapa seguinte.
 */
export function validarTransicaoEtapa(
  processo: ProcessoTransicao,
  itensChecklist: readonly ItemChecklistEtapa[],
  totalItensProcesso = 0,
  contextoExtra?: ContextoValidacaoExtra,
): ResultadoValidacaoTransicao {
  const idxAtual = ETAPAS.findIndex((e) => e.id === processo.stage);
  const etapaAtual = ETAPAS[idxAtual];
  const etapaDestino = idxAtual >= 0 ? ETAPAS[idxAtual + 1] : undefined;

  const etapaAtualNome = etapaAtual?.nome ?? processo.stage;
  const etapaDestinoNome = etapaDestino?.nome ?? "Próxima etapa";

  const pendenciasBloqueantes: string[] = [];
  const avisos: string[] = [];

  const itensAtual = itensChecklist.filter((i) => i.stage === processo.stage);
  const itensPendentesEtapaAtual = itensAtual
    .filter((i) => !i.is_done)
    .map((i) => i.title);

  if (itensPendentesEtapaAtual.length > 0) {
    pendenciasBloqueantes.push(
      `Conclua os ${itensPendentesEtapaAtual.length} item(ns) pendente(s) da etapa "${etapaAtualNome}" antes de avançar.`,
    );
  }

  if (
    processo.stage === "objeto" &&
    totalItensProcesso === 0
  ) {
    pendenciasBloqueantes.push(
      "Cadastre ao menos 1 item/lote no objeto da contratação antes de avançar para a pesquisa de preços.",
    );
  }

  if (
    processo.stage === "pesquisa" &&
    (processo.estimated_value === null || processo.estimated_value <= 0)
  ) {
    pendenciasBloqueantes.push(
      "Informe ou consolide o valor estimado da contratação antes de enviar para o parecer jurídico.",
    );
  }

  if (!processo.responsible_name?.trim()) {
    avisos.push("Defina o(a) responsável pela próxima etapa para garantir rastreabilidade.");
  }

  if (!processo.due_date) {
    avisos.push("Nenhum prazo definido para a entrega da próxima etapa.");
  }

  // Regras materiais da Lei 14.133/2021 e Decreto 12.343/2024
  if (
    processo.modality === "dispensa" &&
    typeof processo.estimated_value === "number" &&
    processo.estimated_value > 0
  ) {
    if (processo.estimated_value > LIMITES_LEI_14133.dispensaObrasEngenharia) {
      avisos.push(
        `Valor estimado (R$ ${processo.estimated_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) supera o teto geral de dispensa para obras/engenharia (R$ ${LIMITES_LEI_14133.dispensaObrasEngenharia.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} — Decreto nº 12.343/2024). Verifique enquadramento legal.`,
      );
    } else if (processo.estimated_value > LIMITES_LEI_14133.dispensaComprasServicos) {
      avisos.push(
        `Valor estimado supera o teto de dispensa para compras e serviços comuns (R$ ${LIMITES_LEI_14133.dispensaComprasServicos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} — Decreto nº 12.343/2024). Aplicável apenas a obras/engenharia ou manutenção de veículos.`,
      );
    }
  }

  const destinoId = etapaDestino?.id;
  if (
    destinoId &&
    ETAPAS_POS_PESQUISA.has(destinoId) &&
    typeof contextoExtra?.itensSemPrecoAprovado === "number" &&
    contextoExtra.itensSemPrecoAprovado > 0
  ) {
    avisos.push(
      `Há ${contextoExtra.itensSemPrecoAprovado} item(ns) sem preço referencial aprovado na matriz de pesquisa.`,
    );
  }

  if (
    destinoId &&
    ETAPAS_POS_PARECER.has(destinoId) &&
    typeof contextoExtra?.totalDotacoes === "number" &&
    contextoExtra.totalDotacoes === 0
  ) {
    avisos.push(
      "Nenhuma dotação orçamentária vinculada ao processo. Recomenda-se registrar a reserva orçamentária antes da publicação/contratação.",
    );
  }

  return {
    podeAvancar: pendenciasBloqueantes.length === 0,
    pendenciasBloqueantes,
    avisos,
    etapaAtualNome,
    etapaDestinoNome,
    itensPendentesEtapaAtual,
  };
}
