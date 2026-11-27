import type { CnpjLookupData } from "../../supabase/functions/_shared/cnpj-mapping";
import { isInvitationExpired } from "./invitations";

export type DadosOrganizacaoFormulario = {
  cnpj: string;
  contact_email: string;
  contact_phone: string;
  street: string;
  municipality: string;
  state: string;
  trade_name?: string;
  manager_name?: string;
  ibge_code?: string;
};

/** Limpa e formata o código IBGE municipal (7 dígitos numéricos). */
export function normalizarCodigoIbge(codigo: string | null | undefined): string {
  if (!codigo) return "";
  return codigo.replace(/\D/g, "").slice(0, 7);
}

export type VagasPlano = {
  limite: number | null;
  ocupadas: number;
  disponiveis: number | null;
  atingido: boolean;
};

const PLAN_LABELS: Record<string, string> = {
  basico: "Básico",
  profissional: "Profissional",
  enterprise: "Enterprise",
  consorcio: "Consórcio / Multissecretaria",
};

const COMMERCIAL_STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  trial: "Demonstração",
  blocked_billing: "Bloqueado por cobrança",
  suspended: "Suspenso",
  cancelled: "Cancelado",
};

const MODULE_LABELS: Record<string, string> = {
  fornecedores: "Fornecedores",
  documentos: "Documentos",
  processos: "Processos",
  contratos: "Contratos",
  modelos: "Modelos",
  ged: "GED / Arquivos",
  auditoria: "Auditoria",
  relatorios: "Relatórios",
  pca: "PCA",
};

/** Traduz o plano comercial do tenant para exibição em português. */
export function traduzirPlanoComercial(planTier: string | null | undefined): string {
  const key = (planTier ?? "").trim().toLowerCase();
  return PLAN_LABELS[key] ?? (planTier || "Não informado");
}

/** Traduz a situação comercial do tenant para exibição em português. */
export function traduzirStatusComercial(status: string | null | undefined): string {
  const key = (status ?? "").trim().toLowerCase();
  return COMMERCIAL_STATUS_LABELS[key] ?? (status || "Não informado");
}

/** Lista os módulos habilitados no tenant já ordenados e traduzidos. */
export function listarModulosHabilitados(
  enabledModules: Record<string, boolean> | null | undefined,
): string[] {
  if (!enabledModules) return [];
  return Object.entries(enabledModules)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => MODULE_LABELS[key] ?? key);
}

/**
 * Aplica dados consultados na Receita Federal aos campos da Secretaria,
 * preenchendo apenas campos vazios para não sobrescrever ajustes manuais.
 */
export function mesclarDadosCnpjOrganizacao(
  atual: DadosOrganizacaoFormulario,
  consulta: CnpjLookupData,
): DadosOrganizacaoFormulario {
  const enderecoComposto = [
    consulta.street,
    consulta.street_number,
    consulta.complement,
    consulta.neighborhood,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ")
    .slice(0, 200);

  const fantasiaConsulta =
    typeof consulta.trade_name === "string" ? consulta.trade_name.trim() : "";

  return {
    cnpj: atual.cnpj,
    contact_email: atual.contact_email.trim() || consulta.contact_email?.trim() || "",
    contact_phone: atual.contact_phone.trim() || consulta.contact_phone?.trim() || "",
    street: atual.street.trim() || enderecoComposto,
    municipality: atual.municipality.trim() || consulta.city?.trim() || "",
    state: atual.state.trim() || consulta.state?.trim().toUpperCase() || "",
    trade_name: atual.trade_name?.trim() || fantasiaConsulta,
    manager_name: atual.manager_name?.trim() || "",
    ibge_code: atual.ibge_code?.trim() || "",
  };
}

/** Monta sugestão de subtítulo e rodapé oficial usando os dados cadastrados da Secretaria. */
export function montarSugestaoTimbrado(
  nomeOrganizacao: string,
  dados: DadosOrganizacaoFormulario,
): { header_subtitle: string; footer_text: string } {
  const cidadeUf = [dados.municipality.trim(), dados.state.trim().toUpperCase()]
    .filter(Boolean)
    .join("/");
  const headerSubtitle = cidadeUf
    ? `Prefeitura / Município de ${cidadeUf} · ${nomeOrganizacao}`
    : nomeOrganizacao;

  const rodapePartes = [
    dados.cnpj.trim() ? `CNPJ: ${dados.cnpj.trim()}` : "",
    dados.street.trim(),
    cidadeUf,
    dados.contact_phone.trim() ? `Tel.: ${dados.contact_phone.trim()}` : "",
    dados.contact_email.trim(),
  ].filter(Boolean);

  return {
    header_subtitle: headerSubtitle.slice(0, 240),
    footer_text: rodapePartes.join(" · ").slice(0, 500),
  };
}

/** Calcula vagas utilizadas (membros ativos + convites pendentes válidos) em relação ao max_users. */
export function calcularVagasUsuarios(
  maxUsers: number | null | undefined,
  activeMembers: number,
  pendingInvites: number,
): VagasPlano {
  const ocupadas = Math.max(0, activeMembers) + Math.max(0, pendingInvites);
  if (typeof maxUsers !== "number" || !Number.isFinite(maxUsers) || maxUsers <= 0) {
    return { limite: null, ocupadas, disponiveis: null, atingido: false };
  }
  const disponiveis = Math.max(0, maxUsers - ocupadas);
  return {
    limite: maxUsers,
    ocupadas,
    disponiveis,
    atingido: ocupadas >= maxUsers,
  };
}

/** Reativar um usuário suspenso exige users:edit ou users:delete no banco. */
export function podeAlterarStatusMembro(
  statusAtual: string,
  capacidades: { can_edit: boolean; can_suspend: boolean },
): boolean {
  if (statusAtual === "active") return capacidades.can_suspend;
  return capacidades.can_edit || capacidades.can_suspend;
}

/** Filtra convites por busca de e-mail e situação normalizada. */
export function filtrarConvites<
  T extends { invited_email: string; status: string; expires_at: string },
>(convites: ReadonlyArray<T>, busca: string, filtroStatus: string): T[] {
  const term = busca.trim().toLowerCase();
  return convites.filter((convite) => {
    const matchesEmail = !term || convite.invited_email.toLowerCase().includes(term);
    if (!matchesEmail) return false;
    if (filtroStatus === "todos") return true;
    const expired = isInvitationExpired(convite.status, convite.expires_at);
    if (filtroStatus === "expired") return expired;
    if (filtroStatus === "pending") return convite.status === "pending" && !expired;
    return convite.status === filtroStatus;
  });
}

export type ProntidaoSecretaria = {
  percentual: number;
  status: "completo" | "parcial" | "pendente";
  itens: {
    chave: "cnpj" | "timbrado" | "email" | "endereco";
    titulo: string;
    preenchido: boolean;
    critico: boolean;
  }[];
  resumoPendencias: string[];
};

/**
 * Avalia o grau de prontidão cadastral e operacional da Secretaria selecionada.
 * Itens críticos: CNPJ válido e Timbrado com Brasão.
 */
export function calcularProntidaoSecretaria(params: {
  cnpj: string;
  hasLogo: boolean;
  headerTitle: string;
  street: string;
  municipality: string;
  emailConfigured: boolean;
}): ProntidaoSecretaria {
  const cnpjOk = Boolean(params.cnpj && params.cnpj.replace(/\D/g, "").length === 14);
  const timbradoOk = Boolean(params.hasLogo || params.headerTitle.trim().length > 3);
  const enderecoOk = Boolean(params.municipality.trim().length > 1);
  const emailOk = Boolean(params.emailConfigured);

  const itens = [
    {
      chave: "cnpj" as const,
      titulo: "CNPJ da Secretaria / FMS",
      preenchido: cnpjOk,
      critico: true,
    },
    {
      chave: "timbrado" as const,
      titulo: "Brasão e Timbrado Oficial",
      preenchido: timbradoOk,
      critico: true,
    },
    {
      chave: "endereco" as const,
      titulo: "Município e Endereço",
      preenchido: enderecoOk,
      critico: false,
    },
    {
      chave: "email" as const,
      titulo: "E-mail Institucional",
      preenchido: emailOk,
      critico: false,
    },
  ];

  const total = itens.length;
  const concluidos = itens.filter((i) => i.preenchido).length;
  const percentual = Math.round((concluidos / total) * 100);

  const pendencias: string[] = [];
  if (!cnpjOk) pendencias.push("Cadastrar o CNPJ oficial do órgão");
  if (!timbradoOk) pendencias.push("Carregar o Brasão Oficial do Município");
  if (!emailOk) pendencias.push("Configurar e-mail institucional de saída");

  const status: "completo" | "parcial" | "pendente" =
    percentual === 100 ? "completo" : percentual >= 50 ? "parcial" : "pendente";

  return {
    percentual,
    status,
    itens,
    resumoPendencias: pendencias,
  };
}

/** Valores e prazos oficiais da Lei nº 14.133/2021 atualizados pelo Decreto Federal nº 12.343/2024. */
export const LIMITES_LEI_14133 = {
  dispensaComprasServicos: 62725.58, // Art. 75, II
  dispensaObrasEngenharia: 125451.15, // Art. 75, I
  validadeCotacaoFornecedorMeses: 6, // IN 65/2021, art. 5º, § 2º
  validadePainelPrecosMeses: 12, // IN 65/2021, art. 5º, § 1º
  maxVigenciaContinuosMeses: 120, // Art. 107 (10 anos)
  maxVigenciaAtaMeses: 24, // Art. 84 (2 anos)
} as const;

export type DadosComplianceFormulario = {
  normative_basis: "pending" | "in65_2021" | "local_regulation" | "other";
  in65_applicability: "pending" | "applicable" | "adopted" | "not_applicable";
  local_regulation_name: string;
  local_regulation_reference: string;
  legal_review_status: "pending" | "validated";
  legal_review_notes: string;
};

/**
 * Valida a consistência das regras normativas conforme as constraints do banco de dados:
 * - Se for regulamento local, nome e artigo de referência são obrigatórios.
 * - Se IN 65 for declarada "not_applicable", a justificativa nas notas jurídicas é obrigatória.
 */
export function validarConformidadeContratacao(
  dados: DadosComplianceFormulario,
): { valido: boolean; erros: string[] } {
  const erros: string[] = [];

  if (dados.normative_basis === "local_regulation") {
    if (!dados.local_regulation_name.trim()) {
      erros.push("Informe o nome ou número do Decreto/Regulamento Municipal.");
    }
    if (!dados.local_regulation_reference.trim()) {
      erros.push("Informe o dispositivo ou artigo de referência da norma municipal.");
    }
  }

  if (dados.in65_applicability === "not_applicable" && !dados.legal_review_notes.trim()) {
    erros.push(
      "Ao indicar que a IN 65/2021 não se aplica, é obrigatório registrar a justificativa jurídica.",
    );
  }

  return {
    valido: erros.length === 0,
    erros,
  };
}

/** Formata a descrição amigável da base normativa para exibição. */
export function formatarBaseNormativa(basis: string | null | undefined): string {
  switch (basis) {
    case "in65_2021":
      return "IN SEGES/ME nº 65/2021 (Federal)";
    case "local_regulation":
      return "Regulamento Municipal Próprio";
    case "other":
      return "Outra norma jurídica";
    case "pending":
    default:
      return "Padrão Federal / Pendente";
  }
}

export const REGRAS_ALERTAS_VENCIMENTO = [
  {
    dias: 120,
    nivel: "planejamento",
    rotulo: "Planejamento",
    descricao:
      "Início do estudo técnico e planejamento de prorrogação ou nova licitação (Art. 107 Lei 14.133)",
  },
  {
    dias: 90,
    nivel: "alerta",
    rotulo: "Notificação",
    descricao: "Notificação formal à Secretaria requisitante e manifestação do fornecedor",
  },
  {
    dias: 60,
    nivel: "urgencia",
    rotulo: "Parecer",
    descricao: "Parecer jurídico referencial e elaboração da minuta de termo aditivo",
  },
  {
    dias: 30,
    nivel: "critico",
    rotulo: "Fase Crítica",
    descricao: "Fase final de assinatura ou bloqueio iminente de empenhos/fornecimento",
  },
] as const;

export type StatusCanalIntegracao = "ativo" | "parcial" | "homologacao" | "desativado";

export type DiagnosticoCanal = {
  id: "email" | "drive" | "pncp" | "govbr" | "agu" | "lgpd";
  titulo: string;
  status: StatusCanalIntegracao;
  badge: string;
  detalhe: string;
};

export function diagnosticarIntegracoesSecretaria(config: {
  email_provider: string;
  email_from_address?: string | null | undefined;
  has_smtp_secret?: boolean | undefined;
  has_email_api_secret?: boolean | undefined;
  drive_enabled?: boolean | undefined;
  has_drive_refresh_token?: boolean | undefined;
  pncp_enabled?: boolean | undefined;
  pncp_environment?: string | undefined;
  govbr_enabled?: boolean | undefined;
  govbr_environment?: string | undefined;
  agu_assistant_enabled?: boolean | undefined;
  retention_approved_at?: string | null | undefined;
}): DiagnosticoCanal[] {
  // 1. E-mail
  let emailStatus: StatusCanalIntegracao = "desativado";
  let emailBadge = "Não configurado";
  let emailDetalhe = "Alertas automáticos desativados";
  if (config.email_provider === "smtp_gateway" && config.has_smtp_secret) {
    emailStatus = "ativo";
    emailBadge = "SMTP Ativo";
    emailDetalhe = config.email_from_address || "Servidor SMTP próprio";
  } else if (config.email_provider === "resend" && config.has_email_api_secret) {
    emailStatus = "ativo";
    emailBadge = "Resend API";
    emailDetalhe = config.email_from_address || "Disparo via API";
  } else if (config.email_provider !== "none") {
    emailStatus = "parcial";
    emailBadge = "Pendente";
    emailDetalhe = "Credenciais incompletas";
  }

  // 2. Google Drive
  let driveStatus: StatusCanalIntegracao = "desativado";
  let driveBadge = "Inativo";
  let driveDetalhe = "Backup local no servidor";
  if (config.has_drive_refresh_token) {
    driveStatus = "ativo";
    driveBadge = "Conectado";
    driveDetalhe = "Sincronização manual autorizada";
  } else if (config.drive_enabled) {
    driveStatus = "parcial";
    driveBadge = "Autorização pendente";
    driveDetalhe = "Aguardando login Google";
  }

  // 3. PNCP
  let pncpStatus: StatusCanalIntegracao = "desativado";
  let pncpBadge = "Manual";
  let pncpDetalhe = "Gera arquivos para upload";
  if (config.pncp_enabled) {
    pncpStatus = config.pncp_environment === "producao" ? "ativo" : "homologacao";
    pncpBadge = config.pncp_environment === "producao" ? "Produção PNCP" : "Treinamento PNCP";
    pncpDetalhe = "Envio direto via API";
  }

  // 4. Gov.br
  let govbrStatus: StatusCanalIntegracao = "desativado";
  let govbrBadge = "Padrão Nativo";
  let govbrDetalhe = "Assinatura eletrônica SHA-256";
  if (config.govbr_enabled) {
    govbrStatus = config.govbr_environment === "producao" ? "ativo" : "homologacao";
    govbrBadge = config.govbr_environment === "producao" ? "Gov.br Ativo" : "Gov.br Homologação";
    govbrDetalhe = "Assinatura com conta Prata/Ouro";
  }

  // 5. Assistente AGU
  const aguStatus: StatusCanalIntegracao = config.agu_assistant_enabled ? "ativo" : "desativado";
  const aguBadge = config.agu_assistant_enabled ? "Habilitado" : "Desativado";
  const aguDetalhe = config.agu_assistant_enabled
    ? "Cláusulas orientativas ativas"
    : "Modelos municipais padrão";

  // 6. LGPD
  const lgpdStatus: StatusCanalIntegracao = config.retention_approved_at ? "ativo" : "parcial";
  const lgpdBadge = config.retention_approved_at ? "Aprovada" : "Em elaboração";
  const lgpdDetalhe = config.retention_approved_at
    ? "Política formal homologada"
    : "Definição de prazos pendente";

  return [
    { id: "email", titulo: "E-mail & Alertas", status: emailStatus, badge: emailBadge, detalhe: emailDetalhe },
    { id: "drive", titulo: "Google Drive (GED)", status: driveStatus, badge: driveBadge, detalhe: driveDetalhe },
    { id: "pncp", titulo: "Portal PNCP", status: pncpStatus, badge: pncpBadge, detalhe: pncpDetalhe },
    { id: "govbr", titulo: "Assinatura Gov.br", status: govbrStatus, badge: govbrBadge, detalhe: govbrDetalhe },
    { id: "agu", titulo: "Assistente AGU", status: aguStatus, badge: aguBadge, detalhe: aguDetalhe },
    { id: "lgpd", titulo: "Conformidade LGPD", status: lgpdStatus, badge: lgpdBadge, detalhe: lgpdDetalhe },
  ];
}
