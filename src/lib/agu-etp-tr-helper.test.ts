import { describe, expect, it } from "vitest";
import { gerarRoteiroEstruturadoAgu } from "./agu-etp-tr-helper";

describe("agu-etp-tr-helper (IN SEGES 58/2022 e 81/2022)", () => {
  it("gera roteiro completo de ETP conforme art. 18 § 1º e Súmula 247 TCU", () => {
    const texto = gerarRoteiroEstruturadoAgu({
      tipo: "etp",
      objeto: "Aquisição de medicamentos básicos",
      quantidadeItens: 12,
    });
    expect(texto).toContain("IN SEGES nº 58/2022");
    expect(texto).toContain("Aquisição de medicamentos básicos");
    expect(texto).toContain("12 item(ns)");
    expect(texto).toContain("Súmula nº 247 do TCU");
  });

  it("gera roteiro completo de Termo de Referência conforme IN SEGES 81/2022", () => {
    const texto = gerarRoteiroEstruturadoAgu({
      tipo: "tr",
      objeto: "Serviço de manutenção predial",
      justificativa: "Manter segurança estrutural das unidades de saúde.",
    });
    expect(texto).toContain("IN SEGES nº 81/2022");
    expect(texto).toContain("art. 117 da Lei nº 14.133/2021");
    expect(texto).toContain("Manter segurança estrutural das unidades de saúde.");
  });
});
