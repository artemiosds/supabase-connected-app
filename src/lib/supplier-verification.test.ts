import { describe, expect, it } from "vitest";
import { parseSupplierVerification, serializeSupplierVerification } from "./supplier-verification";
const verification = {
  consultado_em: "2026-11-21T13:30:00Z",
  situacao: "ATIVA",
  fonte: "BrasilAPI",
  qsa_count: 2,
  cnpj: "12345678000195",
};
describe("supplier verification", () => {
  it("roundtrips notes and replaces metadata without duplicating it", () => {
    const first = serializeSupplierVerification("Observação original", verification);
    const next = serializeSupplierVerification(first, { ...verification, qsa_count: 3 });
    expect(parseSupplierVerification(next)).toEqual({
      notes: "Observação original",
      verification: { ...verification, qsa_count: 3 },
    });
    expect(next.match(/RFB_VERIFICATION/g)).toHaveLength(1);
  });
  it("preserves unrecognized content and prevents loss at the database limit", () => {
    expect(parseSupplierVerification("texto <!-- RFB_VERIFICATION:broken -->").notes).toContain(
      "broken",
    );
    expect(() => serializeSupplierVerification("x".repeat(1999), verification)).toThrow("2.000");
  });
  it("escapes delimiter content and can remove verification", () => {
    const notes = serializeSupplierVerification("Original", {
      ...verification,
      fonte: "Origem --> <script>",
    });
    expect(parseSupplierVerification(notes).verification?.fonte).toBe("Origem --> <script>");
    expect(serializeSupplierVerification(notes, null)).toBe("Original");
  });
});
