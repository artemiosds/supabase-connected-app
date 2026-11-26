// =============================================================================
// supplier-portal.test.ts — Testes unitários do Portal do Fornecedor
// Primus Gestão — Fase 2.1 — Entrega 7
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  formatarStatusTokenPortal,
  resumirChecklistPortal,
  rotuloChecklistPortal,
  validarLinkDocumentoPortal,
} from "./supplier-portal";

describe("supplier-portal: helpers de interface", () => {
  it("deve rotular corretamente os status de checklist do portal", () => {
    expect(rotuloChecklistPortal("not_submitted").label).toBe("Pendente de Envio");
    expect(rotuloChecklistPortal("not_submitted").variante).toBe("outline");

    expect(rotuloChecklistPortal("received").label).toBe("Recebido / Em Análise");
    expect(rotuloChecklistPortal("received").variante).toBe("secondary");

    expect(rotuloChecklistPortal("awaiting_review").label).toBe("Aguardando Conferência");
    expect(rotuloChecklistPortal("awaiting_review").variante).toBe("secondary");

    expect(rotuloChecklistPortal("verified").label).toBe("Aprovado / Regular");
    expect(rotuloChecklistPortal("verified").variante).toBe("default");

    expect(rotuloChecklistPortal("pending_issue").label).toBe("Inconsistência / Reenviar");
    expect(rotuloChecklistPortal("pending_issue").variante).toBe("destructive");

    expect(rotuloChecklistPortal("expired").label).toBe("Expirado / Renovar");
    expect(rotuloChecklistPortal("expired").variante).toBe("destructive");
  });

  it("valida links externos bloqueando vazio, esquemas inseguros e credenciais", () => {
    expect(validarLinkDocumentoPortal("   ").valid).toBe(false);
    expect(validarLinkDocumentoPortal("javascript:alert(1)").valid).toBe(false);
    expect(validarLinkDocumentoPortal("data:text/html,hi").valid).toBe(false);
    expect(validarLinkDocumentoPortal("https://user:pass@example.com/doc.pdf").valid).toBe(false);

    const ok = validarLinkDocumentoPortal("  https://receita.gov.br/certidao/123.pdf  ");
    expect(ok).toEqual({
      valid: true,
      url: "https://receita.gov.br/certidao/123.pdf",
    });
  });

  it("resume itens pendentes, recebidos e obrigatórios da checklist", () => {
    const resumo = resumirChecklistPortal([
      {
        id: "1",
        title: "CND Federal",
        document_type: "certidao_federal",
        is_mandatory: true,
        verification_status: "verified",
      },
      {
        id: "2",
        title: "FGTS",
        document_type: "fgts",
        is_mandatory: true,
        verification_status: "not_submitted",
      },
      {
        id: "3",
        title: "Alvará",
        document_type: "alvara",
        is_mandatory: false,
        verification_status: "received",
      },
    ]);
    expect(resumo).toEqual({
      total: 3,
      pendentes: 1,
      recebidos: 1,
      aprovados: 1,
      obrigatoriosPendentes: 1,
    });
  });

  it("classifica status de token ativo, expirado e revogado", () => {
    const refNow = Date.parse("2026-11-26T12:00:00Z");
    expect(
      formatarStatusTokenPortal({ is_revoked: true, expires_at: "2099-01-01T00:00:00Z" }, refNow)
        .label,
    ).toBe("Revogado");
    expect(
      formatarStatusTokenPortal({ is_revoked: false, expires_at: "2020-01-01T00:00:00Z" }, refNow)
        .label,
    ).toBe("Expirado");
    expect(
      formatarStatusTokenPortal({ is_revoked: false, expires_at: "2099-01-01T00:00:00Z" }, refNow)
        .active,
    ).toBe(true);
  });
});
