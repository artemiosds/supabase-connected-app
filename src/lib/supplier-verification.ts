export type SupplierVerification = {
  consultado_em: string;
  situacao: string;
  fonte: string;
  qsa_count: number;
  cnpj?: string;
};
const block = /<!-- RFB_VERIFICATION:([^]*?) -->/g;

function valid(value: unknown): value is SupplierVerification {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["consultado_em"] === "string" &&
    Number.isFinite(Date.parse(v["consultado_em"])) &&
    typeof v["situacao"] === "string" &&
    v["situacao"].length <= 100 &&
    typeof v["fonte"] === "string" &&
    v["fonte"].length <= 150 &&
    typeof v["qsa_count"] === "number" &&
    Number.isInteger(v["qsa_count"]) &&
    v["qsa_count"] >= 0 &&
    (v["cnpj"] === undefined || typeof v["cnpj"] === "string")
  );
}

export function parseSupplierVerification(notes: string | null | undefined): {
  notes: string;
  verification: SupplierVerification | null;
} {
  let verification: SupplierVerification | null = null;
  const text = (notes ?? "")
    .replace(block, (full: string, json: string) => {
      try {
        const value: unknown = JSON.parse(json);
        if (valid(value)) {
          verification = value;
          return "";
        }
      } catch {
        /* Preserve unrecognized notes. */
      }
      return full;
    })
    .trimEnd();
  return { notes: text, verification };
}

export function serializeSupplierVerification(
  notes: string,
  data: SupplierVerification | null,
): string {
  if (data && !valid(data)) throw new Error("Verificação cadastral inválida.");
  const human = parseSupplierVerification(notes).notes;
  const encoded = data
    ? JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    : "";
  const result =
    human + (data ? (human ? "\n" : "") + "<!-- RFB_VERIFICATION:" + encoded + " -->" : "");
  if ([...result].length > 2000)
    throw new Error(
      "As observações e a verificação excedem 2.000 caracteres. Reduza as observações para salvar.",
    );
  return result;
}
