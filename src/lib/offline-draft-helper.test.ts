// @vitest-environment jsdom
// =============================================================================
// offline-draft-helper.test.ts — Testes unitários de Rascunho Offline
// Primus Gestão — Fase 4
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDraftKey,
  clearDraft,
  hasMeaningfulContent,
  loadDraft,
  saveDraft,
} from "./offline-draft-helper";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("offline-draft-helper", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it("gera chaves com isolamento rigoroso por tenant e usuário", () => {
    const k1 = buildDraftKey("pref-sp", "usr-1", "novo-processo");
    const k2 = buildDraftKey("pref-rj", "usr-1", "novo-processo");
    expect(k1).not.toBe(k2);
    expect(k1).toContain("pref-sp");
    expect(k2).toContain("pref-rj");
  });

  it("salva, carrega e limpa rascunho com sucesso", () => {
    const tenantId = "ten-123";
    const userId = "usr-456";
    const formId = "processo";
    const dados = { number: "10/2026", title: "Medicamentos Farmácia Básica" };

    expect(saveDraft(tenantId, userId, formId, dados)).toBe(true);

    const rascunho = loadDraft<typeof dados>(tenantId, userId, formId);
    expect(rascunho).not.toBeNull();
    expect(rascunho?.data.number).toBe("10/2026");
    expect(rascunho?.data.title).toBe("Medicamentos Farmácia Básica");

    expect(clearDraft(tenantId, userId, formId)).toBe(true);
    expect(loadDraft(tenantId, userId, formId)).toBeNull();
  });

  it("bloqueia leitura caso tenant ou usuário sejam diferentes (prevenção de vazamento)", () => {
    saveDraft("ten-a", "usr-1", "contrato", { valor: 5000 });
    const vazamento = loadDraft("ten-b", "usr-1", "contrato");
    expect(vazamento).toBeNull();
  });

  it("identifica corretamente se o formulário possui conteúdo digitado relevante", () => {
    expect(hasMeaningfulContent({ nome: "", email: "   " })).toBe(false);
    expect(hasMeaningfulContent({ nome: "João", email: "" })).toBe(true);
    expect(hasMeaningfulContent({ itens: [] })).toBe(false);
    expect(hasMeaningfulContent({ itens: [1] })).toBe(true);
  });
});
