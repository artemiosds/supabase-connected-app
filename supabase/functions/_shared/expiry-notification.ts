export type ExpiryAlertLevel = "overdue" | "due" | "30" | "60" | "90" | "120";

export function utcDateOnly(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function daysUntilDate(dueOn: string, today: string): number {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(dueOn) || !datePattern.test(today)) {
    throw new Error("Invalid ISO date.");
  }
  const [dueYear, dueMonth, dueDay] = dueOn.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const due = Date.UTC(dueYear!, dueMonth! - 1, dueDay!);
  const base = Date.UTC(todayYear!, todayMonth! - 1, todayDay!);
  const result = Math.round((due - base) / 86_400_000);
  if (
    new Date(due).toISOString().slice(0, 10) !== dueOn ||
    new Date(base).toISOString().slice(0, 10) !== today
  ) {
    throw new Error("Invalid calendar date.");
  }
  return result;
}

export function alertLevelForDays(days: number): ExpiryAlertLevel | null {
  if (!Number.isFinite(days)) return null;
  if (days < 0) return "overdue";
  if (days === 0) return "due";
  if (days <= 30) return "30";
  if (days <= 60) return "60";
  if (days <= 90) return "90";
  if (days <= 120) return "120";
  return null;
}

export function expiryAlertIdempotencyKey(input: {
  tenantId: string;
  entityType: "contract" | "supplier_document";
  entityId: string;
  recipientUserId: string;
  alertLevel: ExpiryAlertLevel;
  dueOn: string;
}): string {
  return [
    "gfs-expiry",
    input.tenantId,
    input.entityType,
    input.entityId,
    input.recipientUserId,
    input.alertLevel,
    input.dueOn,
  ].join(":");
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

export type NotificationBatchWindow = {
  start: number;
  end: number;
  processed: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export function notificationBatchWindow(
  total: number,
  offset: number,
  batchSize: number,
): NotificationBatchWindow {
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(batchSize) ||
    total < 0 ||
    offset < 0 ||
    batchSize < 1
  ) {
    throw new Error("Invalid notification batch window.");
  }

  const start = Math.min(offset, total);
  const end = Math.min(start + batchSize, total);
  const hasMore = end < total;
  return {
    start,
    end,
    processed: end - start,
    hasMore,
    nextOffset: hasMore ? end : null,
  };
}
