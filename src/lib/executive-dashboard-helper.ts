import { ETAPAS, type EtapaId } from "@/lib/contratacao";

export interface ProcessoResumoPainel {
  id: string;
  number: string;
  title: string;
  stage: string;
  status: string;
  responsible_user_id: string | null;
  responsible_name: string | null;
  estimated_value: number | null;
  due_date: string | null;
  updated_at: string;
}

export interface EtapaResumoPainel {
  id: EtapaId;
  nome: string;
  total: number;
  naMinhaMesa: number;
}

export interface ResumoEsteiraPainel {
  totalAtivos: number;
  naMinhaMesa: number;
  semResponsavel: number;
  valorTotalEstimado: number;
  porEtapa: EtapaResumoPainel[];
  processosNaMinhaMesa: ProcessoResumoPainel[];
}

export interface DadosTenantProntidao {
  trade_name?: string | null | undefined;
  manager_name?: string | null | undefined;
  ibge_code?: string | null | undefined;
}

export interface ResultadoProntidaoSecretaria {
  pronta: boolean;
  pendencias: string[];
}

/**
 * Consolida os processos ativos da Secretaria por etapa do fluxo,
 * destacando o que está na mesa do usuário logado e processos sem responsável.
 */
export function resumirEsteiraProcessos(
  processos: readonly ProcessoResumoPainel[],
  currentUserId: string | null | undefined,
): ResumoEsteiraPainel {
  const ativos = processos.filter(
    (p) => p.status !== "concluido" && p.status !== "arquivado",
  );

  const contagem = new Map<EtapaId, { total: number; naMinhaMesa: number }>();
  for (const etapa of ETAPAS) {
    contagem.set(etapa.id, { total: 0, naMinhaMesa: 0 });
  }

  let naMinhaMesa = 0;
  let semResponsavel = 0;
  let valorTotalEstimado = 0;
  const processosNaMinhaMesa: ProcessoResumoPainel[] = [];

  for (const proc of ativos) {
    if (typeof proc.estimated_value === "number" && Number.isFinite(proc.estimated_value)) {
      valorTotalEstimado += proc.estimated_value;
    }

    const isMeu = Boolean(currentUserId && proc.responsible_user_id === currentUserId);
    if (isMeu) {
      naMinhaMesa += 1;
      processosNaMinhaMesa.push(proc);
    }

    if (!proc.responsible_user_id && !proc.responsible_name?.trim()) {
      semResponsavel += 1;
    }

    const bucket = contagem.get(proc.stage as EtapaId);
    if (bucket) {
      bucket.total += 1;
      if (isMeu) bucket.naMinhaMesa += 1;
    }
  }

  processosNaMinhaMesa.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });

  const porEtapa: EtapaResumoPainel[] = ETAPAS.map((etapa) => {
    const bucket = contagem.get(etapa.id) ?? { total: 0, naMinhaMesa: 0 };
    return {
      id: etapa.id,
      nome: etapa.nome,
      total: bucket.total,
      naMinhaMesa: bucket.naMinhaMesa,
    };
  });

  return {
    totalAtivos: ativos.length,
    naMinhaMesa,
    semResponsavel,
    valorTotalEstimado,
    porEtapa,
    processosNaMinhaMesa,
  };
}

/**
 * Avalia se a ficha cadastral e o regulamento municipal da Secretaria
 * estão preenchidos para atender aos requisitos da Lei nº 14.133/2021.
 */
export function avaliarProntidaoSecretaria(
  tenant: DadosTenantProntidao | null | undefined,
  hasCompliance: boolean,
): ResultadoProntidaoSecretaria {
  const pendencias: string[] = [];

  if (!tenant?.manager_name?.trim()) {
    pendencias.push("Ordenador(a) de Despesas / Secretário(a) Titular");
  }
  if (!tenant?.ibge_code?.trim()) {
    pendencias.push("Código IBGE do município");
  }
  if (!tenant?.trade_name?.trim()) {
    pendencias.push("Nome Fantasia / FMS");
  }
  if (!hasCompliance) {
    pendencias.push("Regulamento Municipal (Lei nº 14.133/2021)");
  }

  return {
    pronta: pendencias.length === 0,
    pendencias,
  };
}
