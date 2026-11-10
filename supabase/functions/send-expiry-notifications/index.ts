import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";
import {
  alertLevelForDays,
  daysUntilDate,
  escapeHtml,
  expiryAlertIdempotencyKey,
  utcDateOnly,
  type ExpiryAlertLevel,
} from "../_shared/expiry-notification.ts";

const PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

type TenantRow = { id: string; name: string };
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
  const subject = `[Gestão de Fornecedores] ${kind} — ${task.title}`;
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
    '<p>Verifique a documentação e adote as providências administrativas necessárias.</p>',
    `<p><a href="${escapeHtml(destination)}">Abrir Gestão de Fornecedores</a></p>`,
    "<hr><p style=\"font-size:12px;color:#64748b\">Mensagem automática da plataforma. Não responda a este e-mail.</p>",
    "</body></html>",
  ].join("");
  return { subject, html };
}

async function fetchContracts(
  admin: ReturnType<typeof createClient>,
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
  admin: ReturnType<typeof createClient>,
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

async function fetchRecipients(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<Recipient[]> {
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
  const userByMembership = new Map(memberships.map((membership) => [membership.id, membership.user_id]));
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
      const related = link.tenant_roles as unknown as { slug?: string } | { slug?: string }[] | null;
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
    const { data, error } = await admin
      .from("profiles")
      .select("id,full_name")
      .in("id", batch);
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

async function deliverTask(
  admin: ReturnType<typeof createClient>,
  task: ExpiryTask,
  apiKey: string,
  from: string,
  appUrl: string,
): Promise<"sent" | "failed" | "skipped"> {
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

  const email = makeEmail(task, appUrl);
  const idempotencyKey = expiryAlertIdempotencyKey({
    tenantId: task.tenantId,
    entityType: task.entityType,
    entityId: task.entityId,
    recipientUserId: task.recipientUserId,
    alertLevel: task.alertLevel,
    dueOn: task.dueOn,
  });

  let providerMessageId: string | null = null;
  let errorCode: string | null = null;
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [task.recipientEmail],
        subject: email.subject,
        html: email.html,
      }),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      errorCode = `RESEND_HTTP_${response.status}`;
    } else {
      providerMessageId =
        typeof responseBody?.id === "string" ? responseBody.id : null;
    }
  } catch {
    errorCode = "RESEND_NETWORK_ERROR";
  }

  if (errorCode) {
    await admin.rpc("finish_expiry_notification_delivery", {
      p_delivery_id: deliveryId,
      p_status: "failed",
      p_provider_message_id: null,
      p_error_code: errorCode,
    });
    return "failed";
  }

  const { data: completed, error: completionError } = await admin.rpc(
    "finish_expiry_notification_delivery",
    {
      p_delivery_id: deliveryId,
      p_status: "sent",
      p_provider_message_id: providerMessageId,
      p_error_code: null,
    },
  );
  return completionError || completed !== true ? "failed" : "sent";
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EXPIRY_ALERTS_FROM");
  const appUrl = Deno.env.get("APP_URL");
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !from || !appUrl) {
    return jsonResponse(
      { error: "Alertas automáticos não configurados no servidor." },
      503,
    );
  }

  let appOrigin: string;
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("Invalid application origin.");
    }
    appOrigin = parsed.origin;
  } catch {
    return jsonResponse({ error: "APP_URL precisa ser uma origem HTTPS válida." }, 503);
  }

  let batchSize = DEFAULT_BATCH_SIZE;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.batch_size !== undefined) {
      const value = Number(body.batch_size);
      if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
        return jsonResponse({ error: "batch_size precisa estar entre 1 e 100." }, 400);
      }
      batchSize = value;
    }
  } catch {
    return jsonResponse({ error: "Corpo da solicitação inválido." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

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
        .select("id,name")
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
        fetchContracts(admin, tenant.id, limitDate),
        fetchDocuments(admin, tenant.id, limitDate),
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

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let attempted = 0;
    for (const task of tasks) {
      const result = await deliverTask(admin, task, resendApiKey, from, appOrigin);
      if (result === "sent") sent += 1;
      else if (result === "failed") failed += 1;
      else skipped += 1;

      if (result !== "skipped") attempted += 1;
      if (attempted >= batchSize) break;
    }

    return jsonResponse({
      status: "processed",
      date: today,
      candidates: tasks.length,
      attempted,
      sent,
      failed,
      skipped,
      has_more: attempted >= batchSize && tasks.length > attempted,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNEXPECTED_ERROR";
    console.error("Expiry notification run failed:", code);
    return jsonResponse({ error: "Falha ao processar notificações de vencimento." }, 500);
  }
});
