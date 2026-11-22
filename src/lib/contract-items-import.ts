import type { TablesInsert } from "@/integrations/supabase/types";

export type ProcessImportItem = {
  id: string;
  line_number: number;
  description: string;
  technical_specification: string | null;
  unit: string;
  quantity: number;
  estimated_unit_price: number | null;
  estimated_price_source: string;
  is_active: boolean;
  linked_unit_price?: number;
};

export type ExistingContractItem = {
  description: string;
  specification: string | null;
  notes?: string | null;
  line_number: number;
};

const normalize = (value: string | null) =>
  (value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const identity = (description: string, specification: string | null) =>
  JSON.stringify([normalize(description), normalize(specification)]);

export function importUnitPrice(item: ProcessImportItem): number | null {
  const price =
    item.linked_unit_price ??
    (item.estimated_price_source === "approved" ? item.estimated_unit_price : null);
  return price !== null && Number.isFinite(price) && price >= 0 && price < 1e10
    ? Number(price.toFixed(4))
    : null;
}

export function filterEligibleProcessItems(
  processItems: ProcessImportItem[],
  existingContractItems: ExistingContractItem[],
) {
  const existing = new Set(
    existingContractItems.map((item) => identity(item.description, item.specification)),
  );
  const importedIds = new Set(existingContractItems.map((item) => item.notes ?? ""));
  const eligible: ProcessImportItem[] = [];
  const alreadyImported: ProcessImportItem[] = [];
  const unavailable: ProcessImportItem[] = [];
  for (const item of [...processItems].sort((a, b) => a.line_number - b.line_number)) {
    if (
      !item.is_active ||
      importUnitPrice(item) === null ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity >= 1e10
    ) {
      unavailable.push(item);
      continue;
    }
    const key = identity(item.description, item.technical_specification);
    if (existing.has(key) || importedIds.has("Origem: item do processo " + item.id)) {
      alreadyImported.push(item);
      continue;
    }
    eligible.push(item);
    existing.add(key);
  }
  return { eligible, alreadyImported, unavailable };
}

export function mapProcurementItemsToContractPayload(
  itemsToImport: ProcessImportItem[],
  contractId: string,
  tenantId: string,
  userId: string,
  startingLineNumber: number,
): TablesInsert<"contract_items">[] {
  return itemsToImport.map((item, index) => {
    const unitValue = importUnitPrice(item);
    if (
      !item.is_active ||
      unitValue === null ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity >= 1e10
    )
      throw new Error("Item sem preço válido ou quantidade disponível.");
    return {
      contract_id: contractId,
      tenant_id: tenantId,
      created_by: userId,
      updated_by: userId,
      line_number: startingLineNumber + index + 1,
      description: item.description.trim(),
      specification: item.technical_specification?.trim() || null,
      unit: item.unit.trim(),
      quantity_total: item.quantity,
      unit_value: unitValue,
      notes: "Origem: item do processo " + item.id,
    };
  });
}
