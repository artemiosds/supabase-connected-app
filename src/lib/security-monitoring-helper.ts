export interface SensitiveSecurityEventSummary {
  id: string;
  action: string;
  entity: string;
  tenant_id: string | null;
  created_at: string;
}

export interface PlatformSecuritySignals {
  generated_at: string;
  mfa: {
    platform_admins_total: number;
    platform_admins_with_mfa: number;
  };
  rls: {
    tables_without_rls: number;
    tables_without_force_rls: number;
  };
  events_24h: {
    access_denied: number;
    privilege_changes: number;
    ai_failures: number;
    ai_total_requests: number;
  };
  events_7d: {
    access_denied: number;
    privilege_changes: number;
    ai_failures: number;
  };
  active_support_sessions: number;
  recent_sensitive_events: SensitiveSecurityEventSummary[];
}

export type SecurityAlertSeverity = "critical" | "high" | "medium" | "info";

export interface SecurityAnomalyAlert {
  code: string;
  severity: SecurityAlertSeverity;
  title: string;
  detail: string;
  recommendation: string;
}

export function avaliarPosturaSeguranca(signals: PlatformSecuritySignals): SecurityAnomalyAlert[] {
  const alerts: SecurityAnomalyAlert[] = [];

  if (signals.rls.tables_without_rls > 0 || signals.rls.tables_without_force_rls > 0) {
    alerts.push({
      code: "RLS_GAP_DETECTED",
      severity: "critical",
      title: "Tabela(s) em public sem RLS ou FORCE RLS",
      detail: `${signals.rls.tables_without_rls} sem RLS · ${signals.rls.tables_without_force_rls} sem FORCE RLS.`,
      recommendation:
        "Execute a revisão imediata de migrações e aplique ENABLE/FORCE ROW LEVEL SECURITY.",
    });
  }

  if (signals.mfa.platform_admins_total > 0 && signals.mfa.platform_admins_with_mfa === 0) {
    alerts.push({
      code: "MFA_ADMIN_MISSING",
      severity: "critical",
      title: "Nenhum Administrador Master possui MFA (TOTP) ativo",
      detail: `0 de ${signals.mfa.platform_admins_total} administrador(es) com segundo fator verificado.`,
      recommendation:
        "Ative o MFA no banner de segurança no topo do Painel Master para exigir sessão AAL2.",
    });
  } else if (signals.mfa.platform_admins_with_mfa < signals.mfa.platform_admins_total) {
    alerts.push({
      code: "MFA_ADMIN_PARTIAL",
      severity: "high",
      title: "Cobertura parcial de MFA entre administradores",
      detail: `${signals.mfa.platform_admins_with_mfa} de ${signals.mfa.platform_admins_total} com TOTP verificado.`,
      recommendation: "Oriente todos os administradores globais a vincularem um fator TOTP.",
    });
  }

  if (signals.events_24h.access_denied >= 5) {
    alerts.push({
      code: "ACCESS_DENIED_BURST",
      severity: "high",
      title: "Pico de falhas de autorização nas últimas 24h",
      detail: `${signals.events_24h.access_denied} evento(s) ACCESS_DENIED em 24h (${signals.events_7d.access_denied} em 7d).`,
      recommendation:
        "Inspecione os atores na tabela de Auditoria Global e os logs Edge/Auth no Supabase.",
    });
  } else if (signals.events_24h.access_denied > 0) {
    alerts.push({
      code: "ACCESS_DENIED_DETECTED",
      severity: "medium",
      title: "Tentativa(s) de acesso negado registradas nas últimas 24h",
      detail: `${signals.events_24h.access_denied} evento(s) ACCESS_DENIED registrado(s).`,
      recommendation: "Confira se houve tentativa de acesso indevido ou erro de perfil.",
    });
  }

  if (signals.events_24h.privilege_changes >= 10) {
    alerts.push({
      code: "PRIVILEGE_CHANGE_SPIKE",
      severity: "high",
      title: "Volume incomum de alterações de privilégios em 24h",
      detail: `${signals.events_24h.privilege_changes} alterações em papéis/equipes nas últimas 24h.`,
      recommendation: "Audite os eventos recentes de papéis, permissões e equipe administrativa.",
    });
  }

  const aiTotal = signals.events_24h.ai_total_requests;
  const aiFailures = signals.events_24h.ai_failures;
  const aiFailureRatio = aiTotal > 0 ? aiFailures / aiTotal : 0;

  if (aiFailures >= 10 || (aiTotal >= 5 && aiFailureRatio >= 0.4)) {
    alerts.push({
      code: "AI_FAILURE_SPIKE",
      severity: "high",
      title: "Taxa elevada de falhas ou bloqueios em chamadas de IA (24h)",
      detail: `${aiFailures} falha(s) de ${aiTotal} requisição(ões) nas últimas 24h.`,
      recommendation:
        "Verifique chaves de provedores, cotas mensais e possíveis abusos nos logs de IA.",
    });
  } else if (aiFailures >= 3) {
    alerts.push({
      code: "AI_FAILURES_ELEVATED",
      severity: "medium",
      title: "Falhas recorrentes de provedor IA nas últimas 24h",
      detail: `${aiFailures} falha(s) registradas em 24h.`,
      recommendation: "Confira a saúde dos provedores na aba Inteligência Artificial.",
    });
  }

  if (signals.active_support_sessions > 0) {
    alerts.push({
      code: "ACTIVE_SUPPORT_SESSIONS",
      severity: "info",
      title: `${signals.active_support_sessions} sessão(ões) de suporte técnico ativa(s)`,
      detail: "Acesso temporário autorizado entre Secretaria e equipe de suporte.",
      recommendation: "Revogue sessões na aba Equipe de Suporte caso não estejam mais em uso.",
    });
  }

  const rank: Record<SecurityAlertSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    info: 3,
  };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function calcularScorePosturaSeguranca(signals: PlatformSecuritySignals): number {
  let score = 100;

  if (signals.rls.tables_without_rls > 0) score -= 35;
  if (signals.rls.tables_without_force_rls > 0) score -= 20;

  if (signals.mfa.platform_admins_total > 0 && signals.mfa.platform_admins_with_mfa === 0) {
    score -= 25;
  } else if (signals.mfa.platform_admins_with_mfa < signals.mfa.platform_admins_total) {
    score -= 10;
  }

  if (signals.events_24h.access_denied >= 5) score -= 15;
  else if (signals.events_24h.access_denied > 0) score -= 5;

  if (signals.events_24h.privilege_changes >= 10) score -= 10;

  const aiTotal = signals.events_24h.ai_total_requests;
  const aiFailures = signals.events_24h.ai_failures;
  const aiRatio = aiTotal > 0 ? aiFailures / aiTotal : 0;
  if (aiFailures >= 10 || (aiTotal >= 5 && aiRatio >= 0.4)) score -= 10;
  else if (aiFailures >= 3) score -= 5;

  return Math.max(0, Math.min(100, score));
}
