import { describe, expect, it } from "vitest";
import { isMissingDocumentTemplateSourcesTable, valuesForUneditedSource } from "./document-source";

describe("binary Word source selection", () => {
  it("uses the original only for the exact server merged snapshot", () => {
    const values = { numero_processo: "42/2026", objeto: "Medicamentos" };
    expect(
      valuesForUneditedSource("{{numero_processo}}: {{objeto}}", "42/2026: Medicamentos", values),
    ).toEqual(values);
    expect(
      valuesForUneditedSource("{{numero_processo}}: {{objeto}}", "42/2026: Insumos", values),
    ).toBeNull();
  });

  it("rejects missing and non-string snapshot values", () => {
    expect(valuesForUneditedSource("{{numero_processo}}", "42/2026", null)).toBeNull();
    expect(
      valuesForUneditedSource("{{numero_processo}}", "42/2026", { numero_processo: 42 }),
    ).toBeNull();
  });
});

describe("optional binary-source schema compatibility", () => {
  it("recognizes only missing-table errors for the optional source table", () => {
    expect(isMissingDocumentTemplateSourcesTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingDocumentTemplateSourcesTable({ code: "42P01" })).toBe(true);
    expect(isMissingDocumentTemplateSourcesTable({ code: "42501" })).toBe(false);
    expect(isMissingDocumentTemplateSourcesTable(null)).toBe(false);
  });
});
