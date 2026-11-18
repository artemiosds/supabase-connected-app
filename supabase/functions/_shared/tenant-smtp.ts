import type { ResendDeliveryResult, ResendEmailInput } from "./expiry-notification-provider.ts";
import { smtpPortSecurityError } from "./test-email.ts";
type NotificationMessage = Omit<ResendEmailInput, "apiKey" | "from" | "replyTo">;
type SmtpSettings = {
  email_smtp_host: string | null;
  email_smtp_port: number | null;
  email_smtp_security: string | null;
  email_smtp_username: string | null;
  email_smtp_secret_ciphertext: string | null;
  email_from_name: string | null;
  email_from_address: string | null;
  email_reply_to: string | null;
};
export async function smtpSender(
  tenantEmail: SmtpSettings,
  decrypt: (value: string) => Promise<string>,
) {
  const host = String(tenantEmail.email_smtp_host ?? "").toLowerCase();
  const port = tenantEmail.email_smtp_port;
  const secure = tenantEmail.email_smtp_security === "tls";
  const allowed = (Deno.env.get("SMTP_ALLOWED_ENDPOINTS") ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim());
  if (!allowed.includes(host + ":" + port)) {
    throw new Error("SMTP_ENDPOINT_NOT_ALLOWED");
  }
  if (
    smtpPortSecurityError(port, tenantEmail.email_smtp_security) ||
    !tenantEmail.email_smtp_username ||
    !tenantEmail.email_smtp_secret_ciphertext ||
    !tenantEmail.email_from_address
  ) {
    throw new Error("SMTP_CONFIGURATION");
  }
  const fromAddress = tenantEmail.email_from_address;
  const { default: nodemailer } = await import("npm:nodemailer@10.6.0");
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: {
      user: tenantEmail.email_smtp_username,
      pass: await decrypt(tenantEmail.email_smtp_secret_ciphertext),
    },
  });
  return async (message: NotificationMessage): Promise<ResendDeliveryResult> => {
    try {
      const result = await transport.sendMail({
        from: {
          name: tenantEmail.email_from_name || "",
          address: fromAddress,
        },
        replyTo: tenantEmail.email_reply_to || undefined,
        to: message.to,
        subject: message.subject,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          encoding: "base64",
          cid: a.content_id,
        })),
      });
      return result.accepted?.length
        ? { status: "accepted", providerMessageId: result.messageId }
        : { status: "rejected", errorCode: "SMTP_NOT_ACCEPTED" };
    } catch (error) {
      const code = (error as { responseCode?: number })?.responseCode;
      return code && code >= 400 && code < 600
        ? { status: "rejected", errorCode: "SMTP_" + code }
        : { status: "uncertain" };
    } finally {
      transport.close();
    }
  };
}
