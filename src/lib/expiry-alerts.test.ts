import { describe, expect, it } from "vitest";
import {
  calcularAvisosVencimento,
  dataLimiteAvisosISO,
  type ContratoParaAlerta,
  type DocumentoParaAlerta,
} from "./expiry-alerts";

const hoje = new Date(2026, 10, 10);

describe("alertas de vencimento", () => {
  it("calcula o limite de 120 dias sem depender do fuso UTC", () => {
    expect(dataLimiteAvisosISO(hoje)).toBe("2027-03-10");
  });

  it("combina contratos e documentos e ordena do vencimento mais próximo", () => {
    const contratos: ContratoParaAlerta[] = [
      { id: "c1", number: "2026/02", end_date: "2026-12-10" },
      { id: "c2", number: "2026/01", end_date: "2026-11-05" },
    ];
    const documentos: DocumentoParaAlerta[] = [
      {
        id: "d1",
        title: "Certidão Federal",
        expires_at: "2026-11-10",
        suppliers: { legal_name: "Fornecedor Um Ltda.", trade_name: "Fornecedor Um" },
      },
      {
        id: "d2",
        title: "Contrato social",
        expires_at: null,
        suppliers: { legal_name: "Fornecedor Dois Ltda.", trade_name: null },
      },
    ];

    const avisos = calcularAvisosVencimento(contratos, documentos, hoje);

    expect(avisos.map((aviso) => aviso.id)).toEqual(["c2", "d1", "c1"]);
    expect(avisos[0]).toMatchObject({
      tipo: "Contrato",
      nivel: "vencido",
      dias: -5,
      destino: "/contratos",
    });
    expect(avisos[1]).toMatchObject({
      tipo: "Documento",
      complemento: "Fornecedor: Fornecedor Um",
      nivel: "30",
      dias: 0,
      destino: "/documentos",
    });
  });

  it("usa a razão social quando o nome fantasia não existe", () => {
    const avisos = calcularAvisosVencimento(
      [],
      [
        {
          id: "d1",
          title: "FGTS",
          expires_at: "2026-12-10",
          suppliers: { legal_name: "Fornecedor Ltda.", trade_name: null },
        },
      ],
      hoje,
    );

    expect(avisos[0]?.complemento).toBe("Fornecedor: Fornecedor Ltda.");
  });

  it("não cria alerta para documento sem vencimento", () => {
    const avisos = calcularAvisosVencimento(
      [],
      [{ id: "d1", title: "Cadastro", expires_at: null, suppliers: null }],
      hoje,
    );

    expect(avisos).toEqual([]);
  });
});
