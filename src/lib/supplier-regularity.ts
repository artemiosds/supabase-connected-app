import { db } from "@/lib/db";

export type RegularitySource =
  | "rfb_cnpj"
  | "ceis_cgu"
  | "cnep_cgu"
  | "tst_cndt"
  | "caixa_fgts"
  | "sefaz_estadual"
  | "pref_municipal"
  | "anvisa_afe"
  | "outro";

export type RegularityStatus =
  | "regular"
  | "irregular"
  | "pending_review"
  | "not_found"
  | "exempt";

export type SupplierRegularityCheck = {
  id: string;
  tenant_id: string;
  supplier_id: string;
  source: RegularitySource;
  source_label: string;
  checked_at: string;
  status: RegularityStatus;
  certificate_number: string | null;
  valid_until: string | null;
  evidence_url: string | null;
  evidence_storage_path: string | null;
  notes: string | null;
  requires_action: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const FONTES_OFICIAIS: Record<
  RegularitySource,
  { label: string; url: string; description: string }
> = {
  rfb_cnpj: {
    label: "Receita Federal (CNPJ)",
    url: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpjreva_solicitacao.asp",
    description: "Comprovante de Inscrição e Situação Cadastral da RFB.",
  },
  ceis_cgu: {
    label: "CEIS (CGU)",
    url: "https://portaldatransparencia.gov.br/sancoes/consulta",
    description: "Cadastro Nacional de Empresas Inidôneas e Suspensas.",
  },
  cnep_cgu: {
    label: "CNEP (CGU)",
    url: "https://portaldatransparencia.gov.br/sancoes/consulta",
    description: "Cadastro Nacional de Empresas Punidas (Lei Anticorrupção).",
  },
  tst_cndt: {
    label: "CNDT (Tribunal Superior do Trabalho)",
    url: "https://cndt-certidao.tst.jus.br/inicio.faces",
    description: "Certidão Negativa de Débitos Trabalhistas.",
  },
  caixa_fgts: {
    label: "FGTS / CRF (Caixa Econômica)",
    url: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
    description: "Certificado de Regularidade do FGTS.",
  },
  sefaz_estadual: {
    label: "Fazenda Estadual (SEFAZ)",
    url: "",
    description: "Certidão Negativa de Débitos Tributários Estaduais.",
  },
  pref_municipal: {
    label: "Prefeitura Municipal",
    url: "",
    description: "Certidão de Regularidade Fiscal Mobiliária/Imobiliária do Município.",
  },
  anvisa_afe: {
    label: "Anvisa (AFE / Regularidade Sanitária)",
    url: "https://consultas.anvisa.gov.br/#/empresas/",
    description: "Autorização de Funcionamento de Empresa e Licenças Sanitárias.",
  },
  outro: {
    label: "Outra Fonte Oficial",
    url: "",
    description: "Outro órgão fiscalizador, tribunal de contas ou entidade oficial.",
  },
};

export function rotuloStatusRegularidade(status: RegularityStatus): {
  label: string;
  badgeVariant: "default" | "secondary" | "outline" | "destructive";
  colorClass: string;
} {
  switch (status) {
    case "regular":
      return {
        label: "Regular / Nada Consta",
        badgeVariant: "default",
        colorClass: "text-emerald-700 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300",
      };
    case "irregular":
      return {
        label: "Irregular / Consta Ocorrência",
        badgeVariant: "destructive",
        colorClass: "text-rose-700 bg-rose-100 dark:bg-rose-950 dark:text-rose-300 border-rose-300 font-semibold",
      };
    case "pending_review":
      return {
        label: "Em Análise / Divergência",
        badgeVariant: "outline",
        colorClass: "text-amber-700 bg-amber-100 dark:bg-amber-950 dark:text-amber-300 border-amber-300",
      };
    case "not_found":
      return {
        label: "Não Localizado",
        badgeVariant: "secondary",
        colorClass: "text-muted-foreground bg-muted border-border",
      };
    case "exempt":
      return {
        label: "Dispensado / Não Aplicável",
        badgeVariant: "outline",
        colorClass: "text-muted-foreground bg-muted/50 border-border",
      };
    default:
      return {
        label: status,
        badgeVariant: "secondary",
        colorClass: "text-muted-foreground bg-muted",
      };
  }
}

export async function listarVerificacoesRegularidade(
  tenantId: string,
  supplierId: string,
): Promise<SupplierRegularityCheck[]> {
  const { data, error } = await db
    .from("supplier_regularity_checks")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("supplier_id", supplierId)
    .order("checked_at", { ascending: false });

  if (error) throw error;
  return (data as unknown as SupplierRegularityCheck[]) ?? [];
}

export async function registrarVerificacaoRegularidade(params: {
  tenantId: string;
  supplierId: string;
  source: RegularitySource;
  sourceLabel?: string;
  status: RegularityStatus;
  certificateNumber?: string;
  validUntil?: string | null;
  evidenceUrl?: string;
  notes?: string;
  requiresAction?: boolean;
}): Promise<string> {
  const sourceInfo = FONTES_OFICIAIS[params.source];
  const sourceLabel = params.sourceLabel || sourceInfo?.label || "Fonte Oficial";

  const { data, error } = await db.rpc("record_supplier_regularity_check", {
    p_tenant_id: params.tenantId,
    p_supplier_id: params.supplierId,
    p_source: params.source,
    p_source_label: sourceLabel,
    p_status: params.status,
    p_certificate_number: params.certificateNumber || null,
    p_valid_until: params.validUntil || null,
    p_evidence_url: params.evidenceUrl || null,
    p_notes: params.notes || null,
    p_requires_action: Boolean(params.requiresAction),
  });

  if (error) throw error;
  return data as string;
}
