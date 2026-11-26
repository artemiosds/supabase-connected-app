import { describe, expect, it } from "vitest";
import {
  calcularLimitesArt125,
  calcularLimiteVigenciaInstrumento,
  validarNovoAditivo,
} from "./contract-amendments";

describe("calcularLimiteVigenciaInstrumento (arts. 84 e 107 Lei 14.133)", () => {
  it("limita Ata de Registro de Preços a 24 meses inclusivos", () => {
    expect(calcularLimiteVigenciaInstrumento("2026-01-01", "ata_registro_precos")).toEqual({
      limiteData: "2027-12-31",
      maxMeses: 24,
    });
  });

  it("limita contratos contínuos a 120 meses inclusivos", () => {
    expect(calcularLimiteVigenciaInstrumento("2026-01-01", "contrato")).toEqual({
      limiteData: "2035-12-31",
      maxMeses: 120,
    });
  });

  it("trata 29 de fevereiro sem transbordar mês", () => {
    expect(calcularLimiteVigenciaInstrumento("2024-02-29", "ata_registro_precos")).toEqual({
      limiteData: "2026-02-27",
      maxMeses: 24,
    });
  });
});

describe("calcularLimitesArt125 (vedação de compensação e valor inicial atualizado)", () => {
  it("não compensa acréscimo com supressão conforme jurisprudência do TCU", () => {
    // Original = 1000. Acréscimo +200 (20%) + Supressão -200 (20%) => vigente atual = 1000.
    // Sem compensação, o saldo restante de acréscimo é apenas +50 (5%), e não 250!
    const resumo = calcularLimitesArt125({
      valorVigenteAtual: 1000,
      aditivos: [
        { kind: "acrescimo", value_change: 200 },
        { kind: "supressao", value_change: -200 },
      ],
    });

    expect(resumo.baseValida).toBe(true);
    expect(resumo.valorOriginalContrato).toBe(1000);
    expect(resumo.valorInicialAtualizado).toBe(1000);
    expect(resumo.percentualAcrescimos).toBe(20);
    expect(resumo.percentualSupressoes).toBe(20);
    expect(resumo.saldoAcrescimoDisponivel).toBe(50);
    expect(resumo.saldoSupressaoUnilateralDisponivel).toBe(50);
  });

  it("atualiza a base de cálculo quando há reajuste/apostilamento (art. 125 caput)", () => {
    // Original = 1000 + reajuste +100 => valor inicial atualizado = 1100.
    // 25% de 1100 = 275 (e não 250).
    const resumo = calcularLimitesArt125({
      valorVigenteAtual: 1100,
      aditivos: [{ kind: "reajuste", value_change: 100 }],
    });

    expect(resumo.valorOriginalContrato).toBe(1000);
    expect(resumo.totalReajustesApostilamentos).toBe(100);
    expect(resumo.valorInicialAtualizado).toBe(1100);
    expect(resumo.valorMaximoAcrescimo).toBe(275);
    expect(resumo.saldoAcrescimoDisponivel).toBe(275);
  });

  it("permite 50% de acréscimo apenas para reforma de edifício/equipamento, mantendo supressão em 25%", () => {
    const resumo = calcularLimitesArt125({
      valorVigenteAtual: 1000,
      aditivos: [],
      isReformaEdificioOuEquipamento: true,
    });

    expect(resumo.limiteAcrescimoPct).toBe(50);
    expect(resumo.limiteSupressaoPct).toBe(25);
    expect(resumo.valorMaximoAcrescimo).toBe(500);
    expect(resumo.valorMaximoSupressaoUnilateral).toBe(250);
  });
});

describe("validarNovoAditivo", () => {
  const contratoBase = {
    status: "vigente",
    instrument_type: "contrato",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    total_value: 1000,
  };

  it("bloqueia aditivos em instrumentos rescindidos ou arquivados", () => {
    const res = validarNovoAditivo({
      contrato: { ...contratoBase, status: "rescindido" },
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º Termo Aditivo",
        tipo: "acrescimo",
        dataAssinatura: "2026-11-26",
        valorNumerico: 100,
        observacoes: "Acréscimo emergencial devidamente justificado nos autos.",
      },
      hoje: "2026-11-26",
    });

    expect(res.valido).toBe(false);
    expect(res.erro).toContain("rescindidos ou arquivados");
  });

  it("exige justificativa mínima de 10 caracteres (art. 124)", () => {
    const res = validarNovoAditivo({
      contrato: contratoBase,
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º Termo Aditivo",
        tipo: "acrescimo",
        dataAssinatura: "2026-11-26",
        valorNumerico: 100,
        observacoes: "Curto",
      },
      hoje: "2026-11-26",
    });

    expect(res.valido).toBe(false);
    expect(res.erro).toContain("10 caracteres");
  });

  it("bloqueia acréscimo em Ata de Registro de Preços (Decreto 11.462/2023)", () => {
    const res = validarNovoAditivo({
      contrato: { ...contratoBase, instrument_type: "ata_registro_precos" },
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º Termo Aditivo",
        tipo: "acrescimo",
        dataAssinatura: "2026-11-26",
        valorNumerico: 100,
        observacoes: "Tentativa de acréscimo indevido em Ata de Registro de Preços.",
      },
      hoje: "2026-11-26",
    });

    expect(res.valido).toBe(false);
    expect(res.erro).toContain("Ata de Registro de Preços");
  });

  it("bloqueia prorrogação de ARP além de 24 meses e prorrogação retroativa", () => {
    const arp = { ...contratoBase, instrument_type: "ata_registro_precos" };

    const alem24m = validarNovoAditivo({
      contrato: arp,
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º Termo Aditivo",
        tipo: "prorrogacao",
        novaData: "2028-01-01",
        dataAssinatura: "2026-11-26",
        observacoes: "Prorrogação de ARP com comprovação de vantajosidade de preços.",
      },
      hoje: "2026-11-26",
    });
    expect(alem24m.valido).toBe(false);
    expect(alem24m.erro).toContain("24 meses");

    const retroativa = validarNovoAditivo({
      contrato: contratoBase,
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º Termo Aditivo",
        tipo: "prorrogacao",
        novaData: "2027-12-31",
        dataAssinatura: "2027-01-02",
        observacoes: "Tentativa de prorrogação após vencimento da vigência contratual.",
      },
      hoje: "2027-01-05",
    });
    expect(retroativa.valido).toBe(false);
    expect(retroativa.erro).toContain("retroativa");
  });

  it("bloqueia acréscimo acima de 25% mesmo havendo supressão anterior, mas libera até 50% para reforma", () => {
    const aditivos = [
      { number: "1º TA", kind: "acrescimo", value_change: 200 },
      { number: "2º TA", kind: "supressao", value_change: -200 },
    ];

    const excede = validarNovoAditivo({
      contrato: contratoBase,
      aditivosExistentes: aditivos,
      novoAditivo: {
        numero: "3º TA",
        tipo: "acrescimo",
        dataAssinatura: "2026-11-26",
        valorNumerico: 100, // 200 + 100 = 30% > 25%
        observacoes: "Acréscimo de quantitativo além do saldo remanescente de 5%.",
      },
      hoje: "2026-11-26",
    });
    expect(excede.valido).toBe(false);
    expect(excede.erro).toContain("25%");

    const reforma = validarNovoAditivo({
      contrato: contratoBase,
      aditivosExistentes: aditivos,
      novoAditivo: {
        numero: "3º TA",
        tipo: "acrescimo",
        dataAssinatura: "2026-11-26",
        valorNumerico: 250, // 200 + 250 = 45% <= 50%
        observacoes: "Acréscimo em reforma predial devidamente justificada.",
        isReformaEdificioOuEquipamento: true,
      },
      hoje: "2026-11-26",
    });
    expect(reforma.valido).toBe(true);
    expect(reforma.valorChange).toBe(250);
    expect(reforma.novoValorContrato).toBe(1250);
  });

  it("exige confirmação de acordo consensual para supressão acumulada acima de 25%", () => {
    const semAcordo = validarNovoAditivo({
      contrato: contratoBase,
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º TA",
        tipo: "supressao",
        dataAssinatura: "2026-11-26",
        valorNumerico: 300,
        observacoes: "Supressão bilateral de 30% conforme acordo entre as partes.",
      },
      hoje: "2026-11-26",
    });
    expect(semAcordo.valido).toBe(false);
    expect(semAcordo.erro).toContain("consensual");

    const comAcordo = validarNovoAditivo({
      contrato: contratoBase,
      aditivosExistentes: [],
      novoAditivo: {
        numero: "1º TA",
        tipo: "supressao",
        dataAssinatura: "2026-11-26",
        valorNumerico: 300,
        observacoes: "Supressão bilateral de 30% conforme acordo entre as partes.",
        supressaoConsensualConfirmada: true,
      },
      hoje: "2026-11-26",
    });
    expect(comAcordo.valido).toBe(true);
    expect(comAcordo.valorChange).toBe(-300);
    expect(comAcordo.novoValorContrato).toBe(700);
  });
});
