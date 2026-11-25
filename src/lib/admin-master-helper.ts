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

    return (
      matchText.includes(termo) || (termoDigits.length >= 3 && cnpjDigits.includes(termoDigits))
    );
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
    const bucket = map[key];
    if (!bucket) continue;
    bucket.clientes += 1;
    if (tenant.commercial_status === "active") {
      bucket.mrr += Number(tenant.monthly_fee ?? 0) || 0;
    }
  }

  return order.map((plano) => {
    const bucket = map[plano];
    return {
      plano,
      nome: planLabels[plano] ?? plano,
      clientes: bucket?.clientes ?? 0,
      mrr: bucket?.mrr ?? 0,
    };
  });
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
    const item = (resumo[row.tenant_id] ??= { requests: 0, tokens: 0, costUsd: 0 });
    item.requests += Number(row.requests) || 0;
    item.tokens += (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0);
    item.costUsd += Number(row.estimated_cost_usd) || 0;
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
    description:
      "Operação avançada com GED completo, maior limite de usuários e cota ampliada de IA.",
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
  const exceeded = (costPct !== null && costPct >= 100) || (tokenPct !== null && tokenPct >= 100);
  const nearLimit =
    !exceeded && ((costPct !== null && costPct >= 80) || (tokenPct !== null && tokenPct >= 80));
  return { costPct, tokenPct, exceeded, nearLimit };
}

export interface PlatformInvoiceLike {
  id: string;
  tenant_id: string;
  reference_month: string;
  amount: number | string;
  due_date: string;
  status: string;
  payment_method: string;
  external_reference: string | null;
}

export function resumirFinanceiroFaturas(invoices: PlatformInvoiceLike[]): {
  totalPaid: number;
  totalPending: number;
  totalOverdue: number;
  countPaid: number;
  countPending: number;
  countOverdue: number;
} {
  let totalPaid = 0;
  let totalPending = 0;
  let totalOverdue = 0;
  let countPaid = 0;
  let countPending = 0;
  let countOverdue = 0;

  for (const inv of invoices) {
    const amount = Number(inv.amount ?? 0) || 0;
    if (inv.status === "paid") {
      totalPaid += amount;
      countPaid += 1;
    } else if (inv.status === "pending") {
      totalPending += amount;
      countPending += 1;
    } else if (inv.status === "overdue") {
      totalOverdue += amount;
      countOverdue += 1;
    }
  }

  return { totalPaid, totalPending, totalOverdue, countPaid, countPending, countOverdue };
}

export function filtrarFaturasMaster<T extends PlatformInvoiceLike>(
  invoices: T[],
  filtros: { status?: string; competencia?: string; busca?: string },
  tenantNamesById: Map<string, string>,
): T[] {
  const status = filtros.status ?? "todas";
  const competencia = (filtros.competencia ?? "").trim();
  const busca = (filtros.busca ?? "").trim().toLowerCase();

  return invoices.filter((inv) => {
    if (status !== "todas" && inv.status !== status) return false;
    if (competencia && inv.reference_month !== competencia) return false;
    if (!busca) return true;
    const tenantName = (tenantNamesById.get(inv.tenant_id) ?? "").toLowerCase();
    const ref = (inv.external_reference ?? "").toLowerCase();
    return tenantName.includes(busca) || ref.includes(busca) || inv.reference_month.includes(busca);
  });
}

export function agruparFaturasPorMes(
  invoices: PlatformInvoiceLike[],
): { mes: string; recebido: number; pendente: number; atrasado: number }[] {
  const map = new Map<string, { recebido: number; pendente: number; atrasado: number }>();

  for (const inv of invoices) {
    if (!inv.reference_month || inv.status === "cancelled") continue;
    const current = map.get(inv.reference_month) ?? { recebido: 0, pendente: 0, atrasado: 0 };
    const amount = Number(inv.amount ?? 0) || 0;
    if (inv.status === "paid") current.recebido += amount;
    else if (inv.status === "overdue") current.atrasado += amount;
    else if (inv.status === "pending") current.pendente += amount;
    map.set(inv.reference_month, current);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([mes, values]) => ({ mes, ...values }));
}

export interface TenantHealthAlert {
  id: string;
  tenantId: string;
  tenantName: string;
  kind: "overdue_invoice" | "trial_expiring" | "user_limit" | "ai_quota";
  severity: "high" | "medium";
  title: string;
  detail: string;
  targetTab: "cobranca" | "clientes" | "ia";
}

export function gerarAlertasSaudePlataforma(params: {
  tenants: Array<
    MasterTenantLike & {
      max_users: number;
      trial_ends_at?: string | null;
    }
  >;
  activeUsersByTenant: Record<string, number>;
  aiUsageByTenant: Record<string, AiTenantUsageSummary>;
  aiLimitsByTenant: Record<
    string,
    { monthly_budget_usd?: number | null; monthly_token_limit?: number | null }
  >;
  invoices: PlatformInvoiceLike[];
  nowMs?: number;
}): TenantHealthAlert[] {
  const now = params.nowMs ?? Date.now();
  const alerts: TenantHealthAlert[] = [];

  const overdueByTenant = new Map<string, { count: number; total: number }>();
  for (const inv of params.invoices) {
    if (inv.status !== "overdue") continue;
    const prev = overdueByTenant.get(inv.tenant_id) ?? { count: 0, total: 0 };
    prev.count += 1;
    prev.total += Number(inv.amount ?? 0) || 0;
    overdueByTenant.set(inv.tenant_id, prev);
  }

  for (const tenant of params.tenants) {
    const tenantName = tenant.trade_name || tenant.name;
    const overdue = overdueByTenant.get(tenant.id);
    if (overdue) {
      alerts.push({
        id: `overdue:${tenant.id}`,
        tenantId: tenant.id,
        tenantName,
        kind: "overdue_invoice",
        severity: "high",
        title: `${overdue.count} fatura(s) em atraso`,
        detail: `Total vencido de R$ ${overdue.total.toFixed(2).replace(".", ",")}`,
        targetTab: "cobranca",
      });
    }

    if (tenant.commercial_status === "trial" && tenant.trial_ends_at) {
      const diffMs = new Date(tenant.trial_ends_at).getTime() - now;
      if (diffMs > 0 && diffMs <= 7 * 86_400_000) {
        const days = Math.ceil(diffMs / 86_400_000);
        alerts.push({
          id: `trial:${tenant.id}`,
          tenantId: tenant.id,
          tenantName,
          kind: "trial_expiring",
          severity: days <= 2 ? "high" : "medium",
          title: `Trial vence em ${days} dia(s)`,
          detail: "Acompanhar conversão para plano pago",
          targetTab: "clientes",
        });
      }
    }

    const activeUsers = params.activeUsersByTenant[tenant.id] ?? 0;
    if (tenant.max_users > 0 && activeUsers / tenant.max_users >= 0.8) {
      const pct = Math.round((activeUsers / tenant.max_users) * 100);
      alerts.push({
        id: `users:${tenant.id}`,
        tenantId: tenant.id,
        tenantName,
        kind: "user_limit",
        severity: activeUsers >= tenant.max_users ? "high" : "medium",
        title: `Usuários em ${pct}% do limite (${activeUsers}/${tenant.max_users})`,
        detail: "Oportunidade de upgrade de plano",
        targetTab: "clientes",
      });
    }

    const aiUsage = params.aiUsageByTenant[tenant.id];
    const aiQuota = params.aiLimitsByTenant[tenant.id];
    const quota = avaliarCotaIa(
      aiUsage?.costUsd ?? 0,
      aiUsage?.tokens ?? 0,
      aiQuota?.monthly_budget_usd,
      aiQuota?.monthly_token_limit,
    );
    if (quota.exceeded || quota.nearLimit) {
      alerts.push({
        id: `ai:${tenant.id}`,
        tenantId: tenant.id,
        tenantName,
        kind: "ai_quota",
        severity: quota.exceeded ? "high" : "medium",
        title: quota.exceeded ? "Cota mensal de IA atingida" : "Consumo de IA acima de 80%",
        detail: `US$ ${(aiUsage?.costUsd ?? 0).toFixed(2)} · ${(aiUsage?.tokens ?? 0).toLocaleString("pt-BR")} tokens`,
        targetTab: "ia",
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return a.tenantName.localeCompare(b.tenantName);
  });
}

export interface TenantUsageCounts {
  suppliers_count: number;
  processes_count: number;
  contracts_count: number;
  documents_count: number;
}

export interface TenantRankingRow {
  tenantId: string;
  tenantName: string;
  planTier: string;
  commercialStatus: string;
  activeUsers: number;
  maxUsers: number;
  processes: number;
  contracts: number;
  suppliers: number;
  documents: number;
  aiRequests: number;
  aiCostUsd: number;
  score: number;
}

export function montarRankingSecretarias(params: {
  tenants: Array<MasterTenantLike & { max_users: number }>;
  activeUsersByTenant: Record<string, number>;
  aiUsageByTenant: Record<string, AiTenantUsageSummary>;
  usageByTenant: Record<string, TenantUsageCounts>;
}): TenantRankingRow[] {
  return params.tenants
    .map((tenant) => {
      const usage = params.usageByTenant[tenant.id] ?? {
        suppliers_count: 0,
        processes_count: 0,
        contracts_count: 0,
        documents_count: 0,
      };
      const ai = params.aiUsageByTenant[tenant.id] ?? { requests: 0, tokens: 0, costUsd: 0 };
      const activeUsers = params.activeUsersByTenant[tenant.id] ?? 0;
      const score =
        usage.processes_count * 3 +
        usage.contracts_count * 3 +
        usage.documents_count * 2 +
        usage.suppliers_count +
        activeUsers * 2 +
        ai.requests;

      return {
        tenantId: tenant.id,
        tenantName: tenant.trade_name || tenant.name,
        planTier: tenant.plan_tier,
        commercialStatus: tenant.commercial_status,
        activeUsers,
        maxUsers: tenant.max_users,
        processes: usage.processes_count,
        contracts: usage.contracts_count,
        suppliers: usage.suppliers_count,
        documents: usage.documents_count,
        aiRequests: ai.requests,
        aiCostUsd: ai.costUsd,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.tenantName.localeCompare(b.tenantName));
}
