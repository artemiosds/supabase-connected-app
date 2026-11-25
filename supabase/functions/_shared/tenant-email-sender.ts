import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendResendEmail, type ResendDeliveryResult, type ResendEmailInput } from "./expiry-notification-provider.ts";
import { smtpSender } from "./tenant-smtp.ts";

export type InstitutionalMessage = Omit<ResendEmailInput, "apiKey" | "from" | "replyTo">;
export type EmailProviderChannel = "smtp_gateway" | "resend" | "platform_resend";

export type ResolvedTenantEmailSender = {
  channel: EmailProviderChannel;
  send: (message: InstitutionalMessage) => Promise<ResendDeliveryResult>;
};

const INSTITUTIONAL_LOGO_MARKER = "<!--primus-institutional-logo-->";
const INSTITUTIONAL_LOGO_IMG =
  '<img src="cid:brasao" alt="Brasão da Secretaria" style="max-width:96px;max-height:80px">';

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function decryptTenantEmailSecret(ciphertext: string): Promise<string> {
  const encodedKey = Deno.env.get("INTEGRATION_SECRETS_KEY") ?? "";
  const keyBytes = decodeBase64(encodedKey);
  if (keyBytes.length !== 32) {
    throw new Error("INTEGRATION_SECRETS_KEY_INVALID");
  }
  const key = await crypto.subtle.importKey("raw", asArrayBuffer(keyBytes), "AES-GCM", false, [
    "decrypt",
  ]);
  const [version, iv, encrypted] = ciphertext.split(".");
  if (version !== "v1" || !iv || !encrypted) {
    throw new Error("EMAIL_SECRET_INVALID");
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(decodeBase64(iv)) },
    key,
    asArrayBuffer(decodeBase64(encrypted)),
  );
  return new TextDecoder().decode(plain);
}

export async function resolveTenantLogoAttachment(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("tenant_document_branding")
    .select("logo_storage_path,logo_file_size,logo_mime")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) return undefined;
  const path = data.logo_storage_path;
  if (
    typeof path !== "string" ||
    !path.startsWith(tenantId + "/document-branding/") ||
    path.includes("..") ||
    !(data?.logo_file_size > 0 && data.logo_file_size <= 307200) ||
    !["image/png", "image/jpeg"].includes(data.logo_mime)
  ) {
    return undefined;
  }

  const { data: file } = await admin.storage.from("gfs-private-documents").download(path);
  if (!file || file.size !== data.logo_file_size) return undefined;

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }

  return [
    {
      filename: data.logo_mime === "image/png" ? "brasao.png" : "brasao.jpg",
      content: btoa(binary),
      content_id: "brasao",
    },
  ];
}

export function injectTenantLogoHtml(html: string, hasAttachments: boolean): string {
  return hasAttachments ? html.replace(INSTITUTIONAL_LOGO_MARKER, INSTITUTIONAL_LOGO_IMG) : html;
}

export async function resolveTenantEmailSender(
  admin: SupabaseClient,
  tenantId: string,
  platformFallback?: { apiKey?: string; from?: string },
): Promise<ResolvedTenantEmailSender> {
  const { data: tenantEmail, error: tenantEmailError } = await admin
    .from("tenant_integration_settings")
    .select(
      "email_provider,email_from_name,email_from_address,email_reply_to,email_api_secret_ciphertext,email_smtp_host,email_smtp_port,email_smtp_security,email_smtp_username,email_smtp_secret_ciphertext",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (tenantEmailError) {
    throw new Error("EMAIL_PROVIDER_READ_FAILED");
  }

  if (tenantEmail?.email_provider === "smtp_gateway") {
    const send = await smtpSender(tenantEmail, decryptTenantEmailSecret);
    return { channel: "smtp_gateway", send };
  }

  if (tenantEmail?.email_provider === "resend") {
    if (!tenantEmail.email_api_secret_ciphertext || !tenantEmail.email_from_address) {
      throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
    }
    const apiKey = await decryptTenantEmailSecret(tenantEmail.email_api_secret_ciphertext);
    const from = tenantEmail.email_from_name
      ? `${String(tenantEmail.email_from_name).replace(/[<>\r\n]/g, "")} <${tenantEmail.email_from_address}>`
      : tenantEmail.email_from_address;
    const replyTo =
      typeof tenantEmail.email_reply_to === "string" && tenantEmail.email_reply_to
        ? tenantEmail.email_reply_to
        : undefined;
    return {
      channel: "resend",
      send: (message) =>
        sendResendEmail({
          ...message,
          apiKey,
          from,
          replyTo,
        }),
    };
  }

  const fallbackApiKey = (platformFallback?.apiKey ?? "").trim();
  const fallbackFrom = (platformFallback?.from ?? "").trim();
  if (fallbackApiKey && fallbackFrom) {
    return {
      channel: "platform_resend",
      send: (message) =>
        sendResendEmail({
          ...message,
          apiKey: fallbackApiKey,
          from: fallbackFrom,
        }),
    };
  }

  throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
}
