import { diasAteDataIso } from "./supplier-profile";

export type DocumentoMonitorado = {
  supplier_id: string;
  status: string;
  expires_at: string | null;
};

export type SituacaoMonitoramento =
  "vencido" | "vence_hoje" | "a_vencer" | "sem_documentos" | "sem_validade" | "sem_alerta";

export type ResumoDocumentalFornecedor = {
  total: number;
  vencidos: number;
  vencemHoje: number;
  aVencer: number;
  semValidade: number;
  vencimentoMaisProximo: string | null;
  situacao: SituacaoMonitoramento;
};

const PRIORIDADE: Record<SituacaoMonitoramento, number> = {
  vencido: 0,
  vence_hoje: 1,
  a_vencer: 2,
  sem_validade: 3,
  sem_documentos: 4,
  sem_alerta: 5,
};

function resumoVazio(): ResumoDocumentalFornecedor {
  return {
    total: 0,
    vencidos: 0,
    vencemHoje: 0,
    aVencer: 0,
    semValidade: 0,
    vencimentoMaisProximo: null,
    situacao: "sem_documentos",
  };
}

/**
 * Analisa somente documentos ativos e efetivamente visíveis da Secretaria.
 * "Sem alerta" não comprova regularidade fiscal nem a existência de certidões obrigatórias.
 * A ausência de acesso/falha deve ser tratada pelo chamador, nunca como lista vazia.
 */
export function resumirMonitoramentoDocumental(
  fornecedores: readonly { id: string }[],
  documentos: readonly DocumentoMonitorado[],
  hoje: string,
): Map<string, ResumoDocumentalFornecedor> {
  const resumos = new Map(
    fornecedores.map((fornecedor) => [fornecedor.id, resumoVazio()] as const),
  );

  for (const documento of documentos) {
    if (documento.status !== "active") continue;
    const resumo = resumos.get(documento.supplier_id);
    if (!resumo) continue;

    resumo.total += 1;
    const dias = diasAteDataIso(documento.expires_at, hoje);
    if (dias === null) {
      resumo.semValidade += 1;
    } else {
      if (
        resumo.vencimentoMaisProximo === null ||
        documento.expires_at! < resumo.vencimentoMaisProximo
      ) {
        resumo.vencimentoMaisProximo = documento.expires_at;
      }
      if (dias < 0) resumo.vencidos += 1;
      else if (dias === 0) resumo.vencemHoje += 1;
      else if (dias <= 30) resumo.aVencer += 1;
    }
  }

  for (const resumo of resumos.values()) {
    if (resumo.vencidos) resumo.situacao = "vencido";
    else if (resumo.vencemHoje) resumo.situacao = "vence_hoje";
    else if (resumo.aVencer) resumo.situacao = "a_vencer";
    else if (resumo.total === 0) resumo.situacao = "sem_documentos";
    else if (resumo.semValidade === resumo.total) resumo.situacao = "sem_validade";
    else resumo.situacao = "sem_alerta";
  }

  return resumos;
}

export function prioridadeDocumental(situacao: SituacaoMonitoramento): number {
  return PRIORIDADE[situacao];
}

export function necessitaAcompanhamentoDocumental(situacao: SituacaoMonitoramento): boolean {
  return situacao === "vencido" || situacao === "vence_hoje" || situacao === "a_vencer";
}
