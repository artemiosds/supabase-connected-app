export type PncpValidationSeverity = "blocker" | "warning" | "ok";

export type PncpValidationItem = {
  field: string;
  label: string;
  severity: PncpValidationSeverity;
  message: string;
};

export type PncpReadinessStatus = "ready" | "ready_with_warnings" | "blocked";

export type PncpValidationResult = {
  status: PncpReadinessStatus;
  blockers: PncpValidationItem[];
  warnings: PncpValidationItem[];
  checks: PncpValidationItem[];
  payload: Record<string, unknown>;
};

export type PncpTenantInfo = {
  name: string;
  cnpj?: string | null | undefined;
  ibge_code?: string | null | undefined;
  municipality?: string | null | undefined;
  state?: string | null | undefined;
};

export type PncpContractInput = {
  id: string;
  number: string;
  object: string;
  instrument_type: string;
  modality: string;
  start_date: string;
  end_date: string;
  total_value: number;
  status: string;
  manager_name?: string | null | undefined;
  inspector_name?: string | null | undefined;
  ordinance?: string | null | undefined;
  process_number?: string | null | undefined;
  supplier_name?: string | null | undefined;
  supplier_tax_id?: string | null | undefined;
  amendments?: Array<{
    id: string;
    number: string;
    kind: string;
    signed_at: string;
    new_end_date?: string | null | undefined;
    value_change: number;
    notes?: string | null | undefined;
  }>;
};

export type PncpProcessInput = {
  id: string;
  number: string;
  title: string;
  description?: string | null | undefined;
  modality: string;
  stage: string;
  status: string;
  estimated_value?: number | null | undefined;
  responsible_name?: string | null | undefined;
  items?: Array<{
    line_number: number;
    description: string;
    unit: string;
    quantity: number;
    estimated_unit_price?: number | null | undefined;
    estimated_total?: number | null | undefined;
  }>;
};

export type PncpPcaInput = {
  year: number;
  totalDemands: number;
  approvedDemands: number;
  items: Array<{
    description: string;
    unit: string;
    totalQuantity: number;
    sourceDemandsCount: number;
    valorEstimadoTotal?: number | null | undefined;
  }>;
};

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function mapModalidadePncp(modality: string): {
  codigo: number;
  nome: string;
  amparoLegalId: number;
} {
  const norm = modality.trim().toLowerCase();
  if (norm.includes("pregao") || norm.includes("pregão")) {
    return { codigo: 6, nome: "Pregão - Eletrônico", amparoLegalId: 1 };
  }
  if (norm.includes("dispensa")) {
    return { codigo: 8, nome: "Dispensa de Licitação", amparoLegalId: 19 };
  }
  if (norm.includes("inexigibilidade")) {
    return { codigo: 9, nome: "Inexigibilidade", amparoLegalId: 13 };
  }
  if (norm.includes("concorrencia") || norm.includes("concorrência")) {
    return { codigo: 4, nome: "Concorrência - Eletrônica", amparoLegalId: 2 };
  }
  if (norm.includes("credenciamento")) {
    return { codigo: 12, nome: "Credenciamento", amparoLegalId: 14 };
  }
  if (norm.includes("adesao") || norm.includes("adesão") || norm.includes("arp")) {
    return { codigo: 10, nome: "Adesão a Ata de Registro de Preços", amparoLegalId: 1 };
  }
  return { codigo: 6, nome: modality || "Pregão - Eletrônico", amparoLegalId: 1 };
}

export function mapTipoContratoPncp(instrumentType: string): {
  codigo: number;
  nome: string;
} {
  const norm = instrumentType.trim().toLowerCase();
  if (norm.includes("ata") || norm === "arp") {
    return { codigo: 4, nome: "Ata de Registro de Preços" };
  }
  if (norm.includes("aditivo")) {
    return { codigo: 2, nome: "Termo Aditivo" };
  }
  if (norm.includes("ordem") || norm.includes("empenho") || norm.includes("nota")) {
    return { codigo: 3, nome: "Nota de Empenho / Ordem de Fornecimento" };
  }
  return { codigo: 1, nome: "Contrato (termo inicial)" };
}

function summarizeChecks(checks: PncpValidationItem[]): PncpReadinessStatus {
  if (checks.some((c) => c.severity === "blocker")) return "blocked";
  if (checks.some((c) => c.severity === "warning")) return "ready_with_warnings";
  return "ready";
}

function extractYear(isoDate: string | null | undefined): number {
  if (isoDate && /^\d{4}/.test(isoDate)) {
    const parsed = Number(isoDate.slice(0, 4));
    if (Number.isFinite(parsed)) return parsed;
  }
  return new Date().getFullYear();
}

export function validarContratoPncp(
  tenant: PncpTenantInfo,
  contract: PncpContractInput,
): PncpValidationResult {
  const checks: PncpValidationItem[] = [];
  const orgCnpj = onlyDigits(tenant.cnpj);
  const supplierTaxId = onlyDigits(contract.supplier_tax_id);
  const modalityInfo = mapModalidadePncp(contract.modality);
  const tipoContrato = mapTipoContratoPncp(contract.instrument_type);

  checks.push(
    orgCnpj.length === 14
      ? {
          field: "tenant.cnpj",
          label: "CNPJ do órgão contratante",
          severity: "ok",
          message: `CNPJ ${orgCnpj} válido para envio ao PNCP.`,
        }
      : {
          field: "tenant.cnpj",
          label: "CNPJ do órgão contratante",
          severity: "blocker",
          message: "Cadastre o CNPJ (14 dígitos) da Secretaria em Configurações antes de exportar.",
        },
  );

  checks.push(
    contract.number.trim().length >= 1
      ? {
          field: "contract.number",
          label: "Número do instrumento",
          severity: "ok",
          message: `Instrumento nº ${contract.number}.`,
        }
      : {
          field: "contract.number",
          label: "Número do instrumento",
          severity: "blocker",
          message: "Número do contrato/ata obrigatório.",
        },
  );

  checks.push(
    contract.object.trim().length >= 15
      ? {
          field: "contract.object",
          label: "Objeto do contrato",
          severity: "ok",
          message: "Descrição do objeto com detalhamento adequado.",
        }
      : {
          field: "contract.object",
          label: "Objeto do contrato",
          severity: "blocker",
          message:
            "Descreva o objeto do contrato com pelo menos 15 caracteres (Lei 14.133, art. 94).",
        },
  );

  checks.push(
    supplierTaxId.length === 14 || supplierTaxId.length === 11
      ? {
          field: "supplier.cnpj",
          label: "CNPJ/CPF do contratado",
          severity: "ok",
          message: `Fornecedor identificado (${contract.supplier_name || supplierTaxId}).`,
        }
      : {
          field: "supplier.cnpj",
          label: "CNPJ/CPF do contratado",
          severity: "blocker",
          message: "O fornecedor contratado precisa possuir CNPJ (14) ou CPF (11) válido.",
        },
  );

  const validDates =
    Boolean(contract.start_date) &&
    Boolean(contract.end_date) &&
    contract.end_date >= contract.start_date;
  checks.push(
    validDates
      ? {
          field: "contract.dates",
          label: "Vigência inicial e final",
          severity: "ok",
          message: `Vigência de ${contract.start_date} até ${contract.end_date}.`,
        }
      : {
          field: "contract.dates",
          label: "Vigência inicial e final",
          severity: "blocker",
          message: "Data final de vigência deve ser igual ou posterior à data inicial.",
        },
  );

  checks.push(
    Number(contract.total_value) > 0
      ? {
          field: "contract.total_value",
          label: "Valor global",
          severity: "ok",
          message: `Valor global registrado: R$ ${Number(contract.total_value).toFixed(2)}.`,
        }
      : {
          field: "contract.total_value",
          label: "Valor global",
          severity: "blocker",
          message: "O valor global do contrato deve ser maior que zero.",
        },
  );

  if (!contract.manager_name?.trim() || !contract.inspector_name?.trim()) {
    checks.push({
      field: "contract.governance",
      label: "Gestor e Fiscal designados",
      severity: "warning",
      message:
        "Recomenda-se informar Gestor, Fiscal e Portaria de designação (art. 117, Lei 14.133).",
    });
  } else {
    checks.push({
      field: "contract.governance",
      label: "Gestor e Fiscal designados",
      severity: "ok",
      message: `Gestor: ${contract.manager_name} · Fiscal: ${contract.inspector_name}.`,
    });
  }

  if (!contract.process_number?.trim()) {
    checks.push({
      field: "contract.process_number",
      label: "Vínculo com processo de compra",
      severity: "warning",
      message: "Vincule o processo licitatório/dispensa para rastreabilidade completa no PNCP.",
    });
  }

  const amendments = contract.amendments ?? [];
  const payload = {
    padrao: "PNCP_API_CONTRATOS_V1",
    leiReferencia: "Lei nº 14.133/2021, arts. 94 e 174",
    geradoEm: new Date().toISOString(),
    orgaoEntidade: {
      cnpj: orgCnpj || null,
      razaoSocial: tenant.name,
      codigoIbge: tenant.ibge_code ?? null,
      municipio: tenant.municipality ?? null,
      uf: tenant.state ?? null,
    },
    contrato: {
      numeroContratoEmpenho: contract.number,
      anoContrato: extractYear(contract.start_date),
      tipoContratoId: tipoContrato.codigo,
      tipoContratoNome: tipoContrato.nome,
      modalidadeId: modalityInfo.codigo,
      modalidadeNome: modalityInfo.nome,
      amparoLegalId: modalityInfo.amparoLegalId,
      processo: contract.process_number ?? null,
      objetoContrato: contract.object,
      niFornecedor: supplierTaxId || null,
      tipoPessoaFornecedor: supplierTaxId.length === 11 ? "PF" : "PJ",
      nomeRazaoSocialFornecedor: contract.supplier_name ?? null,
      dataAssinatura: contract.start_date,
      dataVigenciaInicio: contract.start_date,
      dataVigenciaFim: contract.end_date,
      valorInicial: Number(contract.total_value),
      valorGlobal: Number(contract.total_value),
      situacao: contract.status,
      gestorContrato: contract.manager_name ?? null,
      fiscalContrato: contract.inspector_name ?? null,
      portariaDesignacao: contract.ordinance ?? null,
    },
    termosAditivos: amendments.map((ad, index) => ({
      numeroTermo: ad.number,
      sequencialTermo: index + 1,
      tipoTermo: ad.kind,
      dataAssinatura: ad.signed_at,
      novaDataVigenciaFim: ad.new_end_date ?? null,
      valorAcrescidoOuSuprimido: Number(ad.value_change),
      justificativa: ad.notes ?? null,
    })),
  };

  return {
    status: summarizeChecks(checks),
    blockers: checks.filter((c) => c.severity === "blocker"),
    warnings: checks.filter((c) => c.severity === "warning"),
    checks,
    payload,
  };
}

export function validarProcessoPncp(
  tenant: PncpTenantInfo,
  process: PncpProcessInput,
): PncpValidationResult {
  const checks: PncpValidationItem[] = [];
  const orgCnpj = onlyDigits(tenant.cnpj);
  const modalityInfo = mapModalidadePncp(process.modality);
  const items = process.items ?? [];

  checks.push(
    orgCnpj.length === 14
      ? {
          field: "tenant.cnpj",
          label: "CNPJ do órgão",
          severity: "ok",
          message: `CNPJ ${orgCnpj} válido.`,
        }
      : {
          field: "tenant.cnpj",
          label: "CNPJ do órgão",
          severity: "blocker",
          message: "Cadastre o CNPJ (14 dígitos) da Secretaria em Configurações.",
        },
  );

  checks.push(
    process.number.trim().length >= 1 && process.title.trim().length >= 10
      ? {
          field: "process.identity",
          label: "Número e objeto da contratação",
          severity: "ok",
          message: `Processo nº ${process.number} — ${process.title}.`,
        }
      : {
          field: "process.identity",
          label: "Número e objeto da contratação",
          severity: "blocker",
          message: "Número do processo e objeto (mínimo 10 caracteres) são obrigatórios.",
        },
  );

  checks.push(
    items.length > 0
      ? {
          field: "process.items",
          label: "Itens especificados",
          severity: "ok",
          message: `${items.length} item(ns) estruturado(s) para envio.`,
        }
      : {
          field: "process.items",
          label: "Itens especificados",
          severity: "blocker",
          message: "Cadastre ao menos 1 item no processo antes de exportar para o PNCP.",
        },
  );

  const estimated = Number(process.estimated_value ?? 0);
  checks.push(
    estimated > 0
      ? {
          field: "process.estimated_value",
          label: "Valor estimado da contratação",
          severity: "ok",
          message: `Valor estimado: R$ ${estimated.toFixed(2)}.`,
        }
      : {
          field: "process.estimated_value",
          label: "Valor estimado da contratação",
          severity: "warning",
          message: "Conclua e aprove a estimativa de preços na Matriz Comparativa (art. 23).",
        },
  );

  const payload = {
    padrao: "PNCP_API_CONTRATACOES_V1",
    leiReferencia: "Lei nº 14.133/2021, arts. 75 e 174",
    geradoEm: new Date().toISOString(),
    orgaoEntidade: {
      cnpj: orgCnpj || null,
      razaoSocial: tenant.name,
      codigoIbge: tenant.ibge_code ?? null,
      municipio: tenant.municipality ?? null,
      uf: tenant.state ?? null,
    },
    contratacao: {
      numeroCompra: process.number,
      anoCompra: new Date().getFullYear(),
      modalidadeId: modalityInfo.codigo,
      modalidadeNome: modalityInfo.nome,
      amparoLegalId: modalityInfo.amparoLegalId,
      objetoCompra: process.title,
      informacaoComplementar: process.description ?? null,
      valorTotalEstimado: estimated > 0 ? estimated : null,
      situacao: process.status,
      etapaInterna: process.stage,
      responsavel: process.responsible_name ?? null,
    },
    itens: items.map((item) => ({
      numeroItem: item.line_number,
      descricao: item.description,
      unidadeMedida: item.unit,
      quantidade: Number(item.quantity),
      valorUnitarioEstimado: item.estimated_unit_price ?? null,
      valorTotal: item.estimated_total ?? null,
    })),
  };

  return {
    status: summarizeChecks(checks),
    blockers: checks.filter((c) => c.severity === "blocker"),
    warnings: checks.filter((c) => c.severity === "warning"),
    checks,
    payload,
  };
}

export function validarPcaPncp(tenant: PncpTenantInfo, pca: PncpPcaInput): PncpValidationResult {
  const checks: PncpValidationItem[] = [];
  const orgCnpj = onlyDigits(tenant.cnpj);

  checks.push(
    orgCnpj.length === 14
      ? {
          field: "tenant.cnpj",
          label: "CNPJ do órgão",
          severity: "ok",
          message: `CNPJ ${orgCnpj} válido para publicação do PCA.`,
        }
      : {
          field: "tenant.cnpj",
          label: "CNPJ do órgão",
          severity: "blocker",
          message: "Cadastre o CNPJ (14 dígitos) da Secretaria em Configurações.",
        },
  );

  checks.push(
    pca.items.length > 0
      ? {
          field: "pca.items",
          label: "Itens consolidados no exercício",
          severity: "ok",
          message: `${pca.items.length} item(ns) consolidado(s) para o exercício ${pca.year}.`,
        }
      : {
          field: "pca.items",
          label: "Itens consolidados no exercício",
          severity: "blocker",
          message: "Registre ao menos uma demanda com itens para exportar o PCA.",
        },
  );

  checks.push(
    Number.isInteger(pca.year) && pca.year >= 2020 && pca.year <= 2100
      ? {
          field: "pca.year",
          label: "Exercício do PCA",
          severity: "ok",
          message: `Exercício ${pca.year} válido (Decreto nº 10.947/2022).`,
        }
      : {
          field: "pca.year",
          label: "Exercício do PCA",
          severity: "blocker",
          message: "Informe um exercício financeiro válido entre 2020 e 2100.",
        },
  );

  if (pca.totalDemands > 0 && pca.approvedDemands === 0) {
    checks.push({
      field: "pca.approvals",
      label: "Aprovação das demandas",
      severity: "blocker",
      message:
        "Ao menos uma demanda precisa estar aprovada pela autoridade competente antes de publicar o PCA no PNCP (art. 12, § 1º).",
    });
  } else if (pca.totalDemands > pca.approvedDemands) {
    checks.push({
      field: "pca.approvals",
      label: "Aprovação das demandas",
      severity: "warning",
      message: `${pca.totalDemands - pca.approvedDemands} demanda(s) ainda aguarda(m) aprovação ou revisão (apenas demandas aprovadas devem compor a publicação oficial).`,
    });
  } else if (pca.totalDemands > 0) {
    checks.push({
      field: "pca.approvals",
      label: "Aprovação das demandas",
      severity: "ok",
      message: "Todas as demandas do exercício estão aprovadas.",
    });
  }

  const valorTotalEstimado = pca.items.reduce((sum, item) => {
    const val = Number(item.valorEstimadoTotal ?? 0);
    return Number.isFinite(val) && val > 0 ? sum + val : sum;
  }, 0);

  const payload = {
    padrao: "PNCP_API_PCA_V1",
    leiReferencia: "Lei nº 14.133/2021, art. 12, § 1º; Decreto nº 10.947/2022",
    geradoEm: new Date().toISOString(),
    orgaoEntidade: {
      cnpj: orgCnpj || null,
      razaoSocial: tenant.name,
      codigoIbge: tenant.ibge_code ?? null,
      municipio: tenant.municipality ?? null,
      uf: tenant.state ?? null,
    },
    pca: {
      anoPca: pca.year,
      quantidadeDemandas: pca.totalDemands,
      demandasAprovadas: pca.approvedDemands,
      quantidadeItensConsolidados: pca.items.length,
      valorTotalEstimado: Math.round((valorTotalEstimado + Number.EPSILON) * 100) / 100,
    },
    itens: pca.items.map((item, index) => ({
      numeroItem: index + 1,
      descricao: item.description,
      unidadeMedida: item.unit,
      quantidadeTotal: Number(item.totalQuantity),
      valorTotalEstimado:
        item.valorEstimadoTotal != null && Number.isFinite(Number(item.valorEstimadoTotal))
          ? Math.round((Number(item.valorEstimadoTotal) + Number.EPSILON) * 100) / 100
          : null,
      demandasOrigem: item.sourceDemandsCount,
    })),
  };

  return {
    status: summarizeChecks(checks),
    blockers: checks.filter((c) => c.severity === "blocker"),
    warnings: checks.filter((c) => c.severity === "warning"),
    checks,
    payload,
  };
}
