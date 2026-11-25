import { useCallback, useEffect, useState } from "react";
import type { Json, Tables } from "@/integrations/supabase/types";
import { db } from "@/lib/db";
import {
  DEFAULT_PLATFORM_PLANS,
  resumirUsoIaPorTenant,
  type AiTenantUsageSummary,
  type PlatformPlanTemplate,
  type PlatformPlanTier,
  type TenantUsageCounts,
} from "@/lib/admin-master-helper";
import { useAuth } from "@/hooks/use-auth";

export type MasterTenant = Tables<"tenants">;
export type PlatformStaffAccess = {
  displayName: string;
  status: string;
  roleNames: string[];
  permissionCodes: string[];
};
export type MasterMetrics = {
  mrr_estimated: number;
  active_clients: number;
  trial_clients: number;
  trials_expiring_7d: number;
  blocked_clients: number;
  suspended_clients: number;
  cancelled_clients: number;
  contracts_total: number;
  processes_total: number;
  suppliers_total: number;
  audit_events_total: number;
};
export type AdminCandidate = {
  user_id: string;
  full_name: string;
  email: string;
};
export type MasterAuditEvent = Pick<
  Tables<"audit_events">,
  "id" | "actor_id" | "action" | "entity" | "entity_id" | "created_at" | "tenant_id"
> & { details: Json };

export type AiTenantSummary = {
  enabled: boolean;
  operational: boolean;
  allowedProvidersCount: number;
};

export type AiTenantQuota = {
  monthly_budget_usd: number | null;
  monthly_token_limit: number | null;
};

export type CommercialTenantInput = {
  trade_name: string;
  cnpj: string;
  municipality: string;
  state: string;
  ibge_code: string;
  manager_name: string;
  contact_email: string;
  contact_phone: string;
  commercial_status: string;
  plan_tier: string;
  trial_starts_at: string | null;
  trial_ends_at: string | null;
  monthly_fee: number;
  billing_day: number;
  billing_email: string;
  billing_contact: string;
  enabled_modules: Record<string, boolean>;
  max_users: number;
  commercial_notes: string;
  street: string;
};

const METRICS_EMPTY: MasterMetrics = {
  mrr_estimated: 0,
  active_clients: 0,
  trial_clients: 0,
  trials_expiring_7d: 0,
  blocked_clients: 0,
  suspended_clients: 0,
  cancelled_clients: 0,
  contracts_total: 0,
  processes_total: 0,
  suppliers_total: 0,
  audit_events_total: 0,
};

function parseMetrics(value: Json | null): MasterMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return METRICS_EMPTY;
  const record = value as Record<string, Json | undefined>;
  const number = (key: keyof MasterMetrics) => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  };
  return {
    mrr_estimated: number("mrr_estimated"),
    active_clients: number("active_clients"),
    trial_clients: number("trial_clients"),
    trials_expiring_7d: number("trials_expiring_7d"),
    blocked_clients: number("blocked_clients"),
    suspended_clients: number("suspended_clients"),
    cancelled_clients: number("cancelled_clients"),
    contracts_total: number("contracts_total"),
    processes_total: number("processes_total"),
    suppliers_total: number("suppliers_total"),
    audit_events_total: number("audit_events_total"),
  };
}

export function usePlatformAdmin() {
  const { session, loading: authLoading } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [staffAccess, setStaffAccess] = useState<PlatformStaffAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<MasterTenant[]>([]);
  const [metrics, setMetrics] = useState<MasterMetrics>(METRICS_EMPTY);
  const [candidates, setCandidates] = useState<AdminCandidate[]>([]);
  const [auditEvents, setAuditEvents] = useState<MasterAuditEvent[]>([]);
  const [activeUsersByTenant, setActiveUsersByTenant] = useState<Record<string, number>>({});
  const [aiEnabledByTenant, setAiEnabledByTenant] = useState<Record<string, AiTenantSummary>>({});
  const [aiUsageByTenant, setAiUsageByTenant] = useState<Record<string, AiTenantUsageSummary>>({});
  const [plans, setPlans] = useState<PlatformPlanTemplate[]>(DEFAULT_PLATFORM_PLANS);
  const [plansBackedByDatabase, setPlansBackedByDatabase] = useState(false);
  const [aiLimitsByTenant, setAiLimitsByTenant] = useState<Record<string, AiTenantQuota>>({});
  const [invoices, setInvoices] = useState<Tables<"platform_invoices">[]>([]);
  const [usageByTenant, setUsageByTenant] = useState<Record<string, TenantUsageCounts>>({});
  const userId = session?.user.id;
  const userEmail = session?.user.email;

  const load = useCallback(async () => {
    if (!userId) {
      setAuthorized(false);
      setIsPlatformAdmin(false);
      setStaffAccess(null);
      setLoading(false);
      setTenants([]);
      return;
    }

    setLoading(true);
    setError(null);
    const adminResult = await db
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (adminResult.error) {
      setAuthorized(false);
      setError("Não foi possível validar a autorização global desta conta.");
      setLoading(false);
      return;
    }

    const isAdmin = adminResult.data?.user_id === userId;
    setIsPlatformAdmin(isAdmin);
    setAuthorized(isAdmin);
    if (!isAdmin) {
      const staffResult = await db.rpc("get_my_platform_staff_access");
      if (!staffResult.error && staffResult.data?.[0]) {
        const staff = staffResult.data[0];
        const access = {
          displayName: staff.display_name ?? userEmail ?? "Colaborador",
          status: staff.staff_status ?? "invited",
          roleNames: staff.role_names ?? [],
          permissionCodes: staff.permission_codes ?? [],
        };
        setStaffAccess(access);
        if (staff.is_staff && staff.staff_status === "active") {
          setAuthorized(true);
          setTenants([]);
          setMetrics(METRICS_EMPTY);
          setCandidates([]);
          setAuditEvents([]);
          setLoading(false);
          return;
        }
      } else {
        setStaffAccess(null);
      }
      setAuthorized(false);
      void db.rpc("log_platform_admin_access_attempt", { p_route: "/admin-master" });
      setTenants([]);
      setMetrics(METRICS_EMPTY);
      setCandidates([]);
      setAuditEvents([]);
      setLoading(false);
      return;
    }

    setStaffAccess(null);
    const [
      tenantResult,
      metricsResult,
      candidatesResult,
      auditResult,
      membershipsResult,
      aiResult,
      plansResult,
      aiLimitsResult,
      invoicesResult,
      rankingResult,
    ] = await Promise.all([
      db.from("tenants").select("*").order("name", { ascending: true }),
      db.rpc("get_platform_master_metrics"),
      db.rpc("list_tenant_admin_candidates"),
      db
        .from("audit_events")
        .select("id, actor_id, action, entity, entity_id, created_at, tenant_id, details")
        .order("created_at", { ascending: false })
        .limit(200),
      db.from("tenant_memberships").select("tenant_id").eq("status", "active"),
      db.functions
        .invoke("platform-ai-configuration", { body: { action: "get" } })
        .catch(() => ({ data: null, error: null })),
      db.from("platform_plans").select("*").order("sort_order", { ascending: true }),
      db.rpc("list_platform_tenant_ai_limits"),
      db.from("platform_invoices").select("*").order("due_date", { ascending: false }).limit(300),
      db.rpc("get_platform_tenant_usage_ranking"),
    ]);

    if (tenantResult.error || metricsResult.error || candidatesResult.error || auditResult.error) {
      const firstError =
        tenantResult.error ?? metricsResult.error ?? candidatesResult.error ?? auditResult.error;
      setError(firstError?.message ?? "Não foi possível carregar os dados do painel Master.");
    }

    const userCounts: Record<string, number> = {};
    if (!membershipsResult.error && Array.isArray(membershipsResult.data)) {
      for (const m of membershipsResult.data) {
        if (m.tenant_id) userCounts[m.tenant_id] = (userCounts[m.tenant_id] ?? 0) + 1;
      }
    }

    const aiSummaryMap: Record<string, AiTenantSummary> = {};
    let aiUsageMap: Record<string, AiTenantUsageSummary> = {};
    const aiData = aiResult?.data as
      | {
          tenants?: Array<{
            id: string;
            enabled?: boolean;
            operational?: boolean;
            allowed_provider_ids?: string[];
          }>;
          usage?: Array<{
            tenant_id: string;
            requests: number;
            input_tokens: number;
            output_tokens: number;
            estimated_cost_usd: number;
          }>;
        }
      | null
      | undefined;

    if (aiData && !aiResult?.error) {
      if (Array.isArray(aiData.tenants)) {
        for (const t of aiData.tenants) {
          aiSummaryMap[t.id] = {
            enabled: Boolean(t.enabled),
            operational: Boolean(t.operational),
            allowedProvidersCount: Array.isArray(t.allowed_provider_ids)
              ? t.allowed_provider_ids.length
              : 0,
          };
        }
      }
      if (Array.isArray(aiData.usage)) {
        aiUsageMap = resumirUsoIaPorTenant(aiData.usage);
      }
    }

    const limitsMap: Record<string, AiTenantQuota> = {};
    if (!aiLimitsResult.error && Array.isArray(aiLimitsResult.data)) {
      for (const item of aiLimitsResult.data) {
        if (item.tenant_id) {
          limitsMap[item.tenant_id] = {
            monthly_budget_usd:
              item.monthly_budget_usd === null ? null : Number(item.monthly_budget_usd),
            monthly_token_limit:
              item.monthly_token_limit === null ? null : Number(item.monthly_token_limit),
          };
        }
      }
    }

    if (!plansResult.error && Array.isArray(plansResult.data) && plansResult.data.length > 0) {
      setPlans(
        plansResult.data.map((row) => ({
          id: row.id as PlatformPlanTier,
          name: row.name,
          description: row.description,
          default_monthly_fee: Number(row.default_monthly_fee ?? 0),
          default_max_users: Number(row.default_max_users ?? 20),
          default_ai_monthly_budget_usd:
            row.default_ai_monthly_budget_usd === null
              ? null
              : Number(row.default_ai_monthly_budget_usd),
          default_ai_monthly_token_limit:
            row.default_ai_monthly_token_limit === null
              ? null
              : Number(row.default_ai_monthly_token_limit),
          default_modules:
            row.default_modules &&
            typeof row.default_modules === "object" &&
            !Array.isArray(row.default_modules)
              ? (row.default_modules as Record<string, boolean>)
              : {},
          sort_order: Number(row.sort_order ?? 1),
          is_active: Boolean(row.is_active),
        })),
      );
      setPlansBackedByDatabase(true);
    } else {
      setPlans(DEFAULT_PLATFORM_PLANS);
      setPlansBackedByDatabase(false);
    }

    const usageMap: Record<string, TenantUsageCounts> = {};
    if (!rankingResult.error && Array.isArray(rankingResult.data)) {
      for (const row of rankingResult.data) {
        if (row.tenant_id) {
          usageMap[row.tenant_id] = {
            suppliers_count: Number(row.suppliers_count ?? 0),
            processes_count: Number(row.processes_count ?? 0),
            contracts_count: Number(row.contracts_count ?? 0),
            documents_count: Number(row.documents_count ?? 0),
          };
        }
      }
    }

    setTenants((tenantResult.data ?? []) as MasterTenant[]);
    setMetrics(metricsResult.error ? METRICS_EMPTY : parseMetrics(metricsResult.data));
    setCandidates((candidatesResult.data ?? []) as AdminCandidate[]);
    setAuditEvents((auditResult.data ?? []) as MasterAuditEvent[]);
    setActiveUsersByTenant(userCounts);
    setAiEnabledByTenant(aiSummaryMap);
    setAiUsageByTenant(aiUsageMap);
    setAiLimitsByTenant(limitsMap);
    setInvoices(
      !invoicesResult.error && Array.isArray(invoicesResult.data)
        ? (invoicesResult.data as Tables<"platform_invoices">[])
        : [],
    );
    setUsageByTenant(usageMap);
    setLoading(false);
  }, [userId, userEmail]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const createTenant = useCallback(
    async (name: string, slug: string, adminUserId: string, details: CommercialTenantInput) => {
      const { data: rpcData, error: rpcError } = await db.rpc(
        "create_tenant_with_admin_commercial",
        {
          p_name: name,
          p_slug: slug,
          p_admin_user_id: adminUserId,
          p_details: details as unknown as Json,
        },
      );
      if (rpcError) throw rpcError;
      await load();
      return rpcData as { tenant_id?: string } | null;
    },
    [load],
  );

  const updateTenant = useCallback(
    async (tenantId: string, values: Partial<MasterTenant>) => {
      const { error: updateError } = await db.from("tenants").update(values).eq("id", tenantId);
      if (updateError) throw updateError;
      await load();
    },
    [load],
  );

  const provisionLocalAdmin = useCallback(
    async (tenantId: string, userId: string) => {
      const { data: role, error: roleError } = await db
        .from("tenant_roles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("slug", "admin")
        .maybeSingle();
      if (roleError) throw roleError;
      if (!role?.id) throw new Error("O papel administrativo desta Secretaria não foi encontrado.");

      const { error: memberError } = await db.rpc("add_tenant_member", {
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_role_id: role.id,
      });
      if (memberError) throw memberError;
      await load();
    },
    [load],
  );

  const savePlan = useCallback(
    async (plan: PlatformPlanTemplate) => {
      const { error: planError } = await db.rpc("save_platform_plan", {
        p_plan_id: plan.id,
        p_name: plan.name,
        p_description: plan.description,
        p_default_monthly_fee: plan.default_monthly_fee,
        p_default_max_users: plan.default_max_users,
        p_default_ai_monthly_budget_usd: plan.default_ai_monthly_budget_usd,
        p_default_ai_monthly_token_limit: plan.default_ai_monthly_token_limit,
        p_default_modules: plan.default_modules as Json,
        p_is_active: plan.is_active,
      });
      if (planError) throw planError;
      await load();
    },
    [load],
  );

  const saveTenantAiLimits = useCallback(
    async (tenantId: string, monthlyBudgetUsd: number | null, monthlyTokenLimit: number | null) => {
      const { error: limitsError } = await db.rpc("set_tenant_ai_limits", {
        p_tenant_id: tenantId,
        p_monthly_budget_usd: monthlyBudgetUsd,
        p_monthly_token_limit: monthlyTokenLimit,
      });
      if (limitsError) throw limitsError;
      await load();
    },
    [load],
  );

  return {
    session,
    authorized,
    isPlatformAdmin,
    staffAccess,
    loading: authLoading || loading,
    error,
    tenants,
    metrics,
    candidates,
    auditEvents,
    activeUsersByTenant,
    aiEnabledByTenant,
    aiUsageByTenant,
    plans,
    plansBackedByDatabase,
    aiLimitsByTenant,
    invoices,
    usageByTenant,
    refresh: load,
    createTenant,
    updateTenant,
    provisionLocalAdmin,
    savePlan,
    saveTenantAiLimits,
  };
}
