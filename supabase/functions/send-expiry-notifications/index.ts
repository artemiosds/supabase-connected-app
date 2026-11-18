import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  sendResendEmail,
  type ResendEmailInput,
  type ResendDeliveryResult,
} from "../_shared/expiry-notification-provider.ts";
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
  type ExpiryAlertLevel,
} from "../_shared/expiry-notification.ts";

const PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
// Keep the Edge Function self-contained for Supabase deployment. Query
// results are validated by the explicit row types below and bounded casts.
type AdminClient = SupabaseClient;

type TenantRow = {
  id: string;
  name: string;
  enabled_modules: { contratos?: boolean; documentos?: boolean };
};
type SupplierRow = { legal_name: string | null; trade_name: string | null } | null;
type ContractRow = {
  id: string;
  tenant_id: string;
  number: string;
  end_date: string;
  supplier_id: string | null;
  suppliers: SupplierRow;
};
type DocumentRow = {
  id: string;
  tenant_id: string;
  title: string;
  expires_at: string | null;
  supplier_id: string;
  suppliers: SupplierRow;
};
type Recipient = { userId: string; email: string; name: string };
type ExpiryTask = {
  tenantId: string;
  tenantName: string;
  entityType: "contract" | "supplier_document";
  entityId: string;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string;
  alertLevel: ExpiryAlertLevel;
  dueOn: string;
  title: string;
  supplierName: string | null;
  daysUntil: number;
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function constantTimeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return [day, month, year].join("/");
}

function alertLabel(level: ExpiryAlertLevel, days: number): string {
  if (level === "overdue") return `Vencido há ${Math.abs(days)} dia(s)`;
  if (level === "due") return "Vence hoje";
  return `Vence em até ${level} dias`;
}

function makeEmail(task: ExpiryTask, appUrl: string) {
  const supplier = task.supplierName
    ? `<p><strong>Fornecedor:</strong> ${escapeHtml(task.supplierName)}</p>`
    : "";
  const kind = task.entityType === "contract" ? "Contrato" : "Documento do fornecedor";
  const safeSubjectTitle = sanitizeEmailSubject(task.title);
  const subject = `[Gestão de Fornecedores] ${kind} — ${safeSubjectTitle}`;
  const destination = new URL(
    task.entityType === "contract" ? "/contratos" : "/documentos",
    appUrl,
  ).toString();
  const html = [
    "<!doctype html>",
    '<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">',
    `<h2>Alerta de vencimento — ${escapeHtml(task.tenantName)}</h2>`,
    `<p><strong>${escapeHtml(kind)}:</strong> ${escapeHtml(task.title)}</p>`,
    supplier,
    `<p><strong>Vencimento:</strong> ${dateLabel(task.dueOn)}</p>`,
    `<p><strong>Situação:</strong> ${escapeHtml(alertLabel(task.alertLevel, task.daysUntil))}</p>`,
    "<p>Verifique a documentação e adote as providências administrativas necessárias.</p>",
    `<p><a href="${escapeHtml(destination)}">Abrir Gestão de Fornecedores</a></p>`,
    '<hr><p style="font-size:12px;color:#64748b">Mensagem automática da plataforma. Não responda a este e-mail.</p>',
    "</body></html>",
  ].join("");
  return { subject, html };
}

async function fetchContracts(
  admin: AdminClient,
  tenantId: string,
  limitDate: string,
): Promise<ContractRow[]> {
  const rows: ContractRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("contracts")
      .select("id,tenant_id,number,end_date,supplier_id,suppliers(legal_name,trade_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "vigente")
      .lte("end_date", limitDate)
      .order("end_date")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("CONTRACT_QUERY_FAILED");
    rows.push(...((data ?? []) as unknown as ContractRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchDocuments(
  admin: AdminClient,
  tenantId: string,
  limitDate: string,
): Promise<DocumentRow[]> {
  const rows: DocumentRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("supplier_documents")
      .select("id,tenant_id,title,expires_at,supplier_id,suppliers(legal_name,trade_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lte("expires_at", limitDate)
      .order("expires_at")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("DOCUMENT_QUERY_FAILED");
    rows.push(...((data ?? []) as unknown as DocumentRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchRecipients(admin: AdminClient, tenantId: string): Promise<Recipient[]> {
  const memberships: Array<{ id: string; user_id: string }> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("tenant_memberships")
      .select("id,user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("MEMBERSHIP_QUERY_FAILED");
    memberships.push(...((data ?? []) as Array<{ id: string; user_id: string }>));
    if (!data || data.length < PAGE_SIZE) break;
  }

  if (memberships.length === 0) return [];
  const membershipIds = memberships.map((membership) => membership.id);
  const userByMembership = new Map(
    memberships.map((membership) => [membership.id, membership.user_id]),
  );
  const authorizedUserIds = new Set<string>();

  for (let offset = 0; offset < membershipIds.length; offset += PAGE_SIZE) {
    const batch = membershipIds.slice(offset, offset + PAGE_SIZE);
    const { data, error } = await admin
      .from("membership_roles")
      .select("membership_id,tenant_roles(slug)")
      .eq("tenant_id", tenantId)
      .in("membership_id", batch);
    if (error) throw new Error("MEMBERSHIP_ROLE_QUERY_FAILED");

    for (const link of data ?? []) {
      const related = link.tenant_roles as unknown as
        { slug?: string } | { slug?: string }[] | null;
      const role = Array.isArray(related) ? related[0] : related;
      if (role?.slug === "admin" || role?.slug === "manager") {
        const userId = userByMembership.get(link.membership_id);
        if (userId) authorizedUserIds.add(userId);
      }
    }
  }

  const recipientIds = [...authorizedUserIds];
  if (recipientIds.length === 0) return [];

  const profilesById = new Map<string, string>();
  for (let offset = 0; offset < recipientIds.length; offset += PAGE_SIZE) {
    const batch = recipientIds.slice(offset, offset + PAGE_SIZE);
    const { data, error } = await admin.from("profiles").select("id,full_name").in("id", batch);
    if (error) throw new Error("PROFILE_QUERY_FAILED");
    for (const profile of data ?? []) profilesById.set(profile.id, profile.full_name);
  }

  const recipients: Recipient[] = [];
  for (const userId of recipientIds) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user || data.user.deleted_at || !data.user.email_confirmed_at) continue;
    const email = data.user.email?.trim().toLowerCase();
    if (!email || email.length > 254) continue;
    recipients.push({
      userId,
      email,
      name:
        profilesById.get(userId)?.trim() ||
        data.user.user_metadata?.full_name ||
        data.user.user_metadata?.name ||
        email,
    });
  }
  return recipients;
}

function addCandidateTasks(
  tasks: ExpiryTask[],
  tenant: TenantRow,
  recipients: Recipient[],
  entity: {
    id: string;
    entityType: "contract" | "supplier_document";
    dueOn: string;
    title: string;
    supplierName: string | null;
  },
  today: string,
) {
  const daysUntil = daysUntilDate(entity.dueOn, today);
  const alertLevel = alertLevelForDays(daysUntil);
  if (!alertLevel) return;

  for (const recipient of recipients) {
    tasks.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      entityType: entity.entityType,
      entityId: entity.id,
      recipientUserId: recipient.userId,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      alertLevel,
      dueOn: entity.dueOn,
      title: entity.title,
      supplierName: entity.supplierName,
      daysUntil,
    });
  }
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function decryptTenantEmailSecret(ciphertext: string): Promise<string> {
  const encodedKey = Deno.env.get("INTEGRATION_SECRETS_KEY") ?? "";
  const keyBytes = decodeBase64(encodedKey);
  if (keyBytes.length !== 32) throw new Error("INTEGRATION_SECRETS_KEY_INVALID");
  const key = await crypto.subtle.importKey("raw", asArrayBuffer(keyBytes), "AES-GCM", false, [
    "decrypt",
  ]);
  const [version, iv, encrypted] = ciphertext.split(".");
  if (version !== "v1" || !iv || !encrypted) throw new Error("EMAIL_SECRET_INVALID");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(decodeBase64(iv)) },
    key,
    asArrayBuffer(decodeBase64(encrypted)),
  );
  return new TextDecoder().decode(plain);
}

async function tenantLogo(admin: AdminClient, tenantId: string) {
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
  )
    return undefined;
  const { data: file } = await admin.storage.from("gfs-private-documents").download(path);
  if (!file || file.size !== data.logo_file_size) return undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return [
    {
      filename: data.logo_mime === "image/png" ? "brasao.png" : "brasao.jpg",
      content: btoa(binary),
      content_id: "brasao",
    },
  ];
}
const logoHtml =
  '<img src="cid:brasao" alt="Brasão da Secretaria" style="max-width:96px;max-height:80px">';

type NotificationMessage = Omit<ResendEmailInput, "apiKey" | "from" | "replyTo">;

async function emailProvider(admin: AdminClient, tenantId: string, apiKey: string, from: string) {
  let effectiveApiKey = apiKey;
  let effectiveFrom = from;
  let effectiveReplyTo: string | undefined;
  const { data: tenantEmail, error: tenantEmailError } = await admin
    .from("tenant_integration_settings")
    .select(
      "email_provider,email_from_name,email_from_address,email_reply_to,email_api_secret_ciphertext,email_smtp_host,email_smtp_port,email_smtp_security,email_smtp_username,email_smtp_secret_ciphertext",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (tenantEmailError) throw new Error("EMAIL_PROVIDER_CONFIGURATION");
  if (tenantEmail?.email_provider === "smtp_gateway") {
    const host = String(tenantEmail.email_smtp_host ?? "").toLowerCase();
    const port = tenantEmail.email_smtp_port;
    const secure = tenantEmail.email_smtp_security === "tls";
    const allowed = (Deno.env.get("SMTP_ALLOWED_ENDPOINTS") ?? "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim());
    if (
      !allowed.includes(host + ":" + port) ||
      !(
        (secure && port === 465) ||
        (tenantEmail.email_smtp_security === "starttls" && port === 2525)
      ) ||
      !tenantEmail.email_smtp_username ||
      !tenantEmail.email_smtp_secret_ciphertext ||
      !tenantEmail.email_from_address
    ) {
      throw new Error("SMTP_CONFIGURATION");
    }
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
        pass: await decryptTenantEmailSecret(tenantEmail.email_smtp_secret_ciphertext),
      },
    });
    return async (message: NotificationMessage): Promise<ResendDeliveryResult> => {
      try {
        const result = await transport.sendMail({
          from: {
            name: tenantEmail.email_from_name || "",
            address: tenantEmail.email_from_address,
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
  if (tenantEmail?.email_provider === "resend") {
    if (!tenantEmail.email_api_secret_ciphertext || !tenantEmail.email_from_address) {
      throw new Error("EMAIL_PROVIDER_CONFIGURATION");
    }
    try {
      effectiveApiKey = await decryptTenantEmailSecret(tenantEmail.email_api_secret_ciphertext);
      effectiveFrom = tenantEmail.email_from_name
        ? `${String(tenantEmail.email_from_name).replace(/[<>\r\n]/g, "")} <${tenantEmail.email_from_address}>`
        : tenantEmail.email_from_address;
      effectiveReplyTo =
        typeof tenantEmail.email_reply_to === "string" ? tenantEmail.email_reply_to : undefined;
    } catch {
      console.error("Não foi possível abrir a credencial Resend da Secretaria", tenantId);
      throw new Error("EMAIL_PROVIDER_CONFIGURATION");
    }
  }

  if (!effectiveApiKey.trim() || !effectiveFrom.trim())
    throw new Error("EMAIL_PROVIDER_CONFIGURATION");

  return (message: NotificationMessage) =>
    sendResendEmail({
      ...message,
      apiKey: effectiveApiKey,
      from: effectiveFrom,
      replyTo: effectiveReplyTo,
    });
}

async function deliverTask(
  admin: AdminClient,
  task: ExpiryTask,
  apiKey: string,
  from: string,
  appUrl: string,
): Promise<"sent" | "failed" | "skipped" | "uncertain"> {
  const uniqueFilter = {
    tenant_id: task.tenantId,
    entity_type: task.entityType,
    entity_id: task.entityId,
    recipient_user_id: task.recipientUserId,
    alert_level: task.alertLevel,
    due_on: task.dueOn,
  };

  let deliveryId: string | null = null;
  const { data: inserted, error: insertError } = await admin
    .from("expiry_notification_deliveries")
    .insert(uniqueFilter)
    .select("id")
    .maybeSingle();

  if (insertError?.code === "23505") {
    const { data: existing, error: existingError } = await admin
      .from("expiry_notification_deliveries")
      .select("id,status,attempts")
      .match(uniqueFilter)
      .maybeSingle();
    if (existingError || !existing || existing.status === "sent" || existing.attempts >= 5) {
      return "skipped";
    }
    deliveryId = existing.id;
  } else if (insertError || !inserted) {
    return "failed";
  } else {
    deliveryId = inserted.id;
  }

  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_expiry_notification_delivery",
    { p_delivery_id: deliveryId },
  );
  const claimed = Array.isArray(claimData) ? claimData[0] : claimData;
  if (claimError || !claimed) return "skipped";

  async function failConfiguration(): Promise<"failed" | "uncertain"> {
    const { data, error } = await admin.rpc("finish_expiry_notification_delivery", {
      p_delivery_id: deliveryId,
      p_status: "failed",
      p_error_code: "EMAIL_PROVIDER_CONFIGURATION",
    });
    return error || data !== true ? "uncertain" : "failed";
  }

  let provider;
  try {
    provider = await emailProvider(admin, task.tenantId, apiKey, from);
  } catch {
    return failConfiguration();
  }

  const email = makeEmail(task, appUrl);
  const idempotencyKey = expiryAlertIdempotencyKey({
    tenantId: task.tenantId,
    entityType: task.entityType,
    entityId: task.entityId,
    recipientUserId: task.recipientUserId,
    alertLevel: task.alertLevel,
    dueOn: task.dueOn,
  });

  const attachments = await tenantLogo(admin, task.tenantId);
  const providerResult = await provider({
    to: task.recipientEmail,
    subject: email.subject,
    attachments,
    html: attachments ? email.html.replace("<h2>", logoHtml + "<h2>") : email.html,
    idempotencyKey,
  });

  if (providerResult.status === "uncertain") return "uncertain";

  if (providerResult.status === "rejected") {
    const { data: markedFailed, error: finishError } = await admin.rpc(
      "finish_expiry_notification_delivery",
      {
        p_delivery_id: deliveryId,
        p_status: "failed",
        p_error_code: providerResult.errorCode,
      },
    );
    return finishError || markedFailed !== true ? "uncertain" : "failed";
  }

  const { data: completed, error: completionError } = await admin.rpc(
    "finish_expiry_notification_delivery",
    {
      p_delivery_id: deliveryId,
      p_status: "sent",
      p_provider_message_id: providerResult.providerMessageId,
    },
  );
  return completionError || completed !== true ? "uncertain" : "sent";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const expectedSecret = Deno.env.get("EXPIRY_ALERTS_CRON_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-expiry-alert-secret") ?? "";
  if (
    expectedSecret.length < 32 ||
    !suppliedSecret ||
    !constantTimeEquals(suppliedSecret, expectedSecret)
  ) {
    return jsonResponse({ error: "Não autorizado." }, 401);
  }

  let batchSize = DEFAULT_BATCH_SIZE;
  let offset = 0;
  let dryRun = true;
  let operational = false;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Corpo da solicitação inválido." }, 400);
    }
    dryRun = notificationDryRun(body.dry_run);
    operational = body.channel === "operational";
    if (body?.batch_size !== undefined) {
      const value = Number(body.batch_size);
      if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
        return jsonResponse({ error: "batch_size precisa estar entre 1 e 100." }, 400);
      }
      batchSize = value;
    }
    if (body?.offset !== undefined) {
      const value = Number(body.offset);
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        return jsonResponse({ error: "offset precisa ser um inteiro entre 0 e 1.000.000." }, 400);
      }
      offset = value;
    }
  } catch {
    return jsonResponse({ error: "Corpo da solicitação inválido." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("EXPIRY_ALERTS_FROM") ?? "";
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const missingConfiguration = missingNotificationConfiguration({
    supabaseUrl,
    serviceRoleKey,
    resendApiKey,
    from,
    appUrl,
    dryRun,
  });
  if (missingConfiguration.length > 0) {
    return jsonResponse({ error: "Alertas automáticos não configurados no servidor." }, 503);
  }

  let appOrigin = "";
  if (!dryRun) {
    try {
      const parsed = new URL(appUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("Invalid application origin.");
      }
      appOrigin = parsed.origin;
    } catch {
      return jsonResponse({ error: "APP_URL precisa ser uma origem HTTPS válida." }, 503);
    }
  }

  const admin: AdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (operational) {
    try {
      return jsonResponse(
        await processOperational(admin, dryRun, appOrigin, resendApiKey, from),
        200,
      );
    } catch {
      return jsonResponse({ error: "Falha ao processar fila operacional." }, 500);
    }
  }

  const today = utcDateOnly(new Date());
  const horizon = new Date(`${today}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 120);
  const limitDate = horizon.toISOString().slice(0, 10);
  const tasks: ExpiryTask[] = [];

  try {
    const tenants: TenantRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from("tenants")
        .select("id,name,enabled_modules")
        .eq("status", "active")
        .in("commercial_status", ["active", "trial"])
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error("TENANT_QUERY_FAILED");
      tenants.push(...((data ?? []) as TenantRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    for (const tenant of tenants) {
      const [contracts, documents, recipients] = await Promise.all([
        tenant.enabled_modules?.contratos === true
          ? fetchContracts(admin, tenant.id, limitDate)
          : Promise.resolve([] as ContractRow[]),
        tenant.enabled_modules?.documentos === true
          ? fetchDocuments(admin, tenant.id, limitDate)
          : Promise.resolve([] as DocumentRow[]),
        fetchRecipients(admin, tenant.id),
      ]);
      if (recipients.length === 0) continue;

      for (const contract of contracts) {
        const supplier = contract.suppliers?.trade_name || contract.suppliers?.legal_name || null;
        addCandidateTasks(
          tasks,
          tenant,
          recipients,
          {
            id: contract.id,
            entityType: "contract",
            dueOn: contract.end_date,
            title: `Contrato nº ${contract.number}`,
            supplierName: supplier,
          },
          today,
        );
      }

      for (const document of documents) {
        if (!document.expires_at) continue;
        const supplier = document.suppliers?.trade_name || document.suppliers?.legal_name || null;
        addCandidateTasks(
          tasks,
          tenant,
          recipients,
          {
            id: document.id,
            entityType: "supplier_document",
            dueOn: document.expires_at,
            title: document.title,
            supplierName: supplier,
          },
          today,
        );
      }
    }

    const batchWindow = notificationBatchWindow(tasks.length, offset, batchSize);
    const batchTasks = tasks.slice(batchWindow.start, batchWindow.end);
    if (dryRun) {
      return jsonResponse({
        status: "dry_run",
        date: today,
        candidates: tasks.length,
        processed: batchTasks.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        uncertain: 0,
        has_more: batchWindow.hasMore,
        next_offset: batchWindow.nextOffset,
      });
    }
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let uncertain = 0;

    for (const task of batchTasks) {
      const result = await deliverTask(admin, task, resendApiKey, from, appOrigin);
      if (result === "sent") sent += 1;
      else if (result === "failed") failed += 1;
      else if (result === "uncertain") uncertain += 1;
      else skipped += 1;
    }

    return jsonResponse({
      status: "processed",
      date: today,
      candidates: tasks.length,
      processed: batchTasks.length,
      sent,
      failed,
      skipped,
      uncertain,
      has_more: batchWindow.hasMore,
      next_offset: batchWindow.nextOffset,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNEXPECTED_ERROR";
    console.error("Expiry notification run failed:", code);
    return jsonResponse({ error: "Falha ao processar notificações de vencimento." }, 500);
  }
});

async function processOperational(
  admin: AdminClient,
  dryRun: boolean,
  origin: string,
  key: string,
  from: string,
) {
  const stats = { sent: 0, failed: 0, skipped: 0, uncertain: 0 };
  if (!dryRun) {
    const { data: interrupted, error } = await admin
      .from("operational_email_events")
      .update({ status: "uncertain", reason: "INTERRUPTED_DELIVERY" })
      .eq("status", "sending")
      .lt("claimed_at", new Date(Date.now() - 1800000).toISOString())
      .select("id");
    if (error) throw error;
    stats.uncertain += interrupted.length;
  }
  if (
    !dryRun &&
    new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    ) === "Mon"
  ) {
    const { error } = await admin.rpc("queue_idle_process_emails");
    if (error) throw error;
  }
  const { data: rows, error } = await admin
    .from("operational_email_events")
    .select("id,tenant_id,kind,entity_id,stage,recipient")
    .eq("status", "pending")
    .order("created_at")
    .order("id")
    .limit(25);
  if (error) throw error;
  if (dryRun) return { status: "dry_run", candidates: rows.length, ...stats };
  for (const row of rows) {
    const queue = () => admin.from("operational_email_events");
    const { data: claim, error: claimError } = await queue()
      .update({ status: "sending", claimed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claim) continue;
    let status: keyof typeof stats = "failed";
    let reason: string | null = "LOOKUP_OR_CONFIGURATION";
    try {
      const contract = row.kind === "manager" || row.kind === "inspector";
      const { data: tenant, error: te } = await admin
        .from("tenants")
        .select("name,enabled_modules")
        .eq("id", row.tenant_id)
        .eq("status", "active")
        .in("commercial_status", ["active", "trial"])
        .maybeSingle();
      const { data: member, error: me } = await admin
        .from("tenant_memberships")
        .select("id")
        .eq("tenant_id", row.tenant_id)
        .eq("user_id", row.recipient)
        .eq("status", "active")
        .maybeSingle();
      let query = admin
        .from(contract ? "contracts" : "procurement_processes")
        .select("number")
        .eq("id", row.entity_id)
        .eq("tenant_id", row.tenant_id);
      if (contract) query = query.eq(row.kind + "_user_id", row.recipient);
      else if (row.kind === "stage")
        query = query.eq("stage", row.stage).eq("status", "em_andamento");
      else
        query = query
          .eq("responsible_user_id", row.recipient)
          .eq("status", "em_andamento")
          .lte("updated_at", new Date(Date.now() - 8 * 86400000).toISOString());
      const { data: entity, error: ee } = await query.maybeSingle();
      if (te || me || ee) throw new Error("LOOKUP");
      let eligible = !!(
        tenant?.enabled_modules?.[contract ? "contratos" : "processos"] &&
        member &&
        entity
      );
      let taskId = "";
      if (eligible && !contract) {
        let items = admin
          .from("process_items")
          .select("id")
          .eq("tenant_id", row.tenant_id)
          .eq("process_id", row.entity_id);
        items =
          row.kind === "stage"
            ? items
                .eq("stage", row.stage)
                .eq("responsible_user_id", row.recipient)
                .eq("is_done", false)
            : items.gt("updated_at", new Date(Date.now() - 8 * 86400000).toISOString());
        const { data: list, error } = await items.order("id").limit(1);
        if (error) throw error;
        eligible = row.kind === "stage" ? !!list?.length : !list?.length;
        taskId = list?.[0]?.id ?? "";
      }
      if (!eligible) {
        status = "skipped";
        reason = "NO_LONGER_ELIGIBLE";
      } else {
        const { data, error } = await admin.auth.admin.getUserById(row.recipient);
        if (error) throw error;
        if (!data.user.email_confirmed_at || !data.user.email) {
          status = "skipped";
          reason = "NO_VERIFIED_EMAIL";
        } else {
          const provider = await emailProvider(admin, row.tenant_id, key, from);
          const title = contract
            ? `Você foi designado ${row.kind === "manager" ? "Gestor" : "Fiscal"} do Contrato nº ${entity!.number}`
            : row.kind === "stage"
              ? `Nova tarefa no processo nº ${entity!.number}`
              : `Processo nº ${entity!.number} sem movimentação há pelo menos 8 dias`;
          const url = new URL(contract ? "/contratos" : "/processos", origin);
          if (!contract) {
            url.searchParams.set("processo", row.entity_id);
            if (taskId) url.hash = "tarefa-" + taskId;
          }
          const subject = sanitizeEmailSubject(title + " — " + tenant!.name);
          const attachments = await tenantLogo(admin, row.tenant_id);
          const result = await provider({
            attachments,
            to: data.user.email,
            subject,
            html: `<html lang="pt-BR"><body style="font:16px/1.5 Arial,sans-serif">${attachments ? logoHtml : ""}<h2>${escapeHtml(tenant!.name)}</h2><p>${escapeHtml(title)}</p><a href="${escapeHtml(url.href)}">Abrir no Primus Gestão</a></body></html>`,
            idempotencyKey: "operational-" + row.id,
          });
          status =
            result.status === "accepted"
              ? "sent"
              : result.status === "uncertain"
                ? "uncertain"
                : "failed";
          reason =
            result.status === "rejected"
              ? result.errorCode
              : result.status === "uncertain"
                ? "PROVIDER_UNCERTAIN"
                : null;
        }
      }
    } catch {
      /* Persist only the stable diagnostic code. */
    }
    const { error: finish } = await queue()
      .update({ status, reason })
      .eq("id", row.id)
      .eq("status", "sending");
    if (finish) throw finish;
    stats[status]++;
  }
  return { status: "processed", ...stats, has_more: rows.length === 25 };
}
