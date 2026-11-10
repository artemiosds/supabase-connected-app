import { describe, expect, it } from "vitest";
import {
  alertLevelForDays,
  daysUntilDate,
  escapeHtml,
  expiryAlertIdempotencyKey,
  utcDateOnly,
} from "../../supabase/functions/_shared/expiry-notification";

describe("scheduled expiry notification helpers", () => {
  it("calculates date-only differences without local timezone drift", () => {
    expect(daysUntilDate("2026-11-10", "2026-11-10")).toBe(0);
    expect(daysUntilDate("2026-11-11", "2026-11-10")).toBe(1);
    expect(daysUntilDate("2026-11-09", "2026-11-10")).toBe(-1);
    expect(utcDateOnly(new Date("2026-11-10T12:00:00.000Z"))).toBe("2026-11-10");
  });

  it("assigns exactly one progressive alert level at each boundary", () => {
    expect(alertLevelForDays(-20)).toBe("overdue");
    expect(alertLevelForDays(0)).toBe("due");
    expect(alertLevelForDays(1)).toBe("30");
    expect(alertLevelForDays(30)).toBe("30");
    expect(alertLevelForDays(31)).toBe("60");
    expect(alertLevelForDays(60)).toBe("60");
    expect(alertLevelForDays(61)).toBe("90");
    expect(alertLevelForDays(90)).toBe("90");
    expect(alertLevelForDays(91)).toBe("120");
    expect(alertLevelForDays(120)).toBe("120");
    expect(alertLevelForDays(121)).toBeNull();
  });

  it("builds a stable idempotency key for a recipient and event", () => {
    const input = {
      tenantId: "tenant-1",
      entityType: "supplier_document" as const,
      entityId: "document-1",
      recipientUserId: "user-1",
      alertLevel: "30" as const,
      dueOn: "2026-12-10",
    };
    expect(expiryAlertIdempotencyKey(input)).toBe(
      "gfs-expiry:tenant-1:supplier_document:document-1:user-1:30:2026-12-10",
    );
    expect(expiryAlertIdempotencyKey(input)).toBe(expiryAlertIdempotencyKey(input));
  });

  it("escapes user-controlled values before building HTML email", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'x'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;x&#39;",
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(() => daysUntilDate("2026-02-30", "2026-02-01")).toThrow("Invalid calendar date");
  });
});
