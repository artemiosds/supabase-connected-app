import { expect, it } from "vitest";
import { clearSupplierAutofill, fillEmptySupplierFields } from "./supplier-autofill";

it("clears A's imported identity before filling B and preserves manual contact data", () => {
  const initial = { legal_name: "", city: "", contact: "Compras", automaticFields: [] as string[] };
  const a = fillEmptySupplierFields(initial, {
    legal_name: "Empresa A",
    city: "Recife",
    contact: "Vendas",
  });
  const manual = {
    ...a,
    city: "Olinda",
    automaticFields: a.automaticFields.filter((k) => k !== "city"),
  };
  const b = fillEmptySupplierFields(clearSupplierAutofill(manual), {
    legal_name: "Empresa B",
    city: "Natal",
    contact: "Contato B",
  });
  expect(b).toEqual({
    legal_name: "Empresa B",
    city: "Olinda",
    contact: "Compras",
    automaticFields: ["legal_name"],
  });
  expect(initial.legal_name).toBe("");
});
