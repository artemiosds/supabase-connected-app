import { describe, expect, it } from "vitest";
import {
  combineCnpjResults,
  cnpjDivergente,
  mapCnpjProvider,
  providerFailed,
} from "./cnpj-mapping";

const CNPJ = "11222333000181";

describe("mapeamento da consulta de CNPJ", () => {
  it("normaliza os campos cadastrais e preserva dados ausentes como null", () => {
    const result = mapCnpjProvider(
      {
        cnpj: CNPJ,
        razao_social: "Empresa Exemplo LTDA",
        nome_fantasia: "Exemplo Saúde",
        logradouro: "Rua das Flores",
        numero: "123",
        cep: "66000-000",
        municipio: "Belém",
        uf: "PA",
        ddd_telefone_1: "91",
        telefone_1: "33334444",
        email: "CONTATO@EXEMPLO.COM",
        situacao: "ATIVA",
        capital_social: "1.234,56",
      },
      "Minha Receita",
      new Date("2026-11-17T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      cnpj: CNPJ,
      legal_name: "Empresa Exemplo LTDA",
      trade_name: "Exemplo Saúde",
      street: "Rua das Flores",
      street_number: "123",
      postal_code: "66000000",
      city: "Belém",
      state: "PA",
      contact_phone: "9133334444",
      contact_email: "contato@exemplo.com",
      registration_status: "ATIVA",
      share_capital: 1234.56,
      source: "Minha Receita",
    });
    expect(result.website).toBeNull();
  });

  it("não copia CPF de sócios para os dados normalizados", () => {
    const result = mapCnpjProvider(
      {
        cnpj: CNPJ,
        razao_social: "Empresa Exemplo LTDA",
        qsa: [{ nome_socio: "Pessoa Sócia", cpf_cnpj_socio: "12345678901" }],
      },
      "BrasilAPI",
    );

    expect(result.partners).toEqual([
      { name: "Pessoa Sócia", qualification: null, age_range: null },
    ]);
    expect(JSON.stringify(result)).not.toContain("12345678901");
  });

  it("descarta resultados de outro CNPJ ao combinar fontes", () => {
    const correto = mapCnpjProvider(
      { cnpj: CNPJ, razao_social: "Empresa Correta" },
      "Minha Receita",
    );
    const divergente = mapCnpjProvider(
      { cnpj: "22333444000199", razao_social: "Empresa Incorreta" },
      "BrasilAPI",
    );

    expect(cnpjDivergente(divergente, CNPJ)).toBe(true);
    expect(combineCnpjResults([divergente, correto], CNPJ)?.legal_name).toBe("Empresa Correta");
  });

  it("complementa campos vazios usando outra fonte sem substituir os já encontrados", () => {
    const principal = mapCnpjProvider(
      { cnpj: CNPJ, razao_social: "Empresa Exemplo LTDA" },
      "Minha Receita",
    );
    const complementar = mapCnpjProvider(
      {
        cnpj: CNPJ,
        razao_social: "Nome divergente não deve substituir",
        email: "contato@exemplo.com",
        municipio: "Belém",
      },
      "BrasilAPI",
    );

    expect(combineCnpjResults([principal, complementar], CNPJ)).toMatchObject({
      legal_name: "Empresa Exemplo LTDA",
      contact_email: "contato@exemplo.com",
      city: "Belém",
      sources: ["Minha Receita", "BrasilAPI"],
    });
  });

  it("reconhece respostas de erro dos provedores", () => {
    expect(providerFailed({ success: false })).toBe(true);
    expect(providerFailed({ status: "ERROR" })).toBe(true);
    expect(providerFailed({ message: "CNPJ não encontrado" })).toBe(true);
    expect(providerFailed({ cnpj: CNPJ, razao_social: "Empresa Exemplo LTDA" })).toBe(false);
  });
});
