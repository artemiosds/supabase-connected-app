// =============================================================================
// process-stage-transition-helper.ts — Conformidade e Transição de Etapas
// Primus Gestão — Lei nº 14.133/2021 — Fase 2
// =============================================================================

import {
  ETAPAS,
  proximaEtapa,
  type EtapaId,
} from "@/lib/contratacao";

export interface ItemChecklistEtapa {
  id: string;
  stage: string;
  title: string;
  is_done: boolean;
}

export interface ProcessoTransicao {
  id: string;
  stage: EtapaId;
  estimated_value: number | null;
  responsible_name: string | null;
  due_date: string | null;
  total_itens_cadastrados?: number;
}

export interface ResultadoValidacaoTransicao {
  etapaAtual: EtapaId;
  etapaAtualNome: string;
  proximaEtapa: EtapaId | null;
  proximaEtapaNome: string | null;
  podeAvancar: boolean;
  bloqueios: string[];
  avisos: string[];
  itensObrigatorios: { titulo: string; concluido: boolean }[];
}

export function validarTransicaoEtapa(
  processo: ProcessoTransicao,
  itensChecklist: ItemChecklistEtapa[],
  totalItensProcesso: number = 0
): ResultadoValidacaoTransicao {
  const proxima = proximaEtapa(processo.stage);
  const etapaAtualObj = ETAPAS.find((e) => e.id === processo.stage);
  const proximaObj = proxima ? ETAPAS.find((e) => e.id === proxima) : null;

  const etapaAtualNome = etapaAtualObj?.nome ?? processo.stage;
  const proximaEtapaNome = proximaObj?.nome ?? null;

  if (!proxima) {
    return {
      etapaAtual: processo.stage,
      etapaAtualNome,
      proximaEtapa: null,
      proximaEtapaNome: null,
      podeAvancar: false,
      bloqueios: ["O processo já se encontra na última etapa do fluxo."],
      avisos: [],
      itensObrigatorios: [],
    };
  }

  // Itens do checklist cadastrados para a etapa atual
  const itensDaEtapa = itensChecklist.filter((i) => i.stage === processo.stage);
  const itensObrigatorios = itensDaEtapa.map((i) => ({
    titulo: i.title,
    concluido: i.is_done,
  }));

  const bloqueios: string[] = [];
  const avisos: string[] = [];

  // 1. Bloqueio por itens pendentes do checklist formal
  const pendentes = itensDaEtapa.filter((i) => !i.is_done);
  if (pendentes.length > 0) {
    bloqueios.push(
      `Existem ${pendentes.length} item(ns) pendente(s) no checklist da etapa "${etapaAtualNome}".`
    );
  }

  // 2. Validações materiais por etapa da Lei 14.133
  // Transição de Termo de Referência (objeto) para Pesquisa de Preços (pesquisa):
  if (processo.stage === "objeto" && totalItensProcesso === 0) {
    bloqueios.push(
      "É obrigatório cadastrar ao menos um item de consumo/serviço no processo antes de iniciar a pesquisa de preços."
    );
  }

  // Transição de Pesquisa de Preços para Parecer Jurídico:
  if (processo.stage === "pesquisa" && (!processo.estimated_value || processo.estimated_value <= 0)) {
    avisos.push(
      "O valor estimado do processo ainda não foi consolidado a partir das cotações."
    );
  }

  return {
    etapaAtual: processo.stage,
    etapaAtualNome,
    proximaEtapa: proxima,
    proximaEtapaNome,
    podeAvancar: bloqueios.length === 0,
    bloqueios,
    avisos,
    itensObrigatorios,
  };
}
