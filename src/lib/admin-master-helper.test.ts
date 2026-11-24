// =============================================================================
// admin-master-helper.test.ts — Testes unitários do Backoffice Master
// Primus Gestão — Fase 2 Painel Master
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  agruparClientesPorPlano,
  agruparClientesPorStatus,
  filtrarAuditoriaMaster,
  filtrarClientesMaster,
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
      { tenant_id: "t1", requests: 10, input_tokens: 1000, output_tokens: 500, estimated_cost_usd: 0.02 },
      { tenant_id: "t1", requests: 5, input_tokens: 300, output_tokens: 200, estimated_cost_usd: 0.01 },
    ]);

    expect(resumo["t1"]).toEqual({
      requests: 15,
      tokens: 2000,
      costUsd: 0.03,
    });
  });
});
