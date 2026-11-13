export type ResendDeliveryResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "rejected"; errorCode: string }
  | { status: "uncertain" };

export type ResendEmailInput = {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Sends one email through Resend.
 *
 * A network error, HTTP 5xx, or 2xx without a provider message ID is ambiguous:
 * the provider might have accepted the message. Those outcomes must remain
 * uncertain so the caller does not retry and risk delivering a duplicate.
 */
export async function sendResendEmail(
  input: ResendEmailInput,
  fetcher: typeof fetch = fetch,
): Promise<ResendDeliveryResult> {
  let response: Response;
  try {
    response = await fetcher(RESEND_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    });
  } catch {
    return { status: "uncertain" };
  }

  if (!response.ok) {
    return response.status >= 500
      ? { status: "uncertain" }
      : { status: "rejected", errorCode: `RESEND_HTTP_${response.status}` };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload === "object" &&
    payload !== null &&
    "id" in payload &&
    typeof payload.id === "string" &&
    payload.id.length > 0
  ) {
    return { status: "accepted", providerMessageId: payload.id };
  }

  return { status: "uncertain" };
}
