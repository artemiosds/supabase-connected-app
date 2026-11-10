import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

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

  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
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
  if (request.method !== "POST")
    return jsonResponse({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { error: "Serviço de convites internos não configurado no servidor." },
      503,
      origin,
    );
  }

  const token = request.headers
    .get("Authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);

  let body: { email?: string; display_name?: string; role_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "O corpo da solicitação não é JSON válido." }, 400, origin);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.display_name?.trim() ?? "";
  const roleIds = Array.isArray(body.role_ids) ? body.role_ids : [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!emailPattern.test(email) || email.length > 254) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400, origin);
  }
  if (displayName.length < 2 || displayName.length > 120) {
    return jsonResponse({ error: "Informe o nome completo do colaborador." }, 400, origin);
  }
  if (
    roleIds.length < 1 ||
    roleIds.length > 10 ||
    roleIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
    new Set(roleIds).size !== roleIds.length
  ) {
    return jsonResponse({ error: "Selecione de um a dez perfis internos válidos." }, 400, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (
    authError ||
    !authData.user ||
    authData.user.is_anonymous ||
    !authData.user.email_confirmed_at
  ) {
    return jsonResponse(
      { error: "Sua sessão expirou ou seu e-mail ainda não foi confirmado." },
      401,
      origin,
    );
  }

  const { data: canInvite, error: accessError } = await userClient.rpc("can_manage_platform_staff");
  if (accessError || canInvite !== true) {
    return jsonResponse(
      { error: "Somente o Administrador Master pode convidar colaboradores internos." },
      403,
      origin,
    );
  }

  const { data: emailAvailable, error: emailCheckError } = await userClient.rpc(
    "can_invite_platform_staff",
    { p_email: email },
  );
  if (emailCheckError || emailAvailable !== true) {
    return jsonResponse(
      {
        error:
          "Este e-mail já está vinculado a uma conta da plataforma ou não pode receber um novo cadastro interno. Use um e-mail exclusivo.",
      },
      emailCheckError ? 403 : 409,
      origin,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const redirectTo = new URL("/redefinir-senha?convite=1&tipo=interno", origin).toString();
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo,
      data: { full_name: displayName },
    },
  );

  if (inviteError || !inviteData.user) {
    const throttled =
      inviteError?.status === 429 || inviteError?.message.toLowerCase().includes("rate limit");
    return jsonResponse(
      {
        error: throttled
          ? "O serviço de e-mail atingiu o limite de envio. Aguarde e tente novamente."
          : "O convite não foi enviado. Verifique se o e-mail já possui conta e as configurações SMTP do Supabase.",
      },
      throttled ? 429 : 502,
      origin,
    );
  }

  const { error: registerError } = await userClient.rpc("register_platform_staff", {
    p_user_id: inviteData.user.id,
    p_email: email,
    p_display_name: displayName,
    p_role_ids: roleIds,
  });

  if (registerError) {
    // Nunca excluir uma identidade Auth automaticamente: uma corrida ou uma
    // política do provedor pode indicar uma conta pré-existente. Sem o registro
    // RBAC, a identidade não recebe acesso ao portal.
    console.error(
      "Falha ao registrar colaborador interno; nenhum perfil RBAC foi concedido.",
      registerError.message,
    );
    return jsonResponse(
      {
        error:
          "O e-mail foi aceito pelo serviço de convites, mas o perfil interno não foi criado. Nenhuma permissão foi concedida; solicite revisão ao Administrador Master antes de tentar novamente.",
      },
      409,
      origin,
    );
  }

  return jsonResponse(
    {
      status: "invited",
      email,
      message:
        "Convite enviado. O acesso só será ativado após confirmação do e-mail e definição da senha.",
    },
    200,
    origin,
  );
});
