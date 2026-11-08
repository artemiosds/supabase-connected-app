import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

const PREVIEW_ORIGIN = "https://id-preview--0f44b9ce-9cdb-4fc9-892b-0bd2cf70b798.lovable.app";

function getAllowedOrigins(): Set<string> {
  const configured = (Deno.env.get("INVITE_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const appUrl = Deno.env.get("APP_URL")?.trim();
  return new Set(
    [PREVIEW_ORIGIN, "http://localhost:5173", ...(appUrl ? [appUrl] : []), ...configured]
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
}

function jsonResponse(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

Deno.serve(async (request: Request) => {
  const originHeader = request.headers.get("Origin") ?? "";
  let origin = "";
  try {
    origin = new URL(originHeader).origin;
  } catch {
    origin = "";
  }

  if (!origin || !getAllowedOrigins().has(origin)) {
    return new Response("Origin não autorizado.", { status: 403 });
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
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Configuração de Auth ausente na Edge Function de convites.");
    return jsonResponse(
      { error: "O serviço de convites ainda não está configurado no servidor." },
      503,
      origin,
    );
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  let body: {
    tenant_id?: string;
    email?: string;
    role_id?: string;
    full_name?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "O corpo da solicitação não é JSON válido." }, 400, origin);
  }

  const tenantId = body.tenant_id?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const roleId = body.role_id?.trim() ?? "";
  const fullName = body.full_name?.trim() ?? "";

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!uuidPattern.test(tenantId) || !uuidPattern.test(roleId)) {
    return jsonResponse({ error: "Secretaria ou papel inválido." }, 400, origin);
  }
  if (!emailPattern.test(email) || email.length > 254) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400, origin);
  }
  if (fullName.length < 2 || fullName.length > 160) {
    return jsonResponse(
      { error: "Informe o nome completo do convidado (2 a 160 caracteres)." },
      400,
      origin,
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  if (authError || !authData.user || authData.user.is_anonymous) {
    return jsonResponse({ error: "Sua sessão expirou. Entre novamente." }, 401, origin);
  }
  if (!authData.user.email_confirmed_at) {
    return jsonResponse(
      { error: "Confirme seu próprio e-mail antes de enviar convites." },
      403,
      origin,
    );
  }

  const { data: invitationId, error: invitationError } = await userClient.rpc(
    "create_tenant_invitation",
    {
      p_tenant_id: tenantId,
      p_email: email,
      p_role_id: roleId,
    },
  );

  if (invitationError || !invitationId) {
    const message = invitationError?.message ?? "Não foi possível criar o convite.";
    const isConflict =
      message.includes("Já existe uma conta") ||
      message.includes("convite pendente") ||
      message.includes("papel selecionado");
    return jsonResponse(
      {
        error: isConflict
          ? message
          : "Não foi possível criar o convite. Verifique suas permissões e tente novamente.",
      },
      isConflict ? 409 : 403,
      origin,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const redirectTo = new URL("/redefinir-senha?convite=1", origin).toString();
  const { data: inviteData, error: sendError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo,
      data: { full_name: fullName, display_name: fullName },
    },
  );

  if (sendError || !inviteData.user) {
    const { error: revokeError } = await userClient.rpc("revoke_tenant_invitation", {
      p_invitation_id: invitationId,
    });
    if (revokeError) {
      console.error(
        "Não foi possível encerrar o convite após falha do provedor.",
        revokeError.message,
      );
    }
    console.error(
      "Falha ao enviar e-mail de convite.",
      sendError?.message ?? "Auth não retornou usuário.",
    );
    const throttled =
      sendError?.status === 429 || sendError?.message.toLowerCase().includes("rate limit");
    return jsonResponse(
      {
        error: throttled
          ? "O serviço de e-mail atingiu o limite de envio. Aguarde e tente novamente."
          : "O convite não foi enviado. Verifique o SMTP e as configurações de e-mail do Supabase.",
      },
      throttled ? 429 : 502,
      origin,
    );
  }

  const { error: attachError } = await userClient.rpc("set_tenant_invitation_auth_user", {
    p_invitation_id: invitationId,
    p_invited_user_id: inviteData.user.id,
  });
  if (attachError) {
    // Acceptance remains bound to the invited email when this auxiliary link fails.
    console.error(
      "Convite enviado, mas não foi possível associar o ID do Auth.",
      attachError.message,
    );
  }

  return jsonResponse(
    {
      invitation_id: invitationId,
      status: "pending",
      message:
        "Convite enviado. O acesso será ativado somente após a confirmação do e-mail e o primeiro acesso.",
    },
    200,
    origin,
  );
});
