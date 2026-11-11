export type SanctionRecordStatus = "active" | "revoked" | "completed";
export type SanctionDisplayStatus = "vigente" | "programada" | "encerrada" | "revogada";

export function getSanctionDisplayStatus(
  sanction: { status: string; start_date: string; end_date: string | null },
  today: string,
): SanctionDisplayStatus {
  if (sanction.status === "revoked") return "revogada";
  if (sanction.status !== "active") return "encerrada";
  if (sanction.end_date !== null && sanction.end_date < today) {
    return "encerrada";
  }
  if (sanction.start_date > today) return "programada";
  return "vigente";
}

export function isSanctionCurrentlyEffective(
  sanction: { status: string; start_date: string; end_date: string | null },
  today: string,
): boolean {
  return getSanctionDisplayStatus(sanction, today) === "vigente";
}
