// =============================================================================
// contract-inspections-helper.ts — Livro Digital de Fiscalização (Art. 117)
// Primus Gestão — Lei nº 14.133/2021, arts. 117 e 156
// =============================================================================

export type TipoRegistroFiscalizacao =
  | "vistoria"
  | "medicao"
  | "atesto"
  | "ocorrencia"
  | "notificacao"
  | "penalidade";

export type SeveridadeFiscalizacao = "informativa" | "atencao" | "critica";

export type StatusFiscalizacao =
  | "registrada"
  | "aguardando_defesa"
  | "regularizada"
  | "encerrada"
  | "encaminhada_sancao";

export const ROTULOS_TIPO_FISCALIZACAO: Record<TipoRegistroFiscalizacao, string> = {
  vistoria: "Vistoria / Inspeção in loco",
  medicao: "Medição de serviço / obra",
  atesto: "Atesto de entrega / execução",
  ocorrencia: "Registro de ocorrência",
  notificacao: "Notificação formal ao contratado",
  penalidade: "Encaminhamento p/ apuração de sanção",
};

export const ROTULOS_SEVERIDADE_FISCALIZACAO: Record<SeveridadeFiscalizacao, string> = {
  informativa: "Informativa",
  atencao: "Atenção",
  critica: "Crítica",
};

export const ROTULOS_STATUS_FISCALIZACAO: Record<StatusFiscalizacao, string> = {
  registrada: "Registrada",
  aguardando_defesa: "Aguardando defesa / regularização",
  regularizada: "Regularizada pelo contratado",
  encerrada: "Encerrada",
  encaminhada_sancao: "Encaminhada p/ sanção (art. 156)",
};

export const FUNDAMENTOS_LEGAIS_PADRAO: Record<TipoRegistroFiscalizacao, string> = {
  vistoria: "Lei nº 14.133/2021, art. 117, caput e § 1º",
  medicao: "Lei nº 14.133/2021, art. 117 e art. 140, I",
  atesto: "Lei nº 14.133/2021, art. 140, caput e § 1º",
  ocorrencia: "Lei nº 14.133/2021, art. 117, § 1º",
  notificacao: "Lei nº 14.133/2021, art. 117, § 2º e art. 157",
  penalidade: "Lei nº 14.133/2021, art. 155 e art. 156",
};

export interface ValidacaoRegistroInput {
  record_number: string;
  record_type: TipoRegistroFiscalizacao;
  title: string;
  description: string;
  occurred_at: string;
  inspector_name: string;
  defense_deadline?: string | null;
}

export function sugerirProximoNumeroFiscalizacao(
  registros: readonly { record_number: string; record_type: string }[],
  tipo: TipoRegistroFiscalizacao,
  anoReferencia: number,
): string {
  const prefixo = tipo === "notificacao" ? "NOTIF" : "REG";
  const regex = new RegExp(`^${prefixo}-(\\d+)\\/${anoReferencia}$`, "i");
  let maior = 0;
  for (const r of registros) {
    const match = regex.exec(r.record_number.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maior) maior = n;
    }
  }
  const proximo = String(maior + 1).padStart(3, "0");
  return `${prefixo}-${proximo}/${anoReferencia}`;
}

export function calcularPrazoDefesaUtil(dataBaseISO: string, diasUteis: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataBaseISO.trim());
  if (!match || !Number.isFinite(diasUteis) || diasUteis < 1) return null;
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(data.getTime())) return null;

  let restantes = Math.floor(diasUteis);
  while (restantes > 0) {
    data.setUTCDate(data.getUTCDate() + 1);
    const diaSemana = data.getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) {
      restantes -= 1;
    }
  }

  return [
    String(data.getUTCFullYear()).padStart(4, "0"),
    String(data.getUTCMonth() + 1).padStart(2, "0"),
    String(data.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function validarRegistroFiscalizacao(
  input: ValidacaoRegistroInput,
  hojeISO: string,
): { valido: boolean; erro?: string } {
  if (!input.record_number.trim()) {
    return { valido: false, erro: "Informe o número de controle do registro." };
  }
  if (input.title.trim().length < 3 || input.title.trim().length > 200) {
    return { valido: false, erro: "O título deve ter entre 3 e 200 caracteres." };
  }
  if (input.description.trim().length < 10) {
    return {
      valido: false,
      erro: "Descreva os fatos com pelo menos 10 caracteres (exigência de rastreabilidade).",
    };
  }
  if (input.inspector_name.trim().length < 3) {
    return { valido: false, erro: "Informe o nome completo do fiscal responsável." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurred_at)) {
    return { valido: false, erro: "Data da ocorrência inválida." };
  }
  if (input.occurred_at > hojeISO) {
    return { valido: false, erro: "A data da ocorrência ou vistoria não pode ser futura." };
  }

  const deadline = input.defense_deadline?.trim() || null;
  if (input.record_type === "notificacao" && !deadline) {
    return {
      valido: false,
      erro: "Notificações formais exigem prazo de defesa prévia ou regularização.",
    };
  }
  if (deadline) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      return { valido: false, erro: "Prazo de defesa inválido." };
    }
    if (deadline < input.occurred_at) {
      return {
        valido: false,
        erro: "O prazo de defesa não pode ser anterior à data da ocorrência.",
      };
    }
  }

  return { valido: true };
}

export function avaliarUrgenciaPrazoDefesa(
  status: string,
  defenseDeadline: string | null,
  hojeISO: string,
): "vencida" | "vence_em_breve" | "no_prazo" | null {
  if (!defenseDeadline) return null;
  if (status === "regularizada" || status === "encerrada" || status === "encaminhada_sancao") {
    return null;
  }
  if (defenseDeadline < hojeISO) return "vencida";

  const hojeMs = Date.parse(`${hojeISO}T00:00:00Z`);
  const prazoMs = Date.parse(`${defenseDeadline}T00:00:00Z`);
  if (!Number.isFinite(hojeMs) || !Number.isFinite(prazoMs)) return null;
  const diffDias = Math.round((prazoMs - hojeMs) / 86_400_000);
  if (diffDias <= 2) return "vence_em_breve";
  return "no_prazo";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatarDataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function gerarHtmlNotificacaoFormal(params: {
  orgaoNome: string;
  municipioUf?: string;
  contratoNumero: string;
  contratoObjeto: string;
  fornecedorNome: string;
  fornecedorCnpj?: string | null;
  registroNumero: string;
  tipo: TipoRegistroFiscalizacao;
  titulo: string;
  descricao: string;
  fundamentoLegal: string;
  dataOcorrencia: string;
  prazoDefesa?: string | null;
  fiscalNome: string;
  manifestacaoFornecedor?: string | null;
  observacaoResolucao?: string | null;
}): string {
  const tipoLabel = ROTULOS_TIPO_FISCALIZACAO[params.tipo] ?? params.tipo;
  const cabecalhoDoc =
    params.tipo === "notificacao"
      ? `NOTIFICAÇÃO FORMAL DE FISCALIZAÇÃO Nº ${escapeHtml(params.registroNumero)}`
      : `TERMO DE REGISTRO NO LIVRO DE FISCALIZAÇÃO Nº ${escapeHtml(params.registroNumero)}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${cabecalhoDoc}</title>
  <style>
    body { font-family: "Times New Roman", Georgia, serif; color: #111827; margin: 36px; line-height: 1.55; font-size: 13px; }
    .header { text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 15px; margin: 0; text-transform: uppercase; letter-spacing: 0.4px; }
    .header p { margin: 3px 0 0; font-size: 12px; color: #475569; }
    .doc-title { text-align: center; font-size: 14px; font-weight: bold; margin: 18px 0; text-transform: uppercase; background: #f1f5f9; padding: 8px 12px; border: 1px solid #cbd5e1; }
    .grid { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
    .grid td { border: 1px solid #cbd5e1; padding: 6px 10px; vertical-align: top; }
    .grid td.label { width: 28%; font-weight: bold; background: #f8fafc; }
    .section-title { font-weight: bold; text-transform: uppercase; font-size: 12px; margin: 16px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
    .box { border: 1px solid #cbd5e1; padding: 10px 12px; background: #ffffff; white-space: pre-wrap; }
    .deadline-box { border: 1.5px solid #b45309; background: #fffbeb; padding: 10px 12px; margin-top: 14px; font-weight: bold; }
    .signatures { margin-top: 48px; display: flex; justify-content: space-between; gap: 32px; }
    .sig-col { flex: 1; text-align: center; border-top: 1px solid #334155; padding-top: 6px; font-size: 12px; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(params.orgaoNome)}</h1>
    ${params.municipioUf ? `<p>${escapeHtml(params.municipioUf)}</p>` : ""}
    <p>Livro Digital de Fiscalização Contratual — Lei nº 14.133/2021, art. 117, § 1º</p>
  </div>

  <div class="doc-title">${cabecalhoDoc}</div>

  <table class="grid">
    <tr><td class="label">Espécie do Registro</td><td>${escapeHtml(tipoLabel)}</td></tr>
    <tr><td class="label">Instrumento Contratual</td><td>${escapeHtml(params.contratoNumero)} — ${escapeHtml(params.contratoObjeto)}</td></tr>
    <tr><td class="label">Contratado / Fornecedor</td><td>${escapeHtml(params.fornecedorNome)}${params.fornecedorCnpj ? ` (CNPJ/CPF: ${escapeHtml(params.fornecedorCnpj)})` : ""}</td></tr>
    <tr><td class="label">Data da Ocorrência</td><td>${formatarDataBr(params.dataOcorrencia)}</td></tr>
    <tr><td class="label">Fundamento Legal</td><td>${escapeHtml(params.fundamentoLegal || FUNDAMENTOS_LEGAIS_PADRAO[params.tipo])}</td></tr>
    <tr><td class="label">Fiscal Responsável</td><td>${escapeHtml(params.fiscalNome)}</td></tr>
  </table>

  <div class="section-title">1. Assunto e Relato Fático</div>
  <div class="box"><strong>${escapeHtml(params.titulo)}</strong>\n\n${escapeHtml(params.descricao)}</div>

  ${
    params.prazoDefesa
      ? `<div class="deadline-box">2. Prazo para Regularização / Defesa Prévia: até ${formatarDataBr(params.prazoDefesa)} — O não atendimento no prazo sujeitará a contratada à instauração de processo sancionatório nos termos dos arts. 155 e 156 da Lei nº 14.133/2021.</div>`
      : ""
  }

  ${
    params.manifestacaoFornecedor
      ? `<div class="section-title">Manifestação / Providências do Contratado</div><div class="box">${escapeHtml(params.manifestacaoFornecedor)}</div>`
      : ""
  }

  ${
    params.observacaoResolucao
      ? `<div class="section-title">Despacho de Encerramento da Fiscalização</div><div class="box">${escapeHtml(params.observacaoResolucao)}</div>`
      : ""
  }

  <div class="signatures">
    <div class="sig-col">
      <strong>${escapeHtml(params.fiscalNome)}</strong><br />
      Fiscal do Contrato (Art. 117, Lei nº 14.133/2021)
    </div>
    <div class="sig-col">
      <strong>${escapeHtml(params.fornecedorNome)}</strong><br />
      Ciência do Preposto / Representante Legal
    </div>
  </div>
</body>
</html>`;
}
