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

type Document = {
  id: string;
  title: string;
  document_type: string;
  expires_at: string | null;
  status: string;
};
export type RequirementStatus = "valid" | "expiring" | "expired" | "missing" | "review";
export const DOCUMENT_REQUIREMENTS = [
  { type: "certidao_federal", label: "CND Federal / Previdenciária", sanitary: false },
  { type: "certidao_estadual", label: "CND Estadual", sanitary: false },
  { type: "certidao_municipal", label: "CND Municipal", sanitary: false },
  { type: "fgts", label: "FGTS (CRF)", sanitary: false },
  { type: "trabalhista", label: "CNDT", sanitary: false },
  { type: "sanitaria", label: "AFE — Anvisa", sanitary: true },
  { type: "alvara", label: "Alvará sanitário", sanitary: true },
] as const;
export function daysUntil(date: string, today = new Date().toLocaleDateString("sv-SE")) {
  return Math.round(
    (Date.parse(date.slice(0, 10) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000,
  );
}
export function monitorSupplierDocuments(documents: Document[], category: string, today?: string) {
  return DOCUMENT_REQUIREMENTS.filter(
    (r) => !r.sanitary || ["medicamentos", "materiais_hospitalares"].includes(category),
  ).map((requirement) => {
    const candidates = documents.filter(
      (d) =>
        d.status === "active" &&
        d.document_type === requirement.type &&
        (requirement.type !== "sanitaria" ||
          /\bafe\b|autoriza[cç][aã]o.*funcionamento/i.test(d.title)),
    );
    const dated = candidates
      .filter((d) => d.expires_at)
      .sort((a, b) => b.expires_at!.localeCompare(a.expires_at!));
    const document = dated[0] ?? candidates[0];
    let status: RequirementStatus = "missing";
    if (document) {
      const days = document.expires_at ? daysUntil(document.expires_at, today) : NaN;
      status = !Number.isFinite(days)
        ? "review"
        : days < 0
          ? "expired"
          : days <= 30
            ? "expiring"
            : "valid";
    }
    return { ...requirement, document, status };
  });
}
