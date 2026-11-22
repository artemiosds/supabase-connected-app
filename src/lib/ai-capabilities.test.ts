import { describe, expect, it } from "vitest";
import { AI_FEATURES, isAiFeatureKey, parseAiFeatureSettings } from "./ai-capabilities";

describe("configuração de recursos da IA", () => {
  it("mantém todos os recursos desligados quando não há configuração", () => {
    expect(parseAiFeatureSettings(null)).toEqual({
      assistant: false,
      documents: false,
      price_research: false,
      supplier_documents: false,
      contract_monitoring: false,
      delivery_receiving: false,
      tasks: false,
      email_alerts: false,
    });
  });

  it("aceita somente recursos conhecidos explicitamente ativados", () => {
    expect(
      parseAiFeatureSettings({ assistant: true, documents: "true", tasks: true, unknown: true }),
    ).toMatchObject({ assistant: true, documents: false, tasks: true });
    expect(Object.keys(parseAiFeatureSettings({ assistant: true }))).toHaveLength(
      AI_FEATURES.length,
    );
  });

  it("reconhece apenas chaves de capacidade cadastradas", () => {
    expect(isAiFeatureKey("documents")).toBe(true);
    expect(isAiFeatureKey("publish_without_review")).toBe(false);
  });
});
