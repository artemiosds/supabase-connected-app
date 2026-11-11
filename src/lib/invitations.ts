export function isInvitationExpired(
  status: string,
  expiresAt: string,
  nowMs = Date.now(),
): boolean {
  if (status === "expired") return true;
  return status === "pending" && Date.parse(expiresAt) <= nowMs;
}
