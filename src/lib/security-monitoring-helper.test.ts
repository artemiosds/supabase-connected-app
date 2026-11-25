import { describe, expect, it } from "vitest";
import {
  avaliarPosturaSeguranca,
  calcularScorePosturaSeguranca,
  type PlatformSecuritySignals,
} from "./security-monitoring-helper";

const baseSignals: PlatformSecuritySignals = {
  generated_at: "2026-11-25T10:00:00Z",
  mfa: { platform_admins_total: 1, platform_admins_with_mfa: 1 },
  rls: { tables_without_rls: 0, tables_without_force_rls: 0 },
  events_24h: { access_denied: 0, privilege_changes: 0, ai_failures: 0, ai_total_requests: 10 },
  events_7d: { access_denied: 0, privilege_changes: 1, ai_failures: 0 },
  active_support_sessions: 0,
  recent_sensitive_events: [],
};

describe("security-monitoring-helper", () => {
  it("retorna score 100 e zero alertas quando postura está íntegra", () => {
    expect(avaliarPosturaSeguranca(baseSignals)).toEqual([]);
    expect(calcularScorePosturaSeguranca(baseSignals)).toBe(100);
  });

  it("sinaliza criticamente falta de MFA no Master e falhas de RLS", () => {
    const signals: PlatformSecuritySignals = {
      ...baseSignals,
      mfa: { platform_admins_total: 1, platform_admins_with_mfa: 0 },
      rls: { tables_without_rls: 1, tables_without_force_rls: 2 },
    };

    const alerts = avaliarPosturaSeguranca(signals);
    expect(alerts.map((a) => a.code)).toContain("RLS_GAP_DETECTED");
    expect(alerts.map((a) => a.code)).toContain("MFA_ADMIN_MISSING");
    expect(calcularScorePosturaSeguranca(signals)).toBeLessThanOrEqual(20);
  });

  it("detecta pico de ACCESS_DENIED, alterações de privilégio e falhas de IA", () => {
    const signals: PlatformSecuritySignals = {
      ...baseSignals,
      events_24h: {
        access_denied: 6,
        privilege_changes: 12,
        ai_failures: 5,
        ai_total_requests: 8,
      },
      active_support_sessions: 2,
    };

    const alerts = avaliarPosturaSeguranca(signals);
    expect(alerts.map((a) => a.code)).toEqual([
      "ACCESS_DENIED_BURST",
      "PRIVILEGE_CHANGE_SPIKE",
      "AI_FAILURE_SPIKE",
      "ACTIVE_SUPPORT_SESSIONS",
    ]);
    expect(calcularScorePosturaSeguranca(signals)).toBe(65);
  });
});
