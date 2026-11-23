import { describe, expect, it } from "vitest";
import {
  rotuloStatusRegularidade,
  FONTES_OFICIAIS,
  type RegularitySource,
  type RegularityStatus,
} from "./supplier-regularity";

describe("supplier-regularity unit tests", () => {
  it("deve mapear corretamente os rótulos e variantes de status de regularidade", () => {
    expect(rotuloStatusRegularidade("regular").label).toBe("Regular / Nada Consta");
    expect(rotuloStatusRegularidade("regular").badgeVariant).toBe("default");

    expect(rotuloStatusRegularidade("irregular").label).toBe("Irregular / Consta Ocorrência");
    expect(rotuloStatusRegularidade("irregular").badgeVariant).toBe("destructive");

    expect(rotuloStatusRegularidade("pending_review").label).toBe("Em Análise / Divergência");
    expect(rotuloStatusRegularidade("pending_review").badgeVariant).toBe("outline");

    expect(rotuloStatusRegularidade("not_found").label).toBe("Não Localizado");
    expect(rotuloStatusRegularidade("exempt").label).toBe("Dispensado / Não Aplicável");
  });

  it("deve conter fontes oficiais regulamentares essenciais", () => {
    const fontesEsperadas: RegularitySource[] = [
      "rfb_cnpj",
      "ceis_cgu",
      "cnep_cgu",
      "tst_cndt",
      "caixa_fgts",
      "anvisa_afe",
    ];

    for (const fonte of fontesEsperadas) {
      expect(FONTES_OFICIAIS[fonte]).toBeDefined();
      expect(FONTES_OFICIAIS[fonte].label.length).toBeGreaterThan(0);
      expect(FONTES_OFICIAIS[fonte].url.length).toBeGreaterThan(0);
    }
  });
});
