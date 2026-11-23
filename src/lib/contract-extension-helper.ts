export type AditivoExistenteParaProrrogacao = {
  number: string;
  kind?: string;
};

type DataISO = { ano: number; mes: number; dia: number };

function interpretarDataISO(valor: string): DataISO | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
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

function formatarDataISO(data: Date): string {
  return [
    String(data.getUTCFullYear()).padStart(4, "0"),
    String(data.getUTCMonth() + 1).padStart(2, "0"),
    String(data.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function somarDias(dataISO: string, dias: number): string {
  const partes = interpretarDataISO(dataISO);
  if (!partes) return dataISO;

  const data = new Date(Date.UTC(partes.ano, partes.mes - 1, partes.dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return formatarDataISO(data);
}

/**
 * Soma meses preservando o dia sempre que possível e limitando-o ao último
 * dia do mês de destino quando o mês não possui o dia original.
 */
function somarMesesComAjusteDeFimDeMes(dataISO: string, meses: number): string {
  const partes = interpretarDataISO(dataISO);
  if (!partes || !Number.isInteger(meses) || meses <= 0) return dataISO;

  const primeiroDiaDestino = new Date(Date.UTC(partes.ano, partes.mes - 1 + meses, 1));
  const anoDestino = primeiroDiaDestino.getUTCFullYear();
  const mesDestino = primeiroDiaDestino.getUTCMonth();
  const ultimoDiaDestino = new Date(Date.UTC(anoDestino, mesDestino + 1, 0)).getUTCDate();
  const diaDestino = Math.min(partes.dia, ultimoDiaDestino);

  return formatarDataISO(new Date(Date.UTC(anoDestino, mesDestino, diaDestino)));
}

/**
 * Detecta o próximo número sequencial do termo aditivo com base nos aditivos
 * já registrados para o contrato, independentemente do tipo de alteração.
 */
export function sugerirProximoNumeroAditivo(
  aditivosExistentes: AditivoExistenteParaProrrogacao[],
): string {
  if (!aditivosExistentes?.length) return "1º Termo Aditivo";

  let maiorNumero = 0;
  for (const aditivo of aditivosExistentes) {
    const numero = aditivo.number.trim();
    const ordinal = numero.match(/(\d+)\s*(?:º|°|o)(?=\s|$)/i);
    const aposTipo = numero.match(/(?:aditivo|termo)\s*(?:n[º°o.]?\s*)?(\d+)/i);
    const primeiroNumero = numero.match(/(\d+)/);
    const encontrado = ordinal?.[1] ?? aposTipo?.[1] ?? primeiroNumero?.[1];

    if (!encontrado) continue;
    const valor = Number.parseInt(encontrado, 10);
    if (Number.isFinite(valor) && valor > maiorNumero) maiorNumero = valor;
  }

  const proximo = maiorNumero > 0 ? maiorNumero + 1 : aditivosExistentes.length + 1;
  return proximo + "º Termo Aditivo";
}

/**
 * Calcula o fim de um período de N meses que começa no dia seguinte ao fim
 * atual. A regra coincide com a validação de renovação já existente no banco:
 * proposed_end_date = proposed_start_date + N meses - 1 dia.
 */
export function calcularNovaDataVigencia(dataFimAtual: string, meses: number): string {
  if (!interpretarDataISO(dataFimAtual) || !Number.isInteger(meses) || meses <= 0) {
    return dataFimAtual;
  }

  const inicioProposto = somarDias(dataFimAtual, 1);
  const fimExclusivo = somarMesesComAjusteDeFimDeMes(inicioProposto, meses);
  return somarDias(fimExclusivo, -1);
}

/**
 * Retorna a quantidade inteira de meses correspondente à data informada.
 * Datas que não representam um período mensal aceito pelo validador retornam null.
 */
export function identificarMesesVigencia(
  dataFimAtual: string,
  novaData: string,
): number | null {
  if (!interpretarDataISO(novaData)) return null;

  for (let meses = 1; meses <= 120; meses += 1) {
    if (calcularNovaDataVigencia(dataFimAtual, meses) === novaData) return meses;
  }

  return null;
}

/**
 * Gera uma justificativa preliminar editável. A redação não substitui a análise
 * do caso concreto nem a comprovação dos requisitos jurídicos e documentais.
 */
export function gerarJustificativaProrrogacao(params: {
  contractNumber: string;
  supplierName?: string | undefined;
  meses: number;
  novaData: string;
}): string {
  const fornecedorTexto = params.supplierName
    ? " junto à empresa " + params.supplierName
    : "";
  const prazoTexto =
    params.meses > 0
      ? " por mais " + params.meses + " meses"
      : " com termo final proposto em " + params.novaData;

  return (
    "Proposta de prorrogação da vigência do Contrato nº " +
    params.contractNumber +
    prazoTexto +
    fornecedorTexto +
    ", com término previsto em " +
    params.novaData +
    ". " +
    "A fundamentação jurídica deverá observar a Lei nº 14.133/2021, especialmente o art. 107 " +
    "quando se tratar de serviço ou fornecimento contínuo, bem como a previsão no edital e no " +
    "instrumento contratual. A formalização depende da demonstração motivada da vantagem para " +
    "a Administração, da manifestação expressa da contratada, da manutenção das condições de " +
    "habilitação, da disponibilidade orçamentária, da autorização prévia da autoridade competente " +
    "e da instrução jurídica e documental aplicável ao caso concreto. " +
    "Esta justificativa é um texto preliminar e deve ser revisada e complementada antes da assinatura."
  );
}

/**
 * Valida localmente os campos que também são protegidos pelo PostgreSQL.
 * O parâmetro opcional hoje permite testes determinísticos sem depender do relógio.
 */
export function validarPayloadProrrogacao(params: {
  contractId: string;
  dataFimAtual: string;
  novaData: string;
  numeroAditivo: string;
  dataAssinatura: string;
  hoje?: string;
}): { valido: boolean; erro?: string } {
  if (!params.contractId.trim()) {
    return { valido: false, erro: "Não foi possível identificar o contrato selecionado." };
  }

  if (!interpretarDataISO(params.dataFimAtual)) {
    return { valido: false, erro: "A vigência atual do contrato possui uma data inválida." };
  }

  if (!params.numeroAditivo.trim()) {
    return { valido: false, erro: "Informe o número do termo aditivo." };
  }

  if (params.numeroAditivo.trim().length > 60) {
    return { valido: false, erro: "O número do aditivo deve ter no máximo 60 caracteres." };
  }

  if (!interpretarDataISO(params.novaData)) {
    return { valido: false, erro: "Informe uma nova data final válida." };
  }

  if (params.novaData <= params.dataFimAtual) {
    return {
      valido: false,
      erro: "A nova data final deve ser posterior à vigência atual do contrato.",
    };
  }

  if (!interpretarDataISO(params.dataAssinatura)) {
    return { valido: false, erro: "Informe uma data de assinatura válida." };
  }

  const hoje = params.hoje ?? new Date().toLocaleDateString("sv-SE");
  if (!interpretarDataISO(hoje)) {
    return { valido: false, erro: "Não foi possível determinar a data atual para validação." };
  }

  if (params.dataAssinatura > hoje) {
    return { valido: false, erro: "A data de assinatura não pode ser futura." };
  }

  return { valido: true };
}
