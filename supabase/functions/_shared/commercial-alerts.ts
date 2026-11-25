import { renderInstitutionalEmail, type InstitutionalEmailOptions } from "./institutional-email.ts";
import { sanitizeEmailSubject } from "./expiry-notification.ts";

export type CommercialAlertKind =
  | "invoice_upcoming"
  | "invoice_overdue"
  | "trial_expiring"
  | "ai_quota_warning"
  | "ai_quota_exceeded"
  | "user_limit_warning"
  | "user_limit_reached";

export type CommercialAlertMetadata = {
  reference_month?: string;
  amount?: number | string | null;
  due_date?: string | null;
  days_overdue?: number | null;
  payment_url?: string | null;
  plan_tier?: string | null;
  trial_ends_on?: string | null;
  days_remaining?: number | null;
  used_cost_usd?: number | null;
  budget_usd?: number | null;
  used_tokens?: number | null;
  token_limit?: number | null;
  active_users?: number | null;
  max_users?: number | null;
  admin_emails?: string[] | null;
};

export type CommercialAlertCandidate = {
  tenant_id: string;
  tenant_name: string;
  invoice_id: string | null;
  alert_kind: CommercialAlertKind;
  severity: "critical" | "high" | "medium";
  recipient_email: string | null;
  recipient_scope: "tenant_billing" | "platform_admin";
  dedupe_key: string;
  metadata: CommercialAlertMetadata;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatBrl(value: unknown): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

function formatUsd(value: unknown): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "US$ 0.00";
  return `US$ ${num.toFixed(2)}`;
}

function formatDateBr(isoDate: unknown): string {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return "—";
  }
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function safeOptionalHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function resolveCommercialAlertRecipients(candidate: CommercialAlertCandidate): string[] {
  const set = new Set<string>();
  const primary = candidate.recipient_email?.trim().toLowerCase() ?? "";
  if (primary && EMAIL_PATTERN.test(primary)) {
    set.add(primary);
  }
  if (
    candidate.recipient_scope === "platform_admin" &&
    Array.isArray(candidate.metadata?.admin_emails)
  ) {
    for (const raw of candidate.metadata.admin_emails) {
      if (typeof raw === "string") {
        const email = raw.trim().toLowerCase();
        if (EMAIL_PATTERN.test(email)) set.add(email);
      }
    }
  }
  return Array.from(set);
}

export function buildCommercialAlertEmail(
  candidate: CommercialAlertCandidate,
  appOrigin: string,
): { subject: string; html: string } {
  const meta = candidate.metadata ?? {};
  const tenantName = candidate.tenant_name || "Secretaria";
  const adminUrl = new URL("/admin-master", appOrigin).href;
  const paymentUrl = safeOptionalHttpUrl(meta.payment_url);

  let subjectTitle = "";
  let options: InstitutionalEmailOptions;

  switch (candidate.alert_kind) {
    case "invoice_upcoming": {
      const refMonth = String(meta.reference_month ?? "");
      const dueBr = formatDateBr(meta.due_date);
      const amount = formatBrl(meta.amount);
      subjectTitle = `Fatura ${refMonth} vence em ${dueBr} — ${tenantName}`;
      options = {
        issuer: tenantName,
        category: "Aviso de cobrança SaaS",
        heading: "Fatura próxima do vencimento",
        preheader: `${amount} com vencimento em ${dueBr}`,
        message: `Informamos que a mensalidade da plataforma referente a ${refMonth} tem vencimento previsto para ${dueBr}. Caso o pagamento já tenha sido realizado, desconsidere este aviso.`,
        fields: [
          { label: "Secretaria", value: tenantName },
          { label: "Competência", value: refMonth || "—" },
          { label: "Valor", value: amount },
          { label: "Vencimento", value: dueBr },
        ],
        action: paymentUrl
          ? { label: "Abrir link de pagamento", url: paymentUrl }
          : { label: "Acessar Primus Gestão", url: adminUrl },
        guidance:
          "Mantenha o pagamento em dia para preservar o acesso contínuo de todos os usuários da Secretaria.",
        tone: "attention",
      };
      break;
    }

    case "invoice_overdue": {
      const refMonth = String(meta.reference_month ?? "");
      const dueBr = formatDateBr(meta.due_date);
      const amount = formatBrl(meta.amount);
      const days = Math.max(0, Number(meta.days_overdue ?? 0));
      subjectTitle = `Fatura ${refMonth} em atraso (${days}d) — ${tenantName}`;
      options = {
        issuer: tenantName,
        category: "Regularização de cobrança",
        heading: "Fatura vencida requer atenção",
        preheader: `Mensalidade ${refMonth} vencida há ${days} dia(s)`,
        message: `Identificamos uma fatura vencida em ${dueBr} (${days} dia(s) de atraso) vinculada à assinatura de ${tenantName}. Regularize o pagamento para evitar suspensão automática dos módulos operacionais.`,
        fields: [
          { label: "Secretaria", value: tenantName },
          { label: "Competência", value: refMonth || "—" },
          { label: "Valor", value: amount },
          { label: "Vencimento", value: dueBr },
        ],
        action: paymentUrl
          ? { label: "Regularizar pagamento agora", url: paymentUrl }
          : { label: "Acessar Primus Gestão", url: adminUrl },
        guidance:
          "Após a compensação via gateway ou baixa pelo Administrador Master, o acesso é restabelecido automaticamente.",
        tone: "critical",
      };
      break;
    }

    case "trial_expiring": {
      const endsBr = formatDateBr(meta.trial_ends_on);
      const days = Math.max(0, Number(meta.days_remaining ?? 0));
      const planTier = String(meta.plan_tier ?? "profissional");
      subjectTitle = `Período de avaliação termina em ${endsBr} — ${tenantName}`;
      options = {
        issuer: tenantName,
        category: "Acompanhamento de avaliação (Trial)",
        heading: "Período de avaliação próximo do fim",
        preheader: `Restam ${days} dia(s) de teste para ${tenantName}`,
        message: `O ambiente de avaliação (${planTier}) de ${tenantName} se encerra em ${endsBr}. Conclua a contratação comercial no Painel Master para manter a operação sem interrupção.`,
        fields: [
          { label: "Secretaria", value: tenantName },
          { label: "Plano atual", value: planTier },
          { label: "Encerramento", value: endsBr },
        ],
        action: { label: "Gerenciar assinatura", url: adminUrl },
        tone: "attention",
      };
      break;
    }

    case "ai_quota_exceeded":
    case "ai_quota_warning": {
      const exceeded = candidate.alert_kind === "ai_quota_exceeded";
      const usedCost = formatUsd(meta.used_cost_usd);
      const budget = meta.budget_usd ? formatUsd(meta.budget_usd) : "Sem teto USD";
      const usedTokens = Number(meta.used_tokens ?? 0).toLocaleString("pt-BR");
      const tokenLimit = meta.token_limit
        ? Number(meta.token_limit).toLocaleString("pt-BR")
        : "Sem teto de tokens";
      subjectTitle = exceeded
        ? `Cota mensal de IA atingida — ${tenantName}`
        : `Consumo de IA acima de 80% — ${tenantName}`;
      options = {
        issuer: "Primus Gestão — Governança SaaS",
        category: "Monitoramento de cota de IA",
        heading: exceeded ? "Limite mensal de IA atingido" : "Alerta preventivo de consumo de IA",
        preheader: `${tenantName}: ${usedCost} · ${usedTokens} tokens`,
        message: exceeded
          ? `A Secretaria ${tenantName} atingiu 100% da cota mensal de Inteligência Artificial configurada para a competência ${String(meta.reference_month ?? "")}.`
          : `A Secretaria ${tenantName} ultrapassou 80% do limite mensal de Inteligência Artificial na competência ${String(meta.reference_month ?? "")}.`,
        fields: [
          { label: "Secretaria", value: tenantName },
          { label: "Gasto no mês / Teto", value: `${usedCost} / ${budget}` },
          { label: "Tokens no mês / Teto", value: `${usedTokens} / ${tokenLimit}` },
        ],
        action: { label: "Ajustar cotas no Painel Master", url: adminUrl },
        tone: exceeded ? "critical" : "attention",
      };
      break;
    }

    case "user_limit_reached":
    case "user_limit_warning": {
      const reached = candidate.alert_kind === "user_limit_reached";
      const activeUsers = Number(meta.active_users ?? 0);
      const maxUsers = Number(meta.max_users ?? 0);
      subjectTitle = reached
        ? `Limite de usuários atingido (${activeUsers}/${maxUsers}) — ${tenantName}`
        : `Uso de usuários acima de 80% (${activeUsers}/${maxUsers}) — ${tenantName}`;
      options = {
        issuer: "Primus Gestão — Governança SaaS",
        category: "Monitoramento de capacidade",
        heading: reached
          ? "Limite de usuários do plano atingido"
          : "Capacidade de usuários próxima do limite",
        preheader: `${tenantName}: ${activeUsers} de ${maxUsers} usuários ativos`,
        message: reached
          ? `A Secretaria ${tenantName} atingiu ${activeUsers} usuários ativos de um limite máximo de ${maxUsers}. Avalie um upgrade de plano.`
          : `A Secretaria ${tenantName} utiliza ${activeUsers} de ${maxUsers} vagas de usuários ativos.`,
        fields: [
          { label: "Secretaria", value: tenantName },
          { label: "Usuários ativos", value: `${activeUsers} / ${maxUsers}` },
        ],
        action: { label: "Revisar plano no Painel Master", url: adminUrl },
        tone: reached ? "attention" : "standard",
      };
      break;
    }
  }

  return {
    subject: sanitizeEmailSubject(`[Primus Gestão] ${subjectTitle}`),
    html: renderInstitutionalEmail(options),
  };
}
