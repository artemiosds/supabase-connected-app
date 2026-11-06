import { useCallback, useEffect, useState } from "react";
import type { Json, Tables } from "@/integrations/supabase/types";
import { db } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";

export type MasterTenant = Tables<"tenants">;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<MasterTenant[]>([]);
  const [metrics, setMetrics] = useState<MasterMetrics>(METRICS_EMPTY);
  const [candidates, setCandidates] = useState<AdminCandidate[]>([]);
  const [auditEvents, setAuditEvents] = useState<MasterAuditEvent[]>([]);

  const load = useCallback(async () => {
    if (!session?.user.id) {
      setAuthorized(false);
      setLoading(false);
      setTenants([]);
      return;
    }

    setLoading(true);
    setError(null);
    const adminResult = await db
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", session.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminResult.error) {
      setAuthorized(false);
      setError("Não foi possível validar a autorização global desta conta.");
      setLoading(false);
      return;
    }

    const isAdmin = adminResult.data?.user_id === session.user.id;
    setAuthorized(isAdmin);
    if (!isAdmin) {
      void db.rpc("log_platform_admin_access_attempt", { p_route: "/admin-master" });
      setTenants([]);
      setMetrics(METRICS_EMPTY);
      setCandidates([]);
      setAuditEvents([]);
      setLoading(false);
      return;
    }

    const [tenantResult, metricsResult, candidatesResult, auditResult] = await Promise.all([
      db.from("tenants").select("*").order("name", { ascending: true }),
      db.rpc("get_platform_master_metrics"),
      db.rpc("list_tenant_admin_candidates"),
      db
        .from("audit_events")
        .select("id, actor_id, action, entity, entity_id, created_at, tenant_id, details")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (tenantResult.error || metricsResult.error || candidatesResult.error || auditResult.error) {
      const firstError =
        tenantResult.error ?? metricsResult.error ?? candidatesResult.error ?? auditResult.error;
      setError(firstError?.message ?? "Não foi possível carregar os dados do painel Master.");
    }

    setTenants((tenantResult.data ?? []) as MasterTenant[]);
    setMetrics(metricsResult.error ? METRICS_EMPTY : parseMetrics(metricsResult.data));
    setCandidates((candidatesResult.data ?? []) as AdminCandidate[]);
    setAuditEvents((auditResult.data ?? []) as MasterAuditEvent[]);
    setLoading(false);
  }, [session?.user.id]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const createTenant = useCallback(
    async (name: string, slug: string, adminUserId: string, details: CommercialTenantInput) => {
      const { error: rpcError } = await db.rpc("create_tenant_with_admin_commercial", {
        p_name: name,
        p_slug: slug,
        p_admin_user_id: adminUserId,
        p_details: details as unknown as Json,
      });
      if (rpcError) throw rpcError;
      await load();
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

  return {
    session,
    authorized,
    loading: authLoading || loading,
    error,
    tenants,
    metrics,
    candidates,
    auditEvents,
    refresh: load,
    createTenant,
    updateTenant,
    provisionLocalAdmin,
  };
}
