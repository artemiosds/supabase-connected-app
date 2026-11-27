// =============================================================================
// document-expiry-cockpit-helper.ts — Motor Unificado de Vencimentos (Lei 14.133)
// Primus Gestão — Unifica Certidões de Fornecedores + Contratos/Atas Vigentes
// =============================================================================

export type TipoItemVencimento = "certidao_fornecedor" | "contrato_ata";

export type NivelUrgenciaVencimento =
  | "critico"      // Já vencido (< 0 dias)
  | "urgente"      // 0 a 30 dias (Lei 14.133: ação imediata de aditivo ou renovação)
  | "atencao"      // 31 a 60 dias (abertura de processo de prorrogação ou notificação)
  | "planejamento" // 61 a 120 dias (preparação documental)
  | "regular"      // > 120 dias ou sem prazo crítico
  | "indeterminado";

export type ItemVencimentoUnificado = {
  id: string;
  tipo: TipoItemVencimento;
  titulo: string;
  identificador: string; // Ex: "Contrato nº 12/2026" ou "CND Federal"
  fornecedorNome: string;
  fornecedorId: string | null;
  cnpjFornecedor?: string | null | undefined;
  dataEmissao: string | null;
  dataVencimento: string | null;
  diasRestantes: number | null;
  nivelUrgencia: NivelUrgenciaVencimento;
  rotuloStatus: string; // Ex: "Vencido há 5 dias", "Vence hoje", "Vence em 12 dias", "Vigente (180 dias)"
  origemId: string;
  linkDestino: string; // Ex: "/documentos" ou "/contratos"
  metadadosExtras?: {
    instrumentType?: string | null | undefined;
    documentType?: string | null | undefined;
    totalValue?: number | null | undefined;
    storageProvider?: string | null | undefined;
    externalUrl?: string | null | undefined;
  };
};

export type MetricasCockpitVencimentos = {
  totalItens: number;
  totalVencidos: number;
  totalUrgentes30d: number;
  totalAtencao60d: number;
  totalPlanejamento120d: number;
  totalRegulares: number;
  totalContratos: number;
  totalCertidoes: number;
};

const ORDEM_URGENCIA: Record<NivelUrgenciaVencimento, number> = {
  critico: 0,
  urgente: 1,
  atencao: 2,
  planejamento: 3,
  regular: 4,
  indeterminado: 5,
};

const STATUS_CONTRATO_INATIVOS = new Set(["encerrado", "cancelado", "rescindido", "arquivado"]);

/**
 * Calcula a diferença em dias inteiros entre a data de vencimento (YYYY-MM-DD ou ISO)
 * e a data de referência `hoje`, normalizadas para 00:00:00 UTC.
 */
export function calcularDiasAteData(dataIso: string | null | undefined, hoje = new Date()): number | null {
  if (!dataIso || typeof dataIso !== "string") return null;
  const trimmed = dataIso.trim();
  if (!trimmed) return null;

  const matchDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  let alvoUtcMs: number;
  if (matchDate) {
    const ano = Number(matchDate[1]);
    const mes = Number(matchDate[2]);
    const dia = Number(matchDate[3]);
    const parsed = new Date(Date.UTC(ano, mes - 1, dia));
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.getUTCFullYear() !== ano ||
      parsed.getUTCMonth() + 1 !== mes ||
      parsed.getUTCDate() !== dia
    ) {
      return null;
    }
    alvoUtcMs = parsed.getTime();
  } else {
    const parsed = new Date(trimmed);
    if (!Number.isFinite(parsed.getTime())) return null;
    alvoUtcMs = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }

  const hojeUtcMs = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvoUtcMs - hojeUtcMs) / 86_400_000);
}

/**
 * Classifica o nível de urgência e gera rótulo legível para o servidor público
 * seguindo a régua de prazos da Lei nº 14.133/2021 (120 / 60 / 30 / 0 dias).
 */
export function classificarUrgenciaVencimento(diasRestantes: number | null): {
  nivel: NivelUrgenciaVencimento;
  rotulo: string;
} {
  if (diasRestantes === null || !Number.isFinite(diasRestantes)) {
    return { nivel: "indeterminado", rotulo: "Sem prazo definido" };
  }
  if (diasRestantes < 0) {
    const abs = Math.abs(diasRestantes);
    return {
      nivel: "critico",
      rotulo: `Vencido há ${abs} dia${abs === 1 ? "" : "s"}`,
    };
  }
  if (diasRestantes === 0) {
    return { nivel: "urgente", rotulo: "Vence hoje" };
  }
  if (diasRestantes <= 30) {
    return {
      nivel: "urgente",
      rotulo: `Vence em ${diasRestantes} dia${diasRestantes === 1 ? "" : "s"}`,
    };
  }
  if (diasRestantes <= 60) {
    return { nivel: "atencao", rotulo: `Vence em ${diasRestantes} dias` };
  }
  if (diasRestantes <= 120) {
    return { nivel: "planejamento", rotulo: `Vence em ${diasRestantes} dias` };
  }
  return { nivel: "regular", rotulo: `Vigente (${diasRestantes} dias)` };
}

/**
 * Unifica certidões de fornecedores e contratos/atas ativos em uma fila única
 * ordenada por criticidade (vencidos e mais próximos do vencimento no topo).
 */
export function compilarItensVencimentoUnificados(params: {
  documentosFornecedor: Array<{
    id: string;
    title: string;
    document_type?: string | null | undefined;
    supplier_id: string;
    issue_date?: string | null | undefined;
    expires_at?: string | null | undefined;
    storage_provider?: string | null | undefined;
    external_url?: string | null | undefined;
  }>;
  contratos: Array<{
    id: string;
    number: string;
    object?: string | null | undefined;
    supplier_id?: string | null | undefined;
    status: string;
    instrument_type?: string | null | undefined;
    total_value?: number | null | undefined;
    start_date?: string | null | undefined;
    end_date?: string | null | undefined;
  }>;
  fornecedores: Array<{
    id: string;
    legal_name?: string | null | undefined;
    trade_name?: string | null | undefined;
    cnpj?: string | null | undefined;
  }>;
  hoje?: Date | undefined;
}): ItemVencimentoUnificado[] {
  const refHoje = params.hoje ?? new Date();
  const fornecedoresMap = new Map(params.fornecedores.map((f) => [f.id, f]));

  const resolverFornecedor = (supplierId: string | null | undefined) => {
    if (!supplierId) {
      return { nome: "Fornecedor não identificado", cnpj: null };
    }
    const f = fornecedoresMap.get(supplierId);
    const nome = f?.trade_name?.trim() || f?.legal_name?.trim() || "Fornecedor não identificado";
    return { nome, cnpj: f?.cnpj ?? null };
  };

  const itens: ItemVencimentoUnificado[] = [];

  for (const doc of params.documentosFornecedor) {
    const { nome, cnpj } = resolverFornecedor(doc.supplier_id);
    const dataVencimento = doc.expires_at ?? null;
    const diasRestantes = calcularDiasAteData(dataVencimento, refHoje);
    const { nivel, rotulo } = classificarUrgenciaVencimento(diasRestantes);

    itens.push({
      id: `cert:${doc.id}`,
      tipo: "certidao_fornecedor",
      titulo: doc.title,
      identificador: doc.document_type?.trim() || "Certidão",
      fornecedorNome: nome,
      fornecedorId: doc.supplier_id,
      cnpjFornecedor: cnpj,
      dataEmissao: doc.issue_date ?? null,
      dataVencimento,
      diasRestantes,
      nivelUrgencia: nivel,
      rotuloStatus: rotulo,
      origemId: doc.id,
      linkDestino: "/documentos",
      metadadosExtras: {
        documentType: doc.document_type ?? null,
        storageProvider: doc.storage_provider ?? null,
        externalUrl: doc.external_url ?? null,
      },
    });
  }

  for (const contrato of params.contratos) {
    const statusNorm = (contrato.status ?? "").trim().toLowerCase();
    if (STATUS_CONTRATO_INATIVOS.has(statusNorm)) continue;

    const { nome, cnpj } = resolverFornecedor(contrato.supplier_id);
    const dataVencimento = contrato.end_date ?? null;
    const diasRestantes = calcularDiasAteData(dataVencimento, refHoje);
    const { nivel, rotulo } = classificarUrgenciaVencimento(diasRestantes);
    const prefixoInstrumento =
      contrato.instrument_type === "ata_registro_precos" ? "Ata nº" : "Contrato nº";

    itens.push({
      id: `ctr:${contrato.id}`,
      tipo: "contrato_ata",
      titulo: contrato.object?.trim() || "Contrato sem objeto",
      identificador: `${prefixoInstrumento} ${contrato.number}`,
      fornecedorNome: nome,
      fornecedorId: contrato.supplier_id ?? null,
      cnpjFornecedor: cnpj,
      dataEmissao: contrato.start_date ?? null,
      dataVencimento,
      diasRestantes,
      nivelUrgencia: nivel,
      rotuloStatus: rotulo,
      origemId: contrato.id,
      linkDestino: "/contratos",
      metadadosExtras: {
        instrumentType: contrato.instrument_type ?? null,
        totalValue: contrato.total_value ?? null,
      },
    });
  }

  itens.sort((a, b) => {
    const diffOrdem = ORDEM_URGENCIA[a.nivelUrgencia] - ORDEM_URGENCIA[b.nivelUrgencia];
    if (diffOrdem !== 0) return diffOrdem;
    if (a.diasRestantes !== null && b.diasRestantes !== null) {
      const diffDias = a.diasRestantes - b.diasRestantes;
      if (diffDias !== 0) return diffDias;
    }
    return a.identificador.localeCompare(b.identificador, "pt-BR");
  });

  return itens;
}

/**
 * Apura as métricas consolidadas para os cards do Cockpit Unificado de Vencimentos.
 */
export function calcularMetricasCockpitVencimentos(
  itens: readonly ItemVencimentoUnificado[],
): MetricasCockpitVencimentos {
  let totalVencidos = 0;
  let totalUrgentes30d = 0;
  let totalAtencao60d = 0;
  let totalPlanejamento120d = 0;
  let totalRegulares = 0;
  let totalContratos = 0;
  let totalCertidoes = 0;

  for (const item of itens) {
    if (item.tipo === "contrato_ata") totalContratos += 1;
    else totalCertidoes += 1;

    switch (item.nivelUrgencia) {
      case "critico":
        totalVencidos += 1;
        break;
      case "urgente":
        totalUrgentes30d += 1;
        break;
      case "atencao":
        totalAtencao60d += 1;
        break;
      case "planejamento":
        totalPlanejamento120d += 1;
        break;
      case "regular":
        totalRegulares += 1;
        break;
      case "indeterminado":
        break;
    }
  }

  return {
    totalItens: itens.length,
    totalVencidos,
    totalUrgentes30d,
    totalAtencao60d,
    totalPlanejamento120d,
    totalRegulares,
    totalContratos,
    totalCertidoes,
  };
}

// =============================================================================
// Ficha de Conformidade de Habilitação Fiscal e Trabalhista (Art. 68, Lei 14.133)
// =============================================================================

export const CERTIDOES_ESSENCIAIS_ART68 = [
  {
    tipo: "certidao_federal",
    rotulo: "CND Federal / PGFN",
    rotuloCurto: "Federal",
    fundamento: "Lei nº 14.133/2021, art. 68, III",
  },
  {
    tipo: "certidao_estadual",
    rotulo: "CND Estadual",
    rotuloCurto: "Estadual",
    fundamento: "Lei nº 14.133/2021, art. 68, III",
  },
  {
    tipo: "certidao_municipal",
    rotulo: "CND Municipal",
    rotuloCurto: "Municipal",
    fundamento: "Lei nº 14.133/2021, art. 68, III",
  },
  {
    tipo: "fgts",
    rotulo: "CRF / FGTS",
    rotuloCurto: "FGTS",
    fundamento: "Lei nº 14.133/2021, art. 68, IV",
  },
  {
    tipo: "trabalhista",
    rotulo: "CNDT Trabalhista",
    rotuloCurto: "CNDT",
    fundamento: "Lei nº 14.133/2021, art. 68, V",
  },
] as const;

export type TipoCertidaoEssencial = (typeof CERTIDOES_ESSENCIAIS_ART68)[number]["tipo"];
export type StatusCertidaoHabilitacao = "regular" | "a_vencer" | "vencida" | "ausente";

export type ItemCertidaoHabilitacao = {
  tipo: TipoCertidaoEssencial;
  rotulo: string;
  rotuloCurto: string;
  fundamento: string;
  status: StatusCertidaoHabilitacao;
  expiresAt: string | null;
  diasRestantes: number | null;
  documentId: string | null;
};

export type FichaConformidadeFornecedor = {
  fornecedorId: string;
  fornecedorNome: string;
  cnpj: string | null;
  aptoParaEmpenhoPagamento: boolean;
  totalRegulares: number;
  totalEssenciais: number;
  resumoPendencias: string[];
  certidoes: ItemCertidaoHabilitacao[];
};

/**
 * Avalia a regularidade fiscal, previdenciária e trabalhista (art. 68 da Lei nº 14.133/2021)
 * para verificação prévia a empenho, liquidação e pagamento na Saúde.
 */
export function avaliarConformidadeHabilitacaoFornecedores(params: {
  fornecedores: Array<{
    id: string;
    legal_name?: string | null | undefined;
    trade_name?: string | null | undefined;
    cnpj?: string | null | undefined;
  }>;
  documentosFornecedor: Array<{
    id: string;
    supplier_id: string;
    document_type?: string | null | undefined;
    expires_at?: string | null | undefined;
  }>;
  hoje?: Date | undefined;
}): FichaConformidadeFornecedor[] {
  const refHoje = params.hoje ?? new Date();
  const docsPorFornecedor = new Map<string, typeof params.documentosFornecedor>();

  for (const doc of params.documentosFornecedor) {
    const lista = docsPorFornecedor.get(doc.supplier_id) ?? [];
    lista.push(doc);
    docsPorFornecedor.set(doc.supplier_id, lista);
  }

  const fichas: FichaConformidadeFornecedor[] = [];

  for (const fornecedor of params.fornecedores) {
    const docs = docsPorFornecedor.get(fornecedor.id) ?? [];
    const nome =
      fornecedor.trade_name?.trim() ||
      fornecedor.legal_name?.trim() ||
      "Fornecedor não identificado";
    const resumoPendencias: string[] = [];
    let totalRegulares = 0;

    const certidoes: ItemCertidaoHabilitacao[] = CERTIDOES_ESSENCIAIS_ART68.map((essencial) => {
      const correspondentes = docs.filter((d) => d.document_type === essencial.tipo);
      if (correspondentes.length === 0) {
        resumoPendencias.push(`${essencial.rotuloCurto}: ausente`);
        return {
          tipo: essencial.tipo,
          rotulo: essencial.rotulo,
          rotuloCurto: essencial.rotuloCurto,
          fundamento: essencial.fundamento,
          status: "ausente",
          expiresAt: null,
          diasRestantes: null,
          documentId: null,
        };
      }

      // Seleciona a certidão mais recente / com maior validade
      const melhor = [...correspondentes].sort((a, b) => {
        if (!a.expires_at && !b.expires_at) return 0;
        if (!a.expires_at) return -1;
        if (!b.expires_at) return 1;
        return b.expires_at.localeCompare(a.expires_at);
      })[0]!;

      const dias = calcularDiasAteData(melhor.expires_at ?? null, refHoje);
      let status: StatusCertidaoHabilitacao = "regular";
      if (dias !== null && dias < 0) {
        status = "vencida";
        resumoPendencias.push(`${essencial.rotuloCurto}: vencida`);
      } else if (dias !== null && dias <= 30) {
        status = "a_vencer";
        totalRegulares += 1;
      } else {
        status = "regular";
        totalRegulares += 1;
      }

      return {
        tipo: essencial.tipo,
        rotulo: essencial.rotulo,
        rotuloCurto: essencial.rotuloCurto,
        fundamento: essencial.fundamento,
        status,
        expiresAt: melhor.expires_at ?? null,
        diasRestantes: dias,
        documentId: melhor.id,
      };
    });

    fichas.push({
      fornecedorId: fornecedor.id,
      fornecedorNome: nome,
      cnpj: fornecedor.cnpj ?? null,
      aptoParaEmpenhoPagamento: totalRegulares === CERTIDOES_ESSENCIAIS_ART68.length,
      totalRegulares,
      totalEssenciais: CERTIDOES_ESSENCIAIS_ART68.length,
      resumoPendencias,
      certidoes,
    });
  }

  fichas.sort((a, b) => {
    if (a.aptoParaEmpenhoPagamento !== b.aptoParaEmpenhoPagamento) {
      return a.aptoParaEmpenhoPagamento ? 1 : -1;
    }
    return a.fornecedorNome.localeCompare(b.fornecedorNome, "pt-BR");
  });

  return fichas;
}
