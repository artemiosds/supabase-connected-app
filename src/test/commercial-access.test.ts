import { describe, expect, it } from "vitest";
import {
  calculateEstimatedMrr,
  getTenantAccessState,
  getTrialDaysRemaining,
  isCommercialModuleEnabled,
  type CommercialTenant,
} from "@/lib/commercial-access";

const activeTenant: CommercialTenant = {
  status: "active",
  commercial_status: "active",
  trial_starts_at: null,
  trial_ends_at: null,
  monthly_fee: 2500,
  enabled_modules: { fornecedores: true, documentos: false },
};

describe("commercial access rules", () => {
  it("allows active commercial tenants", () => {
    expect(getTenantAccessState(activeTenant)).toBe("allowed");
  });

  it("blocks billing, suspended and cancelled tenants", () => {
    expect(getTenantAccessState({ ...activeTenant, commercial_status: "blocked_billing" })).toBe("billing_blocked");
    expect(getTenantAccessState({ ...activeTenant, commercial_status: "suspended" })).toBe("commercial_suspended");
    expect(getTenantAccessState({ ...activeTenant, commercial_status: "cancelled" })).toBe("cancelled");
  });

  it("distinguishes trial not started, valid and expired", () => {
    const trial = {
      ...activeTenant,
      commercial_status: "trial",
      trial_starts_at: "2026-11-07T00:00:00.000Z",
      trial_ends_at: "2026-11-14T00:00:00.000Z",
    };
    expect(getTenantAccessState(trial, new Date("2026-11-06T12:00:00.000Z"))).toBe("trial_not_started");
    expect(getTenantAccessState(trial, new Date("2026-11-10T12:00:00.000Z"))).toBe("allowed");
    expect(getTenantAccessState(trial, new Date("2026-11-14T00:00:00.000Z"))).toBe("trial_expired");
  });

  it("does not enable unspecified modules", () => {
    expect(isCommercialModuleEnabled(activeTenant.enabled_modules, "fornecedores")).toBe(true);
    expect(isCommercialModuleEnabled(activeTenant.enabled_modules, "documentos")).toBe(false);
    expect(isCommercialModuleEnabled(activeTenant.enabled_modules, "ged")).toBe(false);
  });

  it("counts MRR only for active institutional and commercial tenants", () => {
    expect(calculateEstimatedMrr([
      activeTenant,
      { ...activeTenant, monthly_fee: 900, commercial_status: "trial" },
      { ...activeTenant, monthly_fee: 600, status: "suspended" },
      { ...activeTenant, monthly_fee: -10 },
    ])).toBe(2490);
  });

  it("rounds remaining trial days up and never returns a negative count", () => {
    expect(getTrialDaysRemaining("2026-11-07T00:00:00.000Z", new Date("2026-11-06T12:00:00.000Z"))).toBe(1);
    expect(getTrialDaysRemaining("2026-11-05T00:00:00.000Z", new Date("2026-11-06T12:00:00.000Z"))).toBe(0);
  });
});
