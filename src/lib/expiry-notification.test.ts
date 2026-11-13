import { describe, expect, it } from "vitest";
import {
  alertLevelForDays,
  daysUntilDate,
  escapeHtml,
  expiryAlertIdempotencyKey,
  notificationBatchWindow,
  utcDateOnly,
  sanitizeEmailSubject,
  notificationDryRun,
  missingNotificationConfiguration,
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

  it("advances through complete batches, including skipped delivery candidates", () => {
    expect(notificationBatchWindow(245, 0, 100)).toEqual({
      start: 0,
      end: 100,
      processed: 100,
      hasMore: true,
      nextOffset: 100,
    });
    expect(notificationBatchWindow(245, 100, 100)).toEqual({
      start: 100,
      end: 200,
      processed: 100,
      hasMore: true,
      nextOffset: 200,
    });
    expect(notificationBatchWindow(245, 200, 100)).toEqual({
      start: 200,
      end: 245,
      processed: 45,
      hasMore: false,
      nextOffset: null,
    });
    expect(notificationBatchWindow(0, 0, 100).hasMore).toBe(false);
  });

  it("rejects impossible calendar dates and invalid cursors", () => {
    expect(() => daysUntilDate("2026-02-30", "2026-02-01")).toThrow("Invalid calendar date");
    expect(() => notificationBatchWindow(-1, 0, 100)).toThrow("Invalid notification batch window");
    expect(() => notificationBatchWindow(100, -1, 100)).toThrow(
      "Invalid notification batch window",
    );
  });
});

describe("email subject safety", () => {
  it("preserves letters and removes actual header line breaks", () => {
    expect(sanitizeEmailSubject("Contrato renovado\r\nBcc: outro")).toBe(
      "Contrato renovado Bcc: outro",
    );
    expect(sanitizeEmailSubject("Fornecedor normal")).toBe("Fornecedor normal");
    expect(sanitizeEmailSubject("a".repeat(200))).toHaveLength(180);
  });
});

describe("notification simulation default", () => {
  it("requires an explicit boolean false to send", () => {
    expect(notificationDryRun(undefined)).toBe(true);
    expect(notificationDryRun(true)).toBe(true);
    expect(notificationDryRun(false)).toBe(false);
    for (const value of [null, "false", "true", 0, 1, {}, []]) {
      expect(() => notificationDryRun(value)).toThrow();
    }
  });
});

describe("notification runtime configuration", () => {
  it("allows a dry-run with database credentials only", () => {
    expect(
      missingNotificationConfiguration({
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "local-test-service-role-key",
        dryRun: true,
      }),
    ).toEqual([]);
  });

  it("requires delivery-provider settings before real sends", () => {
    expect(
      missingNotificationConfiguration({
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "local-test-service-role-key",
        dryRun: false,
      }),
    ).toEqual(["RESEND_API_KEY", "EXPIRY_ALERTS_FROM", "APP_URL"]);
  });

  it("still requires the database endpoint and service role for dry-runs", () => {
    expect(
      missingNotificationConfiguration({
        dryRun: true,
      }),
    ).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  });
});
