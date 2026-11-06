export type CommercialStatus =
  | "active"
  | "trial"
  | "blocked_billing"
  | "suspended"
  | "cancelled";

export type CommercialModule =
  | "fornecedores"
  | "documentos"
  | "processos"
  | "contratos"
  | "modelos"
  | "ged"
  | "auditoria";

export type CommercialTenant = {
  status: "active" | "suspended" | "closed" | string;
  commercial_status: CommercialStatus | string;
  trial_starts_at: string | null;
  trial_ends_at: string | null;
  monthly_fee: number | null;
  enabled_modules: Record<string, boolean> | null;
};

export type TenantAccessState =
  | "allowed"
  | "institutional_suspended"
  | "billing_blocked"
  | "commercial_suspended"
  | "cancelled"
  | "trial_not_started"
  | "trial_expired";

export function getTenantAccessState(
  tenant: CommercialTenant,
  now: Date = new Date(),
): TenantAccessState {
  if (tenant.status === "suspended") return "institutional_suspended";
  if (tenant.status === "closed" || tenant.commercial_status === "cancelled") return "cancelled";
  if (tenant.commercial_status === "blocked_billing") return "billing_blocked";
  if (tenant.commercial_status === "suspended") return "commercial_suspended";
  if (tenant.commercial_status === "active" && tenant.status === "active") return "allowed";

  if (tenant.commercial_status === "trial") {
    const startsAt = tenant.trial_starts_at ? new Date(tenant.trial_starts_at) : null;
    const endsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) return "trial_not_started";
    if (now < startsAt) return "trial_not_started";
    if (!endsAt || Number.isNaN(endsAt.getTime()) || now >= endsAt) return "trial_expired";
    return "allowed";
  }

  return "commercial_suspended";
}

export function isCommercialModuleEnabled(
  modules: Record<string, boolean> | null | undefined,
  module: CommercialModule,
): boolean {
  return modules?.[module] === true;
}

export function getTrialDaysRemaining(
  endsAt: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!endsAt) return 0;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime()) || end <= now) return 0;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

export function calculateEstimatedMrr(tenants: CommercialTenant[]): number {
  return tenants.reduce((total, tenant) => {
    if (tenant.status !== "active" || tenant.commercial_status !== "active") return total;
    return total + Math.max(0, Number(tenant.monthly_fee ?? 0));
  }, 0);
}
