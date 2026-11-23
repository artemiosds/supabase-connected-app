import { describe, expect, it } from "vitest";
import {
  calcularNovaDataVigencia,
  gerarJustificativaProrrogacao,
  identificarMesesVigencia,
  sugerirProximoNumeroAditivo,
  validarPayloadProrrogacao,
} from "./contract-extension-helper";

describe("sugerirProximoNumeroAditivo", () => {
  it("começa pelo primeiro termo quando não há aditivos", () => {
    expect(sugerirProximoNumeroAditivo([])).toBe("1º Termo Aditivo");
  });

  it("avança o ordinal de um termo aditivo já registrado", () => {
    expect(sugerirProximoNumeroAditivo([{ number: "1º Termo Aditivo" }])).toBe("2º Termo Aditivo");
  });

  it("reconhece numeração simples depois da palavra aditivo", () => {
    expect(sugerirProximoNumeroAditivo([{ number: "Aditivo 2", kind: "acrescimo" }])).toBe(
      "3º Termo Aditivo",
    );
  });

  it("usa a maior numeração existente, mesmo quando há tipos diferentes", () => {
    expect(
      sugerirProximoNumeroAditivo([
        { number: "1º Termo Aditivo", kind: "prorrogacao" },
        { number: "Aditivo 4", kind: "acrescimo" },
        { number: "3º Termo Aditivo", kind: "supressao" },
      ]),
    ).toBe("5º Termo Aditivo");
  });

  it("usa a quantidade de registros quando nenhum número pode ser extraído", () => {
    expect(
      sugerirProximoNumeroAditivo([{ number: "Aditivo especial" }, { number: "Complemento" }]),
    ).toBe("3º Termo Aditivo");
  });
});

describe("calcularNovaDataVigencia", () => {
  it("soma exatamente doze meses a partir do dia seguinte ao fim atual", () => {
    expect(calcularNovaDataVigencia("2026-12-31", 12)).toBe("2027-12-31");
  });

  it("soma seis meses e preserva o período mensal inclusivo", () => {
    expect(calcularNovaDataVigencia("2026-03-31", 6)).toBe("2026-09-30");
  });

  it("ajusta o fim do mês sem transbordar para o mês seguinte", () => {
    expect(calcularNovaDataVigencia("2026-01-31", 1)).toBe("2026-02-28");
    expect(calcularNovaDataVigencia("2026-01-30", 1)).toBe("2026-02-27");
    expect(calcularNovaDataVigencia("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("não altera o valor original quando a data ou o prazo são inválidos", () => {
    expect(calcularNovaDataVigencia("data-invalida", 12)).toBe("data-invalida");
    expect(calcularNovaDataVigencia("2026-12-31", 0)).toBe("2026-12-31");
    expect(calcularNovaDataVigencia("2026-12-31", 1.5)).toBe("2026-12-31");
  });

  it("identifica o prazo mensal correspondente à data editada", () => {
    expect(identificarMesesVigencia("2026-12-31", "2027-12-31")).toBe(12);
    expect(identificarMesesVigencia("2026-12-31", "2027-06-30")).toBe(6);
    expect(identificarMesesVigencia("2026-12-31", "2027-06-29")).toBeNull();
  });
});

describe("gerarJustificativaProrrogacao", () => {
  it("gera texto preliminar com contrato, fornecedor, prazo e fundamento legal", () => {
    const justificativa = gerarJustificativaProrrogacao({
      contractNumber: "042/2026",
      supplierName: "Fornecedor Exemplo Ltda.",
      meses: 12,
      novaData: "2027-12-31",
    });

    expect(justificativa).toContain("Contrato nº 042/2026");
    expect(justificativa).toContain("Fornecedor Exemplo Ltda.");
    expect(justificativa).toContain("12 meses");
    expect(justificativa).toContain("2027-12-31");
    expect(justificativa).toContain("art. 107");
    expect(justificativa).toContain("texto preliminar");
  });
});

describe("validarPayloadProrrogacao", () => {
  const base = {
    contractId: "contract-1",
    dataFimAtual: "2026-12-31",
    novaData: "2027-12-31",
    numeroAditivo: "1º Termo Aditivo",
    dataAssinatura: "2026-11-23",
    hoje: "2026-11-23",
  };

  it("aceita um payload válido", () => {
    expect(validarPayloadProrrogacao(base)).toEqual({ valido: true });
  });

  it("rejeita nova data anterior ou igual ao fim atual", () => {
    expect(validarPayloadProrrogacao({ ...base, novaData: "2026-12-30" }).valido).toBe(false);
    expect(validarPayloadProrrogacao({ ...base, novaData: "2026-12-31" }).valido).toBe(false);
  });

  it("rejeita data de assinatura futura", () => {
    expect(validarPayloadProrrogacao({ ...base, dataAssinatura: "2026-11-24" })).toMatchObject({
      valido: false,
      erro: "A data de assinatura não pode ser futura.",
    });
  });

  it("rejeita número vazio ou acima de sessenta caracteres", () => {
    expect(validarPayloadProrrogacao({ ...base, numeroAditivo: "   " }).valido).toBe(false);
    expect(validarPayloadProrrogacao({ ...base, numeroAditivo: "A".repeat(61) }).valido).toBe(
      false,
    );
  });

  it("rejeita contrato, datas e assinatura inválidos", () => {
    expect(validarPayloadProrrogacao({ ...base, contractId: " " }).valido).toBe(false);
    expect(validarPayloadProrrogacao({ ...base, novaData: "2027-02-30" }).valido).toBe(false);
    expect(validarPayloadProrrogacao({ ...base, dataAssinatura: "2026-11-32" }).valido).toBe(false);
  });
});
