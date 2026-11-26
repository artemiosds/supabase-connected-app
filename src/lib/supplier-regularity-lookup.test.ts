import { describe, expect, it } from "vitest";
import {
  mapearSituacaoRfbParaStatus,
  mapearSituacaoTcuParaStatus,
} from "./supplier-regularity-lookup";

describe("supplier-regularity-lookup: mapeamento TCU / CNJ / CEIS / CNEP e RFB", () => {
  it("mapeia NADA_CONSTA para regular e CONSTA para irregular com alerta", () => {
    expect(mapearSituacaoTcuParaStatus("NADA_CONSTA")).toEqual({
      status: "regular",
      requiresAction: false,
    });
    expect(mapearSituacaoTcuParaStatus("CONSTA")).toEqual({
      status: "irregular",
      requiresAction: true,
    });
    expect(mapearSituacaoTcuParaStatus("INDISPONIVEL")).toEqual({
      status: "pending_review",
      requiresAction: true,
    });
  });

  it("mapeia situação cadastral da Receita Federal corretamente", () => {
    expect(mapearSituacaoRfbParaStatus("ATIVA")).toEqual({
      status: "regular",
      requiresAction: false,
    });
    expect(mapearSituacaoRfbParaStatus("INAPTA")).toEqual({
      status: "irregular",
      requiresAction: true,
    });
    expect(mapearSituacaoRfbParaStatus("BAIXADA")).toEqual({
      status: "irregular",
      requiresAction: true,
    });
  });
});
