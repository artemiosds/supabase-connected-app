// =============================================================================
// supplier-portal.test.ts — Testes unitários do Portal do Fornecedor
// Primus Gestão — Fase 2.1 — Entrega 7
// =============================================================================

import { describe, it, expect } from "vitest";
import { rotuloChecklistPortal } from "./supplier-portal";

describe("supplier-portal: helpers de interface", () => {
  it("deve rotular corretamente os status de checklist do portal", () => {
    expect(rotuloChecklistPortal("not_submitted").label).toBe("Pendente de Envio");
    expect(rotuloChecklistPortal("not_submitted").variante).toBe("outline");

    expect(rotuloChecklistPortal("received").label).toBe("Recebido / Em Análise");
    expect(rotuloChecklistPortal("received").variante).toBe("secondary");

    expect(rotuloChecklistPortal("verified").label).toBe("Aprovado / Regular");
    expect(rotuloChecklistPortal("verified").variante).toBe("default");

    expect(rotuloChecklistPortal("pending_issue").label).toBe("Inconsistência / Reenviar");
    expect(rotuloChecklistPortal("pending_issue").variante).toBe("destructive");

    expect(rotuloChecklistPortal("expired").label).toBe("Expirado / Renovar");
    expect(rotuloChecklistPortal("expired").variante).toBe("destructive");
  });
});
