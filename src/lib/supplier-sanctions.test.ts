import { describe, expect, it } from "vitest";
import { getSanctionDisplayStatus, isSanctionCurrentlyEffective } from "./supplier-sanctions";

describe("status de medidas de fornecedores", () => {
  it("identifica medidas vigentes na data atual", () => {
    const sanction = { status: "active", start_date: "2026-01-01", end_date: "2026-12-31" };
    expect(getSanctionDisplayStatus(sanction, "2026-11-11")).toBe("vigente");
    expect(isSanctionCurrentlyEffective(sanction, "2026-11-11")).toBe(true);
  });

  it("diferencia medidas futuras, vencidas e revogadas", () => {
    expect(
      getSanctionDisplayStatus(
        { status: "active", start_date: "2026-12-01", end_date: null },
        "2026-11-11",
      ),
    ).toBe("programada");
    expect(
      getSanctionDisplayStatus(
        { status: "active", start_date: "2026-01-01", end_date: "2026-11-10" },
        "2026-11-11",
      ),
    ).toBe("encerrada");
    expect(
      getSanctionDisplayStatus(
        { status: "revoked", start_date: "2026-01-01", end_date: null },
        "2026-11-11",
      ),
    ).toBe("revogada");
    expect(
      getSanctionDisplayStatus(
        { status: "unknown", start_date: "2026-01-01", end_date: null },
        "2026-11-11",
      ),
    ).toBe("encerrada");
  });
});
