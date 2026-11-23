import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type JsonObject = Record<string, unknown>;
const FEATURE_KEYS = [
  "assistant",
  "documents",
  "price_research",
  "supplier_documents",
  "contract_monitoring",
  "delivery_receiving",
  "tasks",
  "email_alerts",
] as const;

function response(payload: JsonObject, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

function safeConfiguration(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    provider: row.provider,
    model: row.model,
    enabled: row.enabled === true,
    status: row.status,
    has_credentials: Boolean(row.vault_secret_id),
    last_test_at: row.last_test_at,
    updated_at: row.updated_at,
  };
}

function validFeatures(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every(
    ([key, enabled]) =>
      (FEATURE_KEYS as readonly string[]).includes(key) && typeof enabled === "boolean",
  );
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try {
    origin = new URL(request.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", { status: 403 });
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
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey)
    return response({ error: "O serviço de configuração de IA está incompleto." }, 503, origin);

  const token = request.headers
    .get("Authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return response({ error: "Sessão autenticada obrigatória." }, 401, origin);
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (
    authError ||
    !authData.user ||
    authData.user.is_anonymous ||
    !authData.user.email_confirmed_at
  ) {
    return response(
      { error: "Entre com uma conta confirmada do Administrador Master." },
      401,
      origin,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: admin, error: adminError } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (adminError) {
    console.error("Falha ao validar o Administrador Master na plataforma:", {
      code: adminError.code,
      message: adminError.message,
    });
    return response(
      {
        error:
          "Não foi possível validar a autorização do Administrador Master. Tente novamente mais tarde.",
      },
      500,
      origin,
    );
  }
  if (!admin)
    return response(
      { error: "Somente o Administrador Master ativo pode configurar a IA." },
      403,
      origin,
    );

  if (Number(request.headers.get("Content-Length") ?? "0") > 12_000)
    return response({ error: "A solicitação excede o tamanho permitido." }, 413, origin);
  let body: JsonObject;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("invalid body");
    body = parsed as JsonObject;
  } catch {
    return response({ error: "O corpo da solicitação é inválido." }, 400, origin);
  }

  const action = body.action;
  if (action === "get") {
    const [{ data: config, error: configError }, { data: tenants, error: tenantsError }] =
      await Promise.all([
        adminClient
          .from("platform_ai_configuration")
          .select("provider,model,enabled,status,vault_secret_id,last_test_at,updated_at")
          .eq("id", 1)
          .maybeSingle(),
        adminClient
          .from("tenants")
          .select("id,name,status,commercial_status,trial_starts_at,trial_ends_at")
          .order("name", { ascending: true }),
      ]);
    if (configError || tenantsError) {
      console.error(
        "Falha ao carregar a configuração de IA:",
        configError?.message ?? tenantsError?.message,
      );
      return response({ error: "Não foi possível carregar a configuração da IA." }, 500, origin);
    }
    const { data: settings, error: settingsError } = await adminClient
      .from("tenant_ai_settings")
      .select("tenant_id,enabled,features,updated_at");
    if (settingsError) {
      console.error("Falha ao carregar habilitações de IA por Secretaria:", settingsError.message);
      return response(
        { error: "Não foi possível carregar as Secretarias configuradas." },
        500,
        origin,
      );
    }
    const settingsByTenant = new Map((settings ?? []).map((row) => [row.tenant_id, row]));
    return response(
      {
        configuration: safeConfiguration(config as Record<string, unknown> | null),
        tenants: (tenants ?? []).map((tenant) => {
          const current = settingsByTenant.get(tenant.id);
          const operational =
            tenant.status === "active" &&
            (tenant.commercial_status === "active" ||
              (tenant.commercial_status === "trial" &&
                typeof tenant.trial_starts_at === "string" &&
                new Date(tenant.trial_starts_at).getTime() <= Date.now() &&
                typeof tenant.trial_ends_at === "string" &&
                new Date(tenant.trial_ends_at).getTime() > Date.now()));
          return {
            id: tenant.id,
            name: tenant.name,
            status: tenant.status,
            commercial_status: tenant.commercial_status,
            operational,
            enabled: current?.enabled === true,
            features: current?.features ?? {},
            updated_at: current?.updated_at ?? null,
          };
        }),
      },
      200,
      origin,
    );
  }

  if (action === "save") {
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model))
      return response({ error: "Informe um identificador válido de modelo." }, 400, origin);
    if (apiKey && (apiKey.length < 20 || apiKey.length > 500))
      return response({ error: "A credencial informada tem tamanho inválido." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_save_configuration", {
      p_actor_id: authData.user.id,
      p_model: model,
      p_api_key: apiKey || null,
    });
    if (error) {
      return response({ error: "Não foi possível salvar a configuração de IA." }, 400, origin);
    }
    return response({ result: data }, 200, origin);
  }

  if (action === "test") {
    const { data: config, error: configError } = await adminClient
      .from("platform_ai_configuration")
      .select("model,vault_secret_id")
      .eq("id", 1)
      .maybeSingle();
    if (configError || !config?.model || !config.vault_secret_id)
      return response({ error: "Salve o modelo e a credencial antes do teste." }, 400, origin);
    const { data: apiKey, error: secretError } = await adminClient.rpc("platform_ai_get_api_key");
    if (secretError || typeof apiKey !== "string" || !apiKey)
      return response({ error: "Não foi possível acessar a credencial protegida." }, 503, origin);

    let connected = false;
    try {
      const providerResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input: "Responda somente com a palavra OK.",
          max_output_tokens: 16,
          store: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      connected = providerResponse.ok;
      if (!providerResponse.ok) await providerResponse.body?.cancel();
      else await providerResponse.body?.cancel();
    } catch {
      connected = false;
    }
    const { error: statusError } = await adminClient.rpc("platform_ai_set_connection_status", {
      p_actor_id: authData.user.id,
      p_status: connected ? "connected" : "failed",
    });
    if (statusError) {
      console.error("Falha ao registrar teste de conexão de IA:", statusError.message);
      return response(
        { error: "O teste terminou, mas não foi possível registrar o resultado." },
        500,
        origin,
      );
    }
    return response(
      {
        connected,
        message: connected
          ? "Conexão validada pelo provedor. A IA permanece desligada até ativação explícita."
          : "O provedor não validou a credencial, o modelo ou a conexão. Confira-os e tente novamente.",
      },
      200,
      origin,
    );
  }

  if (action === "set_global_enabled") {
    if (typeof body.enabled !== "boolean")
      return response({ error: "Informe o estado de ativação global." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_global_enabled", {
      p_actor_id: authData.user.id,
      p_enabled: body.enabled,
    });
    if (error)
      return response({ error: "Teste a conexão antes de ativar globalmente a IA." }, 400, origin);
    return response({ result: data }, 200, origin);
  }

  if (action === "save_tenant") {
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (
      !/^[0-9a-f-]{36}$/i.test(tenantId) ||
      typeof body.enabled !== "boolean" ||
      !validFeatures(body.features)
    )
      return response({ error: "Configuração da Secretaria inválida." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_tenant_settings", {
      p_actor_id: authData.user.id,
      p_tenant_id: tenantId,
      p_enabled: body.enabled,
      p_features: body.features,
    });
    if (error) {
      console.error("Falha ao salvar configuração da Secretaria:", error.message);
      return response(
        { error: "Não foi possível salvar os recursos de IA desta Secretaria." },
        400,
        origin,
      );
    }
    return response({ result: data }, 200, origin);
  }

  return response({ error: "Ação não reconhecida." }, 400, origin);
});
