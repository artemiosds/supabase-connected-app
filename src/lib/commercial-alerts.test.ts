import { describe, expect, it } from "vitest";
import {
  buildCommercialAlertEmail,
  resolveCommercialAlertRecipients,
  type CommercialAlertCandidate,
} from "../../supabase/functions/_shared/commercial-alerts";

describe("commercial-alerts helpers", () => {
  it("monta assunto e HTML escapando nomes maliciosos e links inseguros", () => {
    const candidate: CommercialAlertCandidate = {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      tenant_name: "Secretaria <script>alert(1)</script> Saúde",
      invoice_id: "22222222-2222-4222-8222-222222222222",
      alert_kind: "invoice_overdue",
      severity: "critical",
      recipient_email: "financeiro@saude.gov.br",
      recipient_scope: "tenant_billing",
      dedupe_key: "invoice_overdue:2222:2026-11",
      metadata: {
        reference_month: "2026-11",
        amount: 1490,
        due_date: "2026-11-20",
        days_overdue: 5,
        payment_url: "javascript:alert(1)",
      },
    };

    const email = buildCommercialAlertEmail(candidate, "https://app.primus.gov.br");
    expect(email.subject).toContain("Fatura 2026-11 em atraso (5d)");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("javascript:alert(1)");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("https://app.primus.gov.br/admin-master");
  });

  it("gera e-mail de cota de IA e deduplica destinatários válidos", () => {
    const candidate: CommercialAlertCandidate = {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      tenant_name: "SMS Oriximiná",
      invoice_id: null,
      alert_kind: "ai_quota_exceeded",
      severity: "critical",
      recipient_email: "Admin@Saude.gov.br",
      recipient_scope: "platform_admin",
      dedupe_key: "ai_quota_exceeded:1111:2026-11",
      metadata: {
        reference_month: "2026-11",
        used_cost_usd: 52.4,
        budget_usd: 50,
        used_tokens: 120000,
        token_limit: 100000,
        admin_emails: ["admin@saude.gov.br", "master@primus.gov.br", "invalido"],
      },
    };

    const recipients = resolveCommercialAlertRecipients(candidate);
    expect(recipients).toEqual(["admin@saude.gov.br", "master@primus.gov.br"]);

    const email = buildCommercialAlertEmail(candidate, "https://app.primus.gov.br");
    expect(email.subject).toContain("Cota mensal de IA atingida");
    expect(email.html).toContain("US$ 52.40 / US$ 50.00");
  });
});
