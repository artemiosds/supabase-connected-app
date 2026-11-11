export const DIAS_PROCESSO_PARADO = 8;
const MILISSEGUNDOS_POR_DIA = 86_400_000;

export type ProcessoParaAlertaDeParalisacao = {
  id: string;
  number: string;
  title: string;
  stage: string;
  status: string;
  responsible_name: string | null;
  updated_at: string;
};

export type AtividadeProcesso = {
  process_id: string;
  updated_at: string;
};

export type ProcessoParado = {
  id: string;
  number: string;
  title: string;
  stage: string;
  responsible_name: string | null;
  diasSemAtividade: number;
  ultimaAtividade: string;
};

export function listarProcessosParados(
  processos: ProcessoParaAlertaDeParalisacao[],
  atividades: AtividadeProcesso[],
  agora = new Date(),
  limiteDias = DIAS_PROCESSO_PARADO,
): ProcessoParado[] {
  const ultimaAtividadePorProcesso = new Map<string, number>();

  for (const atividade of atividades) {
    const instante = Date.parse(atividade.updated_at);
    if (!Number.isFinite(instante)) continue;
    const anterior =
      ultimaAtividadePorProcesso.get(atividade.process_id) ?? Number.NEGATIVE_INFINITY;
    if (instante > anterior) ultimaAtividadePorProcesso.set(atividade.process_id, instante);
  }

  return processos
    .flatMap((processo) => {
      if (processo.status === "concluido" || processo.status === "arquivado") return [];
      const atualizadoEm = Date.parse(processo.updated_at);
      if (!Number.isFinite(atualizadoEm)) return [];
      const ultimoInstante = Math.max(
        atualizadoEm,
        ultimaAtividadePorProcesso.get(processo.id) ?? Number.NEGATIVE_INFINITY,
      );
      const diasSemAtividade = Math.floor(
        (agora.getTime() - ultimoInstante) / MILISSEGUNDOS_POR_DIA,
      );
      if (diasSemAtividade <= limiteDias) return [];
      return [
        {
          id: processo.id,
          number: processo.number,
          title: processo.title,
          stage: processo.stage,
          responsible_name: processo.responsible_name,
          diasSemAtividade,
          ultimaAtividade: new Date(ultimoInstante).toISOString(),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.diasSemAtividade - a.diasSemAtividade || a.number.localeCompare(b.number, "pt-BR"),
    );
}
