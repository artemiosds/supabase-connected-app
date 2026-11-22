import { expect, it } from "vitest";
import {
  filterEligibleProcessItems,
  mapProcurementItemsToContractPayload,
  type ProcessImportItem,
} from "./contract-items-import";
const item = (id: string, description: string, price: number | null = 2.5): ProcessImportItem => ({
  id,
  line_number: Number(id),
  description,
  technical_specification: "20 ml",
  unit: "UNIDADE",
  quantity: 10,
  estimated_unit_price: price,
  estimated_price_source: "approved",
  is_active: true,
});
it("excludes existing and duplicated items by normalized description/specification", () => {
  const result = filterEligibleProcessItems(
    [item("1", "Seringa"), item("2", "Gaze"), item("3", "Gaze"), item("4", "Sem preço", null)],
    [{ description: " SERINGA ", specification: "20  ml", line_number: 5 }],
  );
  expect(result.eligible.map((i) => i.id)).toEqual(["2"]);
  expect(result.alreadyImported.map((i) => i.id)).toEqual(["1", "3"]);
  expect(result.unavailable.map((i) => i.id)).toEqual(["4"]);
});
it("recognizes the original item even after edits", () => {
  expect(
    filterEligibleProcessItems(
      [item("1", "Seringa")],
      [
        {
          description: "Novo título",
          specification: null,
          line_number: 1,
          notes: "Origem: item do processo 1",
        },
      ],
    ).alreadyImported,
  ).toHaveLength(1);
});
it("maps quantities and approved prices with continuous numbering", () => {
  const payload = mapProcurementItemsToContractPayload(
    [item("1", "Seringa"), { ...item("2", "Gaze"), linked_unit_price: 3.25 }],
    "contract",
    "tenant",
    "user",
    7,
  );
  expect(payload.map((p) => p.line_number)).toEqual([8, 9]);
  expect(payload[0]).toMatchObject({
    contract_id: "contract",
    tenant_id: "tenant",
    quantity_total: 10,
    unit_value: 2.5,
    unit: "UNIDADE",
    created_by: "user",
    updated_by: "user",
  });
  expect(payload[1]?.unit_value).toBe(3.25);
});
it("rejects unapproved reference estimates unless a quote is linked to the contract", () => {
  const reference = { ...item("1", "Seringa"), estimated_price_source: "quote_reference" };
  expect(filterEligibleProcessItems([reference], []).eligible).toHaveLength(0);
  expect(
    filterEligibleProcessItems([{ ...reference, linked_unit_price: 4 }], []).eligible,
  ).toHaveLength(1);
});
