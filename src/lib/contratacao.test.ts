import { describe, expect, it } from "vitest";
import { diasAte, nivelAlerta, numeroDecimal, proximaEtapa, etapaAnterior } from "./contratacao";

describe("régua de vencimento 120/90/60/30", () => {
  it("120 dias ainda é alerta de planejamento", () => expect(nivelAlerta(120)).toBe("120"));
  it("121 dias está em dia", () => expect(nivelAlerta(121)).toBe("ok"));
  it("90 dias", () => expect(nivelAlerta(90)).toBe("90"));
  it("60 dias", () => expect(nivelAlerta(60)).toBe("60"));
  it("30 dias e o próprio dia do vencimento são urgentes", () => {
    expect(nivelAlerta(30)).toBe("30");
    expect(nivelAlerta(0)).toBe("30");
  });
  it("dia seguinte ao fim é vencido", () => expect(nivelAlerta(-1)).toBe("vencido"));
  it("conta dias corridos", () => expect(diasAte("2026-12-06", new Date(2026, 10, 6))).toBe(30));
});

describe("esteira de etapas", () => {
  it("DFD avança para estudos", () => expect(proximaEtapa("planejamento")).toBe("estudos"));
  it("conclusão é a última etapa", () => expect(proximaEtapa("conclusao")).toBeNull());
  it("planejamento não tem etapa anterior", () => expect(etapaAnterior("planejamento")).toBeNull());
});


describe("conversão de valores decimais", () => {
  it("interpreta moeda no formato brasileiro com milhar e decimal", () => {
    expect(numeroDecimal("1.234,56")).toBe(1234.56);
    expect(numeroDecimal("R$ 1.234,56")).toBe(1234.56);
    expect(numeroDecimal("1234,56")).toBe(1234.56);
    expect(numeroDecimal("1,234")).toBe(1.234);
  });

  it("aceita decimal com ponto e formato internacional", () => {
    expect(numeroDecimal("1234.56")).toBe(1234.56);
    expect(numeroDecimal("1,234.56")).toBe(1234.56);
  });

  it("reconhece grupos de milhares repetidos", () => {
    expect(numeroDecimal("1.234.567")).toBe(1234567);
    expect(numeroDecimal("1,234,567")).toBe(1234567);
  });

  it("não transforma entrada vazia ou malformada em zero", () => {
    expect(Number.isNaN(numeroDecimal(""))).toBe(true);
    expect(Number.isNaN(numeroDecimal("12,3,4"))).toBe(true);
    expect(Number.isNaN(numeroDecimal("R$"))).toBe(true);
  });
});
