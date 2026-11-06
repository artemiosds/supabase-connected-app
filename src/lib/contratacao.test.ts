import { describe, expect, it } from "vitest";
import { diasAte, nivelAlerta, proximaEtapa, etapaAnterior } from "./contratacao";

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
