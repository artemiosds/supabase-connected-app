export const ADITIVO_LIMITES = {
  acrescimoPadraoPct: 25,
  acrescimoReformaPct: 50,
  supressaoUnilateralPct: 25,
  mesesMaxArp: 24,
  mesesMaxContratoContinuo: 120,
} as const;

export const ROTULOS_TIPO_ADITIVO: Record<string, string> = {
  prorrogacao: "Prorrogação de prazo",
  acrescimo: "Acréscimo de valor",
  supressao: "Supressão de valor",
  reajuste: "Reajuste / Repactuação",
  apostilamento: "Apostilamento (art. 136)",
  outro: "Outro",
};

export interface AditivoHistoricoInput {
  number?: string;
  kind: string;
  value_change: number;
  signed_at?: string;
  new_end_date?: string | null;
}

export interface ResumoLimitesArt125 {
  baseValida: boolean;
  valorVigenteAtual: number;
  valorOriginalContrato: number;
  totalReajustesApostilamentos: number;
  valorInicialAtualizado: number;
  totalAcrescimos: number;
  totalSupressoesAbs: number;
  limiteAcrescimoPct: number;
  limiteSupressaoPct: number;
  percentualAcrescimos: number;
  percentualSupressoes: number;
  valorMaximoAcrescimo: number;
  valorMaximoSupressaoUnilateral: number;
  saldoAcrescimoDisponivel: number;
  saldoSupressaoUnilateralDisponivel: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function interpretarDataISO(valor: string): { ano: number; mes: number; dia: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    !Number.isFinite(data.getTime()) ||
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() + 1 !== mes ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }
  return { ano, mes, dia };
}

function formatarDataUTC(data: Date): string {
  return [
    String(data.getUTCFullYear()).padStart(4, "0"),
    String(data.getUTCMonth() + 1).padStart(2, "0"),
    String(data.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Calcula a data-limite máxima inclusiva de vigência conforme o tipo de instrumento:
 * - Ata de Registro de Preços: 24 meses (art. 84 da Lei nº 14.133/2021).
 * - Contrato contínuo: 120 meses / 10 anos (art. 107 da Lei nº 14.133/2021).
 */
export function calcularLimiteVigenciaInstrumento(
  startDate: string,
  instrumentType: string,
): { limiteData: string | null; maxMeses: number } {
  const maxMeses =
    instrumentType === "ata_registro_precos"
      ? ADITIVO_LIMITES.mesesMaxArp
      : ADITIVO_LIMITES.mesesMaxContratoContinuo;
  const partes = interpretarDataISO(startDate);
  if (!partes) return { limiteData: null, maxMeses };

  const anos = maxMeses / 12;
  const primeiroDiaDestino = new Date(Date.UTC(partes.ano + anos, partes.mes - 1, 1));
  const ultimoDiaMesDestino = new Date(
    Date.UTC(primeiroDiaDestino.getUTCFullYear(), primeiroDiaDestino.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const aniversario = new Date(
    Date.UTC(
      primeiroDiaDestino.getUTCFullYear(),
      primeiroDiaDestino.getUTCMonth(),
      Math.min(partes.dia, ultimoDiaMesDestino),
    ),
  );
  aniversario.setUTCDate(aniversario.getUTCDate() - 1);
  return { limiteData: formatarDataUTC(aniversario), maxMeses };
}

/**
 * Apura os limites quantitativos do art. 125 da Lei nº 14.133/2021 separadamente
 * (acréscimos x supressões, sem compensação entre si, conforme jurisprudência do TCU),
 * calculados sobre o valor inicial atualizado do contrato (valor original + reajustes).
 */
export function calcularLimitesArt125(params: {
  valorVigenteAtual: number;
  aditivos: readonly AditivoHistoricoInput[];
  isReformaEdificioOuEquipamento?: boolean | undefined;
}): ResumoLimitesArt125 {
  const valorVigenteAtual = Number(params.valorVigenteAtual);
  const limiteAcrescimoPct = params.isReformaEdificioOuEquipamento
    ? ADITIVO_LIMITES.acrescimoReformaPct
    : ADITIVO_LIMITES.acrescimoPadraoPct;
  const limiteSupressaoPct = ADITIVO_LIMITES.supressaoUnilateralPct;

  let variacaoLiquidaTotal = 0;
  let totalReajustesApostilamentos = 0;
  let totalAcrescimos = 0;
  let totalSupressoesAbs = 0;

  for (const aditivo of params.aditivos) {
    const change = Number(aditivo.value_change) || 0;
    variacaoLiquidaTotal += change;
    if (aditivo.kind === "reajuste" || aditivo.kind === "apostilamento") {
      totalReajustesApostilamentos += change;
    } else if (aditivo.kind === "acrescimo" && change > 0) {
      totalAcrescimos += change;
    } else if (aditivo.kind === "supressao" && change < 0) {
      totalSupressoesAbs += Math.abs(change);
    } else if (change > 0) {
      totalAcrescimos += change;
    } else if (change < 0) {
      totalSupressoesAbs += Math.abs(change);
    }
  }

  variacaoLiquidaTotal = roundMoney(variacaoLiquidaTotal);
  totalReajustesApostilamentos = roundMoney(totalReajustesApostilamentos);
  totalAcrescimos = roundMoney(totalAcrescimos);
  totalSupressoesAbs = roundMoney(totalSupressoesAbs);

  const valorOriginalContrato = roundMoney(valorVigenteAtual - variacaoLiquidaTotal);
  const valorInicialAtualizado = roundMoney(valorOriginalContrato + totalReajustesApostilamentos);

  if (
    !Number.isFinite(valorVigenteAtual) ||
    valorVigenteAtual < 0 ||
    valorOriginalContrato < 0 ||
    valorInicialAtualizado <= 0
  ) {
    return {
      baseValida: false,
      valorVigenteAtual: Number.isFinite(valorVigenteAtual) ? roundMoney(valorVigenteAtual) : 0,
      valorOriginalContrato: Math.max(0, valorOriginalContrato),
      totalReajustesApostilamentos,
      valorInicialAtualizado: Math.max(0, valorInicialAtualizado),
      totalAcrescimos,
      totalSupressoesAbs,
      limiteAcrescimoPct,
      limiteSupressaoPct,
      percentualAcrescimos: 0,
      percentualSupressoes: 0,
      valorMaximoAcrescimo: 0,
      valorMaximoSupressaoUnilateral: 0,
      saldoAcrescimoDisponivel: 0,
      saldoSupressaoUnilateralDisponivel: 0,
    };
  }

  const valorMaximoAcrescimo = roundMoney((valorInicialAtualizado * limiteAcrescimoPct) / 100);
  const valorMaximoSupressaoUnilateral = roundMoney(
    (valorInicialAtualizado * limiteSupressaoPct) / 100,
  );

  return {
    baseValida: true,
    valorVigenteAtual: roundMoney(valorVigenteAtual),
    valorOriginalContrato,
    totalReajustesApostilamentos,
    valorInicialAtualizado,
    totalAcrescimos,
    totalSupressoesAbs,
    limiteAcrescimoPct,
    limiteSupressaoPct,
    percentualAcrescimos: roundPct((totalAcrescimos / valorInicialAtualizado) * 100),
    percentualSupressoes: roundPct((totalSupressoesAbs / valorInicialAtualizado) * 100),
    valorMaximoAcrescimo,
    valorMaximoSupressaoUnilateral,
    saldoAcrescimoDisponivel: roundMoney(Math.max(0, valorMaximoAcrescimo - totalAcrescimos)),
    saldoSupressaoUnilateralDisponivel: roundMoney(
      Math.max(0, valorMaximoSupressaoUnilateral - totalSupressoesAbs),
    ),
  };
}

export interface ValidacaoAditivoResultado {
  valido: boolean;
  erro?: string;
  alerta?: string;
  valorChange: number;
  novoValorContrato: number;
  limites: ResumoLimitesArt125;
}

export function validarNovoAditivo(params: {
  contrato: {
    status: string;
    instrument_type: string;
    start_date: string;
    end_date: string;
    total_value: number;
  };
  aditivosExistentes: readonly AditivoHistoricoInput[];
  novoAditivo: {
    numero: string;
    tipo: string;
    novaData?: string;
    dataAssinatura: string;
    valorNumerico?: number;
    observacoes: string;
    isReformaEdificioOuEquipamento?: boolean;
    supressaoConsensualConfirmada?: boolean;
  };
  hoje?: string;
}): ValidacaoAditivoResultado {
  const { contrato, aditivosExistentes, novoAditivo } = params;
  const valorAtual = Number(contrato.total_value) || 0;
  const limites = calcularLimitesArt125({
    valorVigenteAtual: valorAtual,
    aditivos: aditivosExistentes,
    isReformaEdificioOuEquipamento: Boolean(novoAditivo.isReformaEdificioOuEquipamento),
  });

  const falhar = (erro: string, alerta?: string): ValidacaoAditivoResultado => ({
    valido: false,
    erro,
    ...(alerta ? { alerta } : {}),
    valorChange: 0,
    novoValorContrato: valorAtual,
    limites,
  });

  if (contrato.status === "arquivado" || contrato.status === "rescindido") {
    return falhar(
      "Instrumentos rescindidos ou arquivados não podem receber novos termos aditivos.",
    );
  }

  const numeroTrim = novoAditivo.numero.trim();
  if (!numeroTrim || numeroTrim.length > 60) {
    return falhar("Informe o número do termo (entre 1 e 60 caracteres).");
  }

  if (
    aditivosExistentes.some(
      (item) =>
        item.number &&
        item.number.trim().toLocaleLowerCase("pt-BR") === numeroTrim.toLocaleLowerCase("pt-BR"),
    )
  ) {
    return falhar("Já existe um termo aditivo ou apostilamento com este número neste instrumento.");
  }

  const hoje = params.hoje ?? new Date().toLocaleDateString("sv-SE");
  if (!interpretarDataISO(novoAditivo.dataAssinatura) || novoAditivo.dataAssinatura > hoje) {
    return falhar("Informe uma data de assinatura válida, não futura.");
  }

  if (novoAditivo.observacoes.trim().length < 10) {
    return falhar(
      "Informe a justificativa e o fundamento do termo com pelo menos 10 caracteres (art. 124 da Lei nº 14.133/2021).",
    );
  }

  if (contrato.instrument_type === "ata_registro_precos" && novoAditivo.tipo === "acrescimo") {
    return falhar(
      "Na Ata de Registro de Preços é vedado efetuar acréscimos de quantitativos ou valores (Decreto nº 11.462/2023, art. 23).",
    );
  }

  const tipo = novoAditivo.tipo;

  if (tipo === "prorrogacao") {
    const novaData = (novoAditivo.novaData ?? "").trim();
    if (novoAditivo.dataAssinatura > contrato.end_date) {
      return falhar(
        "A prorrogação não pode ser assinada após o término da vigência (vedada prorrogação retroativa; ON AGU nº 3/2009).",
      );
    }
    if (!interpretarDataISO(novaData) || novaData <= contrato.end_date) {
      return falhar("A nova data final deve ser posterior à vigência atual do instrumento.");
    }
    const { limiteData } = calcularLimiteVigenciaInstrumento(
      contrato.start_date,
      contrato.instrument_type,
    );
    if (limiteData && novaData > limiteData) {
      return falhar(
        contrato.instrument_type === "ata_registro_precos"
          ? "A Ata de Registro de Preços não pode ultrapassar 24 meses de vigência total (art. 84 da Lei nº 14.133/2021)."
          : "A prorrogação ultrapassa o limite máximo decenal de 120 meses previsto no art. 107 da Lei nº 14.133/2021.",
      );
    }
    return {
      valido: true,
      valorChange: 0,
      novoValorContrato: valorAtual,
      limites,
    };
  }

  if (tipo === "acrescimo" || tipo === "supressao" || tipo === "reajuste") {
    const v = novoAditivo.valorNumerico ?? Number.NaN;
    if (!Number.isFinite(v) || v <= 0) {
      return falhar("Informe um valor válido e maior que zero.");
    }
    const valorAbs = roundMoney(Math.abs(v));

    if (tipo === "acrescimo") {
      if (limites.baseValida && valorAbs > roundMoney(limites.saldoAcrescimoDisponivel + 0.01)) {
        return falhar(
          `Acréscimo excede o limite legal de ${limites.limiteAcrescimoPct}% do art. 125 sobre o valor inicial atualizado (saldo máximo disponível sem compensar supressões: R$ ${limites.saldoAcrescimoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`,
        );
      }
      return {
        valido: true,
        valorChange: valorAbs,
        novoValorContrato: roundMoney(valorAtual + valorAbs),
        limites,
      };
    }

    if (tipo === "supressao") {
      if (valorAbs > valorAtual) {
        return falhar("A supressão não pode exceder o valor vigente atual do contrato.");
      }
      const supressaoAcumulada = roundMoney(limites.totalSupressoesAbs + valorAbs);
      if (
        limites.baseValida &&
        supressaoAcumulada > roundMoney(limites.valorMaximoSupressaoUnilateral + 0.01) &&
        !novoAditivo.supressaoConsensualConfirmada
      ) {
        return falhar(
          `A supressão acumulada (${roundPct((supressaoAcumulada / limites.valorInicialAtualizado) * 100)}%) supera 25% do valor inicial atualizado (art. 125). Confirme que há acordo consensual formal com a contratada (art. 124, II).`,
        );
      }
      return {
        valido: true,
        valorChange: -valorAbs,
        novoValorContrato: roundMoney(valorAtual - valorAbs),
        limites,
      };
    }

    // Reajuste / Repactuação (apostilamento com impacto financeiro)
    return {
      valido: true,
      valorChange: valorAbs,
      novoValorContrato: roundMoney(valorAtual + valorAbs),
      limites,
    };
  }

  // "outro" ou "apostilamento" sem impacto numérico direto
  return {
    valido: true,
    valorChange: 0,
    novoValorContrato: valorAtual,
    limites,
  };
}
