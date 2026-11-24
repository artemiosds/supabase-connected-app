// =============================================================================
// admin-master-helper.ts — Filtros, Agregações e Gráficos do Painel Master
// Primus Gestão — Backoffice SaaS
// =============================================================================

export interface MasterTenantLike {
  id: string;
  name: string;
  trade_name: string | null;
  slug: string;
  cnpj: string | null;
  municipality: string | null;
  state: string | null;
  commercial_status: string;
  plan_tier: string;
  monthly_fee: number | string;
}

export interface MasterAuditEventLike {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  tenant_id: string | null;
  created_at: string;
}

export interface AiUsageRowLike {
  tenant_id: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface AiTenantUsageSummary {
  requests: number;
  tokens: number;
  costUsd: number;
}

export function filtrarClientesMaster<T extends MasterTenantLike>(
  tenants: T[],
  filtros: { busca?: string; status?: string; plano?: string },
): T[] {
  const termo = (filtros.busca ?? "").trim().toLowerCase();
  const termoDigits = termo.replace(/\D/g, "");
  const status = filtros.status ?? "todos";
  const plano = filtros.plano ?? "todos";

  return tenants.filter((tenant) => {
    if (status !== "todos" && tenant.commercial_status !== status) return false;
    if (plano !== "todos" && tenant.plan_tier !== plano) return false;
    if (!termo) return true;

    const cnpjDigits = (tenant.cnpj ?? "").replace(/\D/g, "");
    const matchText = [
      tenant.name,
      tenant.trade_name ?? "",
      tenant.slug,
      tenant.municipality ?? "",
      tenant.state ?? "",
      tenant.cnpj ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return matchText.includes(termo) || (termoDigits.length >= 3 && cnpjDigits.includes(termoDigits));
  });
}

export function filtrarAuditoriaMaster<T extends MasterAuditEventLike>(
  events: T[],
  filtros: { busca?: string; acao?: string; entidade?: string },
): T[] {
  const termo = (filtros.busca ?? "").trim().toLowerCase();
  const acao = filtros.acao ?? "todas";
  const entidade = filtros.entidade ?? "todas";

  return events.filter((event) => {
    if (acao !== "todas" && event.action !== acao) return false;
    if (entidade !== "todas" && event.entity !== entidade) return false;
    if (!termo) return true;

    const text = [
      event.action,
      event.entity,
      event.entity_id ?? "",
      event.actor_id ?? "",
      event.tenant_id ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return text.includes(termo);
  });
}

export function agruparClientesPorPlano(
  tenants: MasterTenantLike[],
  planLabels: Record<string, string>,
): { plano: string; nome: string; clientes: number; mrr: number }[] {
  const order = ["basico", "profissional", "enterprise", "consorcio"];
  const map: Record<string, { clientes: number; mrr: number }> = {
    basico: { clientes: 0, mrr: 0 },
    profissional: { clientes: 0, mrr: 0 },
    enterprise: { clientes: 0, mrr: 0 },
    consorcio: { clientes: 0, mrr: 0 },
  };

  for (const tenant of tenants) {
    const key = tenant.plan_tier in map ? tenant.plan_tier : "profissional";
    map[key].clientes += 1;
    if (tenant.commercial_status === "active") {
      map[key].mrr += Number(tenant.monthly_fee ?? 0) || 0;
    }
  }

  return order.map((plano) => ({
    plano,
    nome: planLabels[plano] ?? plano,
    clientes: map[plano].clientes,
    mrr: map[plano].mrr,
  }));
}

export function agruparClientesPorStatus(
  tenants: MasterTenantLike[],
  statusLabels: Record<string, string>,
): { status: string; nome: string; quantidade: number }[] {
  const counts: Record<string, number> = {};
  for (const tenant of tenants) {
    const key = tenant.commercial_status || "active";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.entries(statusLabels)
    .map(([status, nome]) => ({
      status,
      nome,
      quantidade: counts[status] ?? 0,
    }))
    .filter((row) => row.quantidade > 0);
}

export function resumirUsoIaPorTenant(
  usageRows: AiUsageRowLike[],
): Record<string, AiTenantUsageSummary> {
  const resumo: Record<string, AiTenantUsageSummary> = {};
  for (const row of usageRows) {
    if (!row.tenant_id) continue;
    if (!resumo[row.tenant_id]) {
      resumo[row.tenant_id] = { requests: 0, tokens: 0, costUsd: 0 };
    }
    resumo[row.tenant_id].requests += Number(row.requests) || 0;
    resumo[row.tenant_id].tokens +=
      (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0);
    resumo[row.tenant_id].costUsd += Number(row.estimated_cost_usd) || 0;
  }
  return resumo;
}

export type PlatformPlanTier = "basico" | "profissional" | "enterprise" | "consorcio";

export interface PlatformPlanTemplate {
  id: PlatformPlanTier;
  name: string;
  description: string;
  default_monthly_fee: number;
  default_max_users: number;
  default_ai_monthly_budget_usd: number | null;
  default_ai_monthly_token_limit: number | null;
  default_modules: Record<string, boolean>;
  sort_order: number;
  is_active: boolean;
}

export const DEFAULT_PLATFORM_PLANS: PlatformPlanTemplate[] = [
  {
    id: "basico",
    name: "Básico",
    description:
      "Essencial para pequenas secretarias iniciarem o controle de fornecedores e processos.",
    default_monthly_fee: 990,
    default_max_users: 10,
    default_ai_monthly_budget_usd: 10,
    default_ai_monthly_token_limit: 2_000_000,
    default_modules: {
      fornecedores: true,
      documentos: true,
      processos: true,
      contratos: true,
      modelos: false,
      ged: false,
      auditoria: true,
      relatorios: true,
      pca: false,
    },
    sort_order: 1,
    is_active: true,
  },
  {
    id: "profissional",
    name: "Profissional",
    description: "Plano padrão completo com modelos oficiais, PCA e central de relatórios & BI.",
    default_monthly_fee: 1990,
    default_max_users: 25,
    default_ai_monthly_budget_usd: 30,
    default_ai_monthly_token_limit: 8_000_000,
    default_modules: {
      fornecedores: true,
      documentos: true,
      processos: true,
      contratos: true,
      modelos: true,
      ged: false,
      auditoria: true,
      relatorios: true,
      pca: true,
    },
    sort_order: 2,
    is_active: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Operação avançada com GED completo, maior limite de usuários e cota ampliada de IA.",
    default_monthly_fee: 3990,
    default_max_users: 80,
    default_ai_monthly_budget_usd: 100,
    default_ai_monthly_token_limit: 30_000_000,
    default_modules: {
      fornecedores: true,
      documentos: true,
      processos: true,
      contratos: true,
      modelos: true,
      ged: true,
      auditoria: true,
      relatorios: true,
      pca: true,
    },
    sort_order: 3,
    is_active: true,
  },
  {
    id: "consorcio",
    name: "Consórcio",
    description:
      "Estrutura dedicada para consórcios intermunicipais e redes com múltiplos gestores.",
    default_monthly_fee: 6500,
    default_max_users: 200,
    default_ai_monthly_budget_usd: 200,
    default_ai_monthly_token_limit: 60_000_000,
    default_modules: {
      fornecedores: true,
      documentos: true,
      processos: true,
      contratos: true,
      modelos: true,
      ged: true,
      auditoria: true,
      relatorios: true,
      pca: true,
    },
    sort_order: 4,
    is_active: true,
  },
];

export function aplicarTemplatePlanoNoDraft<
  T extends {
    plan_tier: string;
    monthly_fee: number;
    max_users: number;
    enabled_modules: Record<string, boolean>;
    ai_monthly_budget_usd?: number | null;
    ai_monthly_token_limit?: number | null;
  },
>(draft: T, plan: PlatformPlanTemplate): T {
  return {
    ...draft,
    plan_tier: plan.id,
    monthly_fee: Number(plan.default_monthly_fee) || 0,
    max_users: Number(plan.default_max_users) || 20,
    enabled_modules: {
      ...draft.enabled_modules,
      ...plan.default_modules,
    },
    ...("ai_monthly_budget_usd" in draft
      ? { ai_monthly_budget_usd: plan.default_ai_monthly_budget_usd }
      : {}),
    ...("ai_monthly_token_limit" in draft
      ? { ai_monthly_token_limit: plan.default_ai_monthly_token_limit }
      : {}),
  };
}

export function avaliarCotaIa(
  costUsd: number,
  tokens: number,
  budgetUsd: number | null | undefined,
  tokenLimit: number | null | undefined,
): {
  costPct: number | null;
  tokenPct: number | null;
  exceeded: boolean;
  nearLimit: boolean;
} {
  const costPct =
    budgetUsd != null && budgetUsd > 0
      ? Math.min(999, Math.round((costUsd / budgetUsd) * 100))
      : null;
  const tokenPct =
    tokenLimit != null && tokenLimit > 0
      ? Math.min(999, Math.round((tokens / tokenLimit) * 100))
      : null;
  const exceeded =
    (costPct !== null && costPct >= 100) || (tokenPct !== null && tokenPct >= 100);
  const nearLimit =
    !exceeded && ((costPct !== null && costPct >= 80) || (tokenPct !== null && tokenPct >= 80));
  return { costPct, tokenPct, exceeded, nearLimit };
}
