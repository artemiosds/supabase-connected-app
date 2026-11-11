import { describe, expect, it } from "vitest";
import { isInvitationExpired } from "@/lib/invitations";

describe("isInvitationExpired", () => {
  const now = Date.parse("2026-11-11T00:00:00.000Z");

  it("treats a persisted expired status as expired", () => {
    expect(isInvitationExpired("expired", "2026-11-12T00:00:00.000Z", now)).toBe(true);
  });

  it("treats a pending invitation at its expiry instant as expired", () => {
    expect(isInvitationExpired("pending", "2026-11-11T00:00:00.000Z", now)).toBe(true);
  });

  it("keeps a pending invitation before its expiry active", () => {
    expect(isInvitationExpired("pending", "2026-11-12T00:00:00.000Z", now)).toBe(false);
  });

  it("does not mark accepted or revoked invitations expired by timestamp", () => {
    expect(isInvitationExpired("accepted", "2026-11-10T00:00:00.000Z", now)).toBe(false);
    expect(isInvitationExpired("revoked", "2026-11-10T00:00:00.000Z", now)).toBe(false);
  });
});
