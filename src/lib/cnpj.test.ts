import { describe, expect, it } from "vitest";
import { formatarCnpj, normalizarCnpj, validarCnpj } from "./cnpj";

function gerarDigitos(base: string): string {
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const digito = (texto: string, pesos: number[]) => {
    const soma = [...texto].reduce((total, c, i) => total + (c.charCodeAt(0) - 48) * pesos[i], 0);
    const resto = soma % 11;
    return String(resto < 2 ? 0 : 11 - resto);
  };
  const primeiro = digito(base, pesos1);
  return primeiro + digito(base + primeiro, pesos2);
}

describe("CNPJ", () => {
  it("normaliza pontuação e letras", () => {
    expect(normalizarCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("aceita CNPJ numérico válido e rejeita DV incorreto", () => {
    expect(validarCnpj("11.222.333/0001-81")).toBe(true);
    expect(validarCnpj("11.222.333/0001-80")).toBe(false);
  });

  it("aceita o exemplo alfanumérico divulgado para validar a regra de cálculo", () => {
    expect(validarCnpj("00.000.000/E08G-12")).toBe(true);
  });

  it("valida CNPJ alfanumérico com dígitos verificadores calculados", () => {
    const base = "12ABC34501DE";
    expect(validarCnpj(base + gerarDigitos(base))).toBe(true);
  });

  it("rejeita tamanho, caracteres inválidos e sequências repetidas", () => {
    expect(validarCnpj("123")).toBe(false);
    expect(validarCnpj("AAAAAAAAAAAAAA")).toBe(false);
    expect(validarCnpj("12ABC34501D@35")).toBe(false);
  });

  it("formata CNPJ alfanumérico", () => {
    expect(formatarCnpj("12abc34501de35")).toBe("12.ABC.345/01DE-35");
  });
});
