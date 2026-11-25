import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getAllowedOrigins } from "../_shared/origins.ts";
import { sendResendEmail } from "../_shared/expiry-notification-provider.ts";
import {
  buildCommercialAlertEmail,
  resolveCommercialAlertRecipients,
  type CommercialAlertCandidate,
} from "../_shared/commercial-alerts.ts";

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

function json(payload: Record<string, unknown>, status: number, origin?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

Deno.serve(async (request: Request) => {
  const originHeader = request.headers.get("Origin");
  let origin = "";
  if (originHeader) {
    try {
      origin = new URL(originHeader).origin;
    } catch {
      origin = "";
    }
    if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
      return new Response("Origem não autorizada.", { status: 403 });
    }
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Método não permitido." }, 405, origin || undefined);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Serviço de alertas comerciais indisponível." }, 503, origin || undefined);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // Autenticação dupla fail-closed: segredo cron OU sessão confirmada de Administrador Master ativo
  const expectedCronSecret = Deno.env.get("EXPIRY_ALERTS_CRON_SECRET") ?? "";
  const suppliedCronSecret = request.headers.get("x-expiry-alert-secret") ?? "";
  let authorized = false;

  if (!origin && suppliedCronSecret) {
    if (
      expectedCronSecret.length >= 32 &&
      constantTimeEquals(suppliedCronSecret, expectedCronSecret)
    ) {
      authorized = true;
    } else {
      return json({ error: "Não autorizado." }, 401);
    }
  } else {
    const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      return json({ error: "Sessão autenticada obrigatória." }, 401, origin || undefined);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
    if (
      authError ||
      !authData.user ||
      authData.user.is_anonymous ||
      !authData.user.email_confirmed_at
    ) {
      return json(
        { error: "Sessão autenticada e e-mail confirmado são obrigatórios." },
        401,
        origin || undefined,
      );
    }
    const { data: adminRow, error: adminError } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (adminError || !adminRow) {
      return json(
        { error: "Acesso restrito ao Administrador Master ativo." },
        403,
        origin || undefined,
      );
    }
    authorized = true;
  }

  if (!authorized) {
    return json({ error: "Não autorizado." }, 401, origin || undefined);
  }

  let dryRun = true;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const body = parsed as Record<string, unknown>;
      dryRun = body.dry_run !== false;
    }
  } catch {
    return json({ error: "Corpo da solicitação inválido." }, 400, origin || undefined);
  }

  const { data: candidatesRaw, error: candidatesError } = await admin.rpc(
    "list_platform_commercial_alert_candidates",
  );
  if (candidatesError) {
    console.error("Falha ao listar candidatos comerciais:", candidatesError.message);
    return json(
      { error: "Não foi possível consultar os alertas pendentes." },
      500,
      origin || undefined,
    );
  }

  const candidates = (
    Array.isArray(candidatesRaw) ? candidatesRaw : []
  ) as CommercialAlertCandidate[];
  if (dryRun) {
    return json(
      {
        status: "dry_run",
        candidates_count: candidates.length,
        candidates,
      },
      200,
      origin || undefined,
    );
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("EXPIRY_ALERTS_FROM") ?? "";
  const appUrl = Deno.env.get("APP_URL") ?? origin ?? "";
  let appOrigin = "";
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("invalid");
    }
    appOrigin = parsed.origin;
  } catch {
    return json(
      { error: "APP_URL precisa ser uma origem HTTPS válida no servidor." },
      503,
      origin || undefined,
    );
  }

  if (!resendApiKey || !fromEmail) {
    return json(
      {
        error:
          "Configure RESEND_API_KEY e EXPIRY_ALERTS_FROM nos Secrets do Supabase para habilitar envios reais.",
      },
      503,
      origin || undefined,
    );
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const recipients = resolveCommercialAlertRecipients(candidate);
    if (recipients.length === 0) {
      skipped += 1;
      await admin.from("platform_commercial_alerts").upsert(
        {
          tenant_id: candidate.tenant_id,
          invoice_id: candidate.invoice_id,
          alert_kind: candidate.alert_kind,
          severity: candidate.severity,
          recipient_email: "nao-informado",
          recipient_scope: candidate.recipient_scope,
          dedupe_key: candidate.dedupe_key,
          status: "skipped",
          reason: "MISSING_VALID_RECIPIENT",
          metadata: candidate.metadata,
        },
        { onConflict: "dedupe_key" },
      );
      continue;
    }

    const email = buildCommercialAlertEmail(candidate, appOrigin);
    let candidateSent = true;
    let failureReason: string | null = null;

    for (const recipient of recipients) {
      const result = await sendResendEmail({
        apiKey: resendApiKey,
        from: fromEmail,
        to: recipient,
        subject: email.subject,
        html: email.html,
        idempotencyKey: `commercial-${candidate.dedupe_key}-${recipient}`,
      });
      if (result.status !== "accepted") {
        candidateSent = false;
        failureReason = result.status === "rejected" ? result.errorCode : "PROVIDER_UNCERTAIN";
      }
    }

    if (candidateSent) sent += 1;
    else failed += 1;

    await admin.from("platform_commercial_alerts").upsert(
      {
        tenant_id: candidate.tenant_id,
        invoice_id: candidate.invoice_id,
        alert_kind: candidate.alert_kind,
        severity: candidate.severity,
        recipient_email: recipients.join(", "),
        recipient_scope: candidate.recipient_scope,
        dedupe_key: candidate.dedupe_key,
        status: candidateSent ? "sent" : "failed",
        reason: candidateSent ? null : failureReason,
        metadata: candidate.metadata,
        sent_at: candidateSent ? new Date().toISOString() : null,
      },
      { onConflict: "dedupe_key" },
    );
  }

  return json(
    {
      status: "processed",
      candidates_count: candidates.length,
      sent,
      failed,
      skipped,
    },
    200,
    origin || undefined,
  );
});
