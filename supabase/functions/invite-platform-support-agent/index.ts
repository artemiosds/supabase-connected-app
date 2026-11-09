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

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Serviço de convites não configurado no servidor." }, 503, origin);
  }

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  let body: {
    email?: string;
    display_name?: string;
    tenant_id?: string;
    can_view_suppliers?: boolean;
    can_create_suppliers?: boolean;
    can_update_suppliers?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "O corpo da solicitação não é JSON válido." }, 400, origin);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.display_name?.trim() ?? "";
  const tenantId = body.tenant_id?.trim() ?? "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const canView = body.can_view_suppliers !== false;
  const canCreate = body.can_create_suppliers === true;
  const canUpdate = body.can_update_suppliers === true;

  if (!emailPattern.test(email) || email.length > 254) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400, origin);
  }
  if (displayName.length < 2 || displayName.length > 120) {
    return jsonResponse({ error: "Informe o nome completo do técnico." }, 400, origin);
  }
  if (!uuidPattern.test(tenantId)) {
    return jsonResponse({ error: "Organização inválida." }, 400, origin);
  }
  if (!canView && (canCreate || canUpdate)) {
    return jsonResponse({ error: "Criar ou editar exige permissão de consulta." }, 400, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user || authData.user.is_anonymous || !authData.user.email_confirmed_at) {
    return jsonResponse({ error: "Sua sessão expirou ou seu e-mail ainda não foi confirmado." }, 401, origin);
  }

  // This table has a self-only SELECT policy: no user-editable metadata is trusted for authorization.
  const { data: master, error: masterError } = await userClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (masterError || master?.user_id !== authData.user.id) {
    return jsonResponse({ error: "Apenas o Administrador Master pode convidar técnicos." }, 403, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const redirectTo = new URL("/redefinir-senha?convite=1&tipo=suporte", origin).toString();
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: displayName, display_name: displayName },
  });
  if (inviteError || !inviteData.user) {
    const throttled = inviteError?.status === 429 ||
      inviteError?.message.toLowerCase().includes("rate limit");
    return jsonResponse({
      error: throttled
        ? "O serviço de e-mail atingiu o limite de envio. Aguarde e tente novamente."
        : "O convite não foi enviado. Verifique se o e-mail já possui conta e as configurações SMTP do Supabase.",
    }, throttled ? 429 : 502, origin);
  }

  const { error: registerError } = await userClient.rpc("register_platform_support_agent", {
    p_user_id: inviteData.user.id,
    p_email: email,
    p_display_name: displayName,
    p_tenant_id: tenantId,
    p_can_view_suppliers: canView,
    p_can_create_suppliers: canCreate,
    p_can_update_suppliers: canUpdate,
  });

  if (registerError) {
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(inviteData.user.id);
    if (cleanupError) {
      console.error("Falha ao limpar conta após rejeição do cadastro de suporte.", cleanupError.message);
    }
    console.error("Falha ao registrar técnico convidado.", registerError.message);
    return jsonResponse({
      error: "O convite não foi concluído. A conta não recebeu acesso de suporte; verifique a organização e tente novamente.",
    }, 409, origin);
  }

  return jsonResponse({
    status: "invited",
    email,
    message: "Convite enviado. O acesso só será ativado após a confirmação do e-mail e o primeiro login.",
  }, 200, origin);
});
