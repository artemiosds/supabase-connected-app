// =============================================================================
// admin-master-helper.test.ts — Testes unitários do Backoffice Master
// Primus Gestão — Fase 2 Painel Master
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_PLANS,
  agruparClientesPorPlano,
  agruparClientesPorStatus,
  agruparFaturasPorMes,
  aplicarTemplatePlanoNoDraft,
  avaliarCotaIa,
  filtrarAuditoriaMaster,
  filtrarClientesMaster,
  filtrarFaturasMaster,
  gerarAlertasSaudePlataforma,
  montarRankingSecretarias,
  resumirFinanceiroFaturas,
  resumirUsoIaPorTenant,
} from "./admin-master-helper";

describe("admin-master-helper", () => {
  const tenants = [
    {
      id: "t1",
      name: "Secretaria Municipal de Saúde de Oriximiná",
      trade_name: "SMS Oriximiná",
      slug: "sms-oriximina",
      cnpj: "12345678000190",
      municipality: "Oriximiná",
      state: "PA",
      commercial_status: "active",
      plan_tier: "profissional",
      monthly_fee: 1500,
    },
    {
      id: "t2",
      name: "Secretaria de Saúde de Santarém",
      trade_name: null,
      slug: "sms-santarem",
      cnpj: "98765432000100",
      municipality: "Santarém",
      state: "PA",
      commercial_status: "trial",
      plan_tier: "enterprise",
      monthly_fee: 3000,
    },
    {
      id: "t3",
      name: "Fundo Municipal de Saúde de Belém",
      trade_name: "FMS Belém",
      slug: "fms-belem",
      cnpj: "11222333000144",
      municipality: "Belém",
      state: "PA",
      commercial_status: "blocked_billing",
      plan_tier: "profissional",
      monthly_fee: 1500,
    },
  ];

  it("filtra clientes por busca textual, CNPJ, status comercial e plano", () => {
    expect(filtrarClientesMaster(tenants, { busca: "oriximiná" })).toHaveLength(1);
    expect(filtrarClientesMaster(tenants, { busca: "98.765.432" })).toHaveLength(1);
    expect(filtrarClientesMaster(tenants, { status: "trial" })).toHaveLength(1);
    expect(filtrarClientesMaster(tenants, { plano: "profissional" })).toHaveLength(2);
    expect(
      filtrarClientesMaster(tenants, { status: "blocked_billing", plano: "profissional" }),
    ).toHaveLength(1);
  });

  it("filtra eventos de auditoria por ação, entidade e termo livre", () => {
    const events = [
      {
        id: "e1",
        actor_id: "u1",
        action: "ACCESS_DENIED",
        entity: "platform_admins",
        entity_id: "x1",
        tenant_id: null,
        created_at: "2026-11-24T10:00:00Z",
      },
      {
        id: "e2",
        actor_id: "u2",
        action: "UPDATE",
        entity: "tenants",
        entity_id: "t1",
        tenant_id: "t1",
        created_at: "2026-11-24T11:00:00Z",
      },
    ];

    expect(filtrarAuditoriaMaster(events, { acao: "ACCESS_DENIED" })).toHaveLength(1);
    expect(filtrarAuditoriaMaster(events, { entidade: "tenants" })).toHaveLength(1);
    expect(filtrarAuditoriaMaster(events, { busca: "orix" })).toHaveLength(0);
    expect(filtrarAuditoriaMaster(events, { busca: "t1" })).toHaveLength(1);
  });

  it("agrupa clientes por plano contabilizando MRR somente dos ativos", () => {
    const porPlano = agruparClientesPorPlano(tenants, {
      basico: "Básico",
      profissional: "Profissional",
      enterprise: "Enterprise",
      consorcio: "Consórcio",
    });

    const prof = porPlano.find((p) => p.plano === "profissional");
    expect(prof?.clientes).toBe(2);
    expect(prof?.mrr).toBe(1500); // t1 ativo (1500) + t3 bloqueado (ignorado no MRR)

    const ent = porPlano.find((p) => p.plano === "enterprise");
    expect(ent?.clientes).toBe(1);
    expect(ent?.mrr).toBe(0); // trial não soma MRR ativo
  });

  it("agrupa clientes por status omitindo status vazios", () => {
    const porStatus = agruparClientesPorStatus(tenants, {
      active: "Ativo",
      trial: "Em demonstração",
      blocked_billing: "Bloqueado",
      suspended: "Suspenso",
    });

    expect(porStatus).toHaveLength(3);
    expect(porStatus.some((s) => s.status === "suspended")).toBe(false);
  });

  it("resume corretamente uso de IA e tokens por tenant", () => {
    const resumo = resumirUsoIaPorTenant([
      {
        tenant_id: "t1",
        requests: 10,
        input_tokens: 1000,
        output_tokens: 500,
        estimated_cost_usd: 0.02,
      },
      {
        tenant_id: "t1",
        requests: 5,
        input_tokens: 300,
        output_tokens: 200,
        estimated_cost_usd: 0.01,
      },
    ]);

    expect(resumo["t1"]).toEqual({
      requests: 15,
      tokens: 2000,
      costUsd: 0.03,
    });
  });

  it("aplica template de plano preenchendo mensalidade, limite de usuários, IA e módulos", () => {
    const basico = DEFAULT_PLATFORM_PLANS.find((p) => p.id === "basico")!;
    const draft = aplicarTemplatePlanoNoDraft(
      {
        plan_tier: "profissional",
        monthly_fee: 1990,
        max_users: 25,
        enabled_modules: { fornecedores: true, pca: true } as Record<string, boolean>,
        ai_monthly_budget_usd: 30,
        ai_monthly_token_limit: 8_000_000,
      },
      basico,
    );

    expect(draft.plan_tier).toBe("basico");
    expect(draft.monthly_fee).toBe(990);
    expect(draft.max_users).toBe(10);
    expect(draft.enabled_modules["pca"]).toBe(false);
    expect(draft.enabled_modules["relatorios"]).toBe(true);
    expect(draft.ai_monthly_budget_usd).toBe(10);
    expect(draft.ai_monthly_token_limit).toBe(2_000_000);
  });

  it("avalia corretamente percentual e alertas da cota mensal de IA", () => {
    expect(avaliarCotaIa(25, 4_000_000, 30, 8_000_000)).toEqual({
      costPct: 83,
      tokenPct: 50,
      exceeded: false,
      nearLimit: true,
    });
    expect(avaliarCotaIa(32, 4_000_000, 30, 8_000_000)).toEqual({
      costPct: 107,
      tokenPct: 50,
      exceeded: true,
      nearLimit: false,
    });
    expect(avaliarCotaIa(5, 1000, null, null)).toEqual({
      costPct: null,
      tokenPct: null,
      exceeded: false,
      nearLimit: false,
    });
  });

  it("resume totais e filtra faturas por status, competência e secretaria", () => {
    const faturas = [
      {
        id: "f1",
        tenant_id: "t1",
        reference_month: "2026-11",
        amount: 1990,
        due_date: "2026-11-10",
        status: "paid",
        payment_method: "pix",
        external_reference: "PIX-001",
      },
      {
        id: "f2",
        tenant_id: "t2",
        reference_month: "2026-11",
        amount: 3990,
        due_date: "2026-11-05",
        status: "overdue",
        payment_method: "boleto",
        external_reference: null,
      },
      {
        id: "f3",
        tenant_id: "t3",
        reference_month: "2026-12",
        amount: 990,
        due_date: "2026-12-10",
        status: "pending",
        payment_method: "manual",
        external_reference: null,
      },
    ];

    expect(resumirFinanceiroFaturas(faturas)).toEqual({
      totalPaid: 1990,
      totalPending: 990,
      totalOverdue: 3990,
      countPaid: 1,
      countPending: 1,
      countOverdue: 1,
    });

    const nomes = new Map([
      ["t1", "SMS Oriximiná"],
      ["t2", "SMS Santarém"],
      ["t3", "FMS Belém"],
    ]);
    expect(filtrarFaturasMaster(faturas, { status: "overdue" }, nomes)).toHaveLength(1);
    expect(filtrarFaturasMaster(faturas, { busca: "oriximiná" }, nomes)).toHaveLength(1);
    expect(filtrarFaturasMaster(faturas, { competencia: "2026-12" }, nomes)).toHaveLength(1);
  });

  it("agrupa faturas por mês para gráfico financeiro e gera alertas/ranking de saúde", () => {
    const faturas = [
      {
        id: "f1",
        tenant_id: "t1",
        reference_month: "2026-11",
        amount: 1990,
        due_date: "2026-11-10",
        status: "paid",
        payment_method: "pix",
        external_reference: null,
      },
      {
        id: "f2",
        tenant_id: "t2",
        reference_month: "2026-11",
        amount: 3000,
        due_date: "2026-11-05",
        status: "overdue",
        payment_method: "boleto",
        external_reference: null,
      },
    ];

    expect(agruparFaturasPorMes(faturas)).toEqual([
      { mes: "2026-11", recebido: 1990, pendente: 0, atrasado: 3000 },
    ]);

    const alerts = gerarAlertasSaudePlataforma({
      tenants: tenants.map((t) => ({
        ...t,
        max_users: 10,
        trial_ends_at: t.id === "t2" ? "2026-11-26T00:00:00Z" : null,
      })),
      activeUsersByTenant: { t1: 9, t2: 2, t3: 1 },
      aiUsageByTenant: { t1: { requests: 20, tokens: 1000, costUsd: 25 } },
      aiLimitsByTenant: { t1: { monthly_budget_usd: 30, monthly_token_limit: null } },
      invoices: faturas,
      nowMs: new Date("2026-11-24T12:00:00Z").getTime(),
    });

    expect(alerts.some((a) => a.kind === "overdue_invoice" && a.tenantId === "t2")).toBe(true);
    expect(alerts.some((a) => a.kind === "trial_expiring" && a.tenantId === "t2")).toBe(true);
    expect(alerts.some((a) => a.kind === "user_limit" && a.tenantId === "t1")).toBe(true);
    expect(alerts.some((a) => a.kind === "ai_quota" && a.tenantId === "t1")).toBe(true);

    const ranking = montarRankingSecretarias({
      tenants: tenants.map((t) => ({ ...t, max_users: 10 })),
      activeUsersByTenant: { t1: 9, t2: 2, t3: 1 },
      aiUsageByTenant: { t1: { requests: 20, tokens: 1000, costUsd: 1.5 } },
      usageByTenant: {
        t1: { suppliers_count: 15, processes_count: 10, contracts_count: 5, documents_count: 8 },
      },
    });
    expect(ranking[0]?.tenantId).toBe("t1");
    expect(ranking[0]?.processes).toBe(10);
  });
});
