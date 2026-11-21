import { expect, it } from "vitest";
import { monitorSupplierDocuments, daysUntil } from "./supplier-document-monitor";
it("uses active evidence, keeps undated certificates for review and respects 30-day boundary", () => {
  const doc = (id: string, type: string, expires: string | null, status = "active") => ({
    id,
    title: "AFE",
    document_type: type,
    expires_at: expires,
    status,
  });
  const rows = monitorSupplierDocuments(
    [
      doc("1", "fgts", "2026-11-20"),
      doc("2", "fgts", "2027-02-01"),
      doc("3", "trabalhista", "2026-12-21"),
      doc("4", "certidao_federal", "2026-11-20"),
      doc("5", "certidao_municipal", null),
      doc("6", "certidao_estadual", "2027-01-01", "archived"),
    ],
    "medicamentos",
    "2026-11-21",
  );
  expect(rows.map((r) => r.status)).toEqual([
    "expired",
    "missing",
    "review",
    "valid",
    "expiring",
    "missing",
    "missing",
  ]);
  expect(daysUntil("2026-12-21", "2026-11-21")).toBe(30);
  expect(monitorSupplierDocuments([], "servicos")).toHaveLength(5);
});
