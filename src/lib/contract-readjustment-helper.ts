// =============================================================================
// contract-readjustment-helper.ts — Calculadora de Reajuste Contratual (BCB SGS)
// Primus Gestão — Lei nº 14.133/2021, art. 25, § 7º, art. 92, § 3º e art. 136, I
// =============================================================================

export type CodigoIndiceReajuste = "ipca" | "inpc" | "igpm" | "ipcfipe";

export interface DefinicaoIndiceBcb {
  codigo: CodigoIndiceReajuste;
  codigoSgs: number;
  sigla: string;
  nome: string;
  fonte: string;
}

export const INDICES_REAJUSTE_BCB: Record<CodigoIndiceReajuste, DefinicaoIndiceBcb> = {
  ipca: {
    codigo: "ipca",
    codigoSgs: 433,
    sigla: "IPCA",
    nome: "IPCA (IBGE)",
    fonte: "IBGE / Banco Central SGS 433",
  },
  inpc: {
    codigo: "inpc",
    codigoSgs: 188,
    sigla: "INPC",
    nome: "INPC (IBGE)",
    fonte: "IBGE / Banco Central SGS 188",
  },
  igpm: {
    codigo: "igpm",
    codigoSgs: 189,
    sigla: "IGP-M",
    nome: "IGP-M (FGV)",
    fonte: "FGV / Banco Central SGS 189",
  },
  ipcfipe: {
    codigo: "ipcfipe",
    codigoSgs: 193,
    sigla: "IPC-FIPE",
    nome: "IPC-FIPE",
    fonte: "FIPE / Banco Central SGS 193",
  },
};

export interface PontoIndiceMensal {
  data: string; // DD/MM/YYYY
  valor: number; // variação mensal em %
}

export interface ResultadoReajuste {
  fatorAcumulado: number;
  percentualAcumulado: number;
  valorBase: number;
  valorReajuste: number;
  valorAtualizado: number;
  mesesConsiderados: number;
  memorialCalculo: string;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isoParaDataBr(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function sugerirPeriodo12Meses(dataReferenciaISO: string): {
  dataInicialISO: string;
  dataFinalISO: string;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataReferenciaISO.trim());
  const base = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  // Últimos 12 meses fechados anteriores ao mês de referência
  const fim = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 0));
  const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - 11, 1));

  const fmt = (d: Date) =>
    [
      String(d.getUTCFullYear()).padStart(4, "0"),
      String(d.getUTCMonth() + 1).padStart(2, "0"),
      String(d.getUTCDate()).padStart(2, "0"),
    ].join("-");

  return {
    dataInicialISO: fmt(inicio),
    dataFinalISO: fmt(fim),
  };
}

export function parseBcbSeriesPayload(raw: unknown): PontoIndiceMensal[] {
  if (!Array.isArray(raw)) return [];
  const pontos: PontoIndiceMensal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const data = typeof record["data"] === "string" ? record["data"].trim() : "";
    const rawValor = record["valor"];
    const valor =
      typeof rawValor === "number"
        ? rawValor
        : typeof rawValor === "string"
          ? Number(rawValor.replace(",", ".").trim())
          : Number.NaN;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data) || !Number.isFinite(valor)) continue;
    pontos.push({ data, valor });
  }
  return pontos;
}

/**
 * Calcula o reajuste acumulado por capitalização composta geométrica:
 * Fator = Π (1 + variacao_mensal / 100), conforme metodologia oficial do IBGE/FGV/TCU.
 */
export function calcularReajusteAcumulado(params: {
  valorBase: number;
  pontosMensais: readonly PontoIndiceMensal[];
  indice: CodigoIndiceReajuste;
  dataInicialISO: string;
  dataFinalISO: string;
}): ResultadoReajuste {
  const valorBase = Number(params.valorBase);
  if (!Number.isFinite(valorBase) || valorBase <= 0) {
    throw new Error("Informe um valor contratual base positivo para calcular o reajuste.");
  }
  if (params.pontosMensais.length === 0) {
    throw new Error("Nenhum índice mensal disponível para o período informado.");
  }

  let fator = 1;
  for (const p of params.pontosMensais) {
    fator *= 1 + p.valor / 100;
  }

  const percentualAcumulado = Math.round(((fator - 1) * 100 + Number.EPSILON) * 10000) / 10000;
  const valorReajuste = roundMoney(valorBase * (fator - 1));
  const valorAtualizado = roundMoney(valorBase + valorReajuste);
  const def = INDICES_REAJUSTE_BCB[params.indice];

  const inicioBr = isoParaDataBr(params.dataInicialISO) ?? params.dataInicialISO;
  const fimBr = isoParaDataBr(params.dataFinalISO) ?? params.dataFinalISO;

  const fmtMoeda = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtPct = (v: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  const memorialCalculo = [
    `Memória de cálculo de reajuste contratual (${def.nome} — ${def.fonte}):`,
    `Período apurado: ${inicioBr} a ${fimBr} (${params.pontosMensais.length} competência(s) mensal(is)).`,
    `Índice acumulado composto: ${fmtPct(percentualAcumulado)}% (fator ${fator.toFixed(6)}).`,
    `Base contratual: ${fmtMoeda(valorBase)} | Valor do reajuste: ${fmtMoeda(valorReajuste)} | Novo valor vigente: ${fmtMoeda(valorAtualizado)}.`,
    `Fundamentação legal: Lei nº 14.133/2021, art. 25, § 7º, art. 92, § 3º e art. 136, inciso I.`,
  ].join(" ");

  return {
    fatorAcumulado: Number(fator.toFixed(6)),
    percentualAcumulado,
    valorBase: roundMoney(valorBase),
    valorReajuste,
    valorAtualizado,
    mesesConsiderados: params.pontosMensais.length,
    memorialCalculo,
  };
}
