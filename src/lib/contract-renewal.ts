export type RegimeJuridicoRenovacao =
  "lei_14133" | "lei_8666" | "lei_13303" | "special" | "not_identified";

export type NaturezaContratoRenovacao =
  | "continuous_service"
  | "continuous_supply"
  | "scope"
  | "ata"
  | "special"
  | "other"
  | "unclassified";

export function podeUsarMinutaProrrogacao(
  instrumentType: string,
  regime: RegimeJuridicoRenovacao,
  natureza: NaturezaContratoRenovacao,
): boolean {
  return (
    instrumentType === "contrato" &&
    regime === "lei_14133" &&
    (natureza === "continuous_service" || natureza === "continuous_supply")
  );
}

/**
 * Variação do preço contratado em relação à referência de mercado.
 * Resultado positivo: preço contratado acima da referência.
 * Resultado negativo: preço contratado abaixo da referência.
 * O cálculo é apenas comparativo; não decide automaticamente a vantajosidade.
 */
export function calcularVariacaoPrecoPercentual(
  valorContratado: number | null,
  valorReferencia: number | null,
): number | null {
  if (
    valorContratado === null ||
    valorReferencia === null ||
    !Number.isFinite(valorContratado) ||
    !Number.isFinite(valorReferencia) ||
    valorContratado < 0 ||
    valorReferencia <= 0
  ) {
    return null;
  }

  return ((valorContratado - valorReferencia) / valorReferencia) * 100;
}
