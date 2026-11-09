import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

function response(payload: Record<string, unknown>, status: number, origin: string) {
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
  try { origin = new URL(originHeader).origin; } catch { origin = ""; }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origin não autorizado.", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
    }});
  }
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return response({ error: "Serviço de convites não configurado." }, 503, origin);
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return response({ error: "Sessão autenticada obrigatória." }, 401, origin);

  let body: {
    email?: string; display_name?: string; tenant_id?: string;
    can_view_suppliers?: boolean; can_create_suppliers?: boolean; can_update_suppliers?: boolean;
  };
  try { body = await request.json(); } catch {
    return response({ error: "Corpo JSON inválido." }, 400, origin);
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.display_name?.trim() ?? "";
  const tenantId = body.tenant_id?.trim() ?? "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const canView = body.can_view_suppliers !== false;
  const canCreate = body.can_create_suppliers === true;
  const canUpdate = body.can_update_suppliers === true;
  if (!emailPattern.test(email) || email.length > 254) return response({ error: "E-mail inválido." }, 400, origin);
  if (displayName.length < 2 || displayName.length > 120) return response({ error: "Informe o nome completo do técnico." }, 400, origin);
  if (!uuidPattern.test(tenantId)) return response({ error: "Organização inválida." }, 400, origin);
  if (!canView && (canCreate || canUpdate)) return response({ error: "Criar ou editar exige permissão de consulta." }, 400, origin);

  const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous || !auth.user.email_confirmed_at) {
    return response({ error: "Sua sessão expirou ou o e-mail ainda não foi confirmado." }, 401, origin);
  }
  const { data: isMaster, error: permissionError } = await userClient.rpc("is_my_platform_admin");
  if (permissionError || isMaster !== true) return response({ error: "Apenas o Administrador Master pode convidar técnicos." }, 403, origin);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const redirectTo = new URL("/redefinir-senha?convite=suporte", origin).toString();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: displayName, display_name: displayName },
  });
  if (inviteError || !invited.user) {
    const throttled = inviteError?.status === 429 || inviteError?.message.toLowerCase().includes("rate limit");
    return response({
      error: throttled
        ? "Limite de envio de e-mails atingido. Aguarde e tente novamente."
        : "Não foi possível enviar o convite. Verifique se o e-mail já possui conta e as configurações SMTP.",
    }, throttled ? 429 : 502, origin);
  }

  const { error: registerError } = await userClient.rpc("register_platform_support_agent", {
    p_user_id: invited.user.id,
    p_display_name: displayName,
    p_tenant_id: tenantId,
    p_can_view_suppliers: canView,
    p_can_create_suppliers: canCreate,
    p_can_update_suppliers: canUpdate,
  });
  if (registerError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(invited.user.id);
    if (cleanupError) console.error("Falha ao limpar conta criada sem perfil de suporte.", cleanupError.message);
    console.error("Falha ao registrar convite de suporte.", registerError.message);
    return response({ error: "O convite não foi concluído. Nenhum perfil de suporte foi ativado; verifique a organização e tente novamente." }, 409, origin);
  }

  return response({
    status: "invited",
    email,
    message: "Convite enviado. O técnico só poderá acessar após confirmar o e-mail e ativar a conta.",
  }, 200, origin);
});
