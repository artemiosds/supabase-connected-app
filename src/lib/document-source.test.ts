import { describe, expect, it } from "vitest";
import { valuesForUneditedSource } from "./document-source";

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
