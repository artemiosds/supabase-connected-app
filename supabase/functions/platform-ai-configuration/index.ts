import { getAllowedOrigins } from "../_shared/origins.ts";
import {
  invokeAiProvider,
  type AiProviderConfig,
  type AiProviderKind,
} from "../_shared/ai-providers.ts";
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
const PROVIDER_TYPES: readonly AiProviderKind[] = [
  "openai",
  "gemini",
  "anthropic",
  "azure_openai",
  "openai_compatible",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function validFeatures(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, enabled]) =>
      (FEATURE_KEYS as readonly string[]).includes(key) && typeof enabled === "boolean",
  );
}

function validBaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const isIpAddress = /^[0-9.]+$/.test(hostname) || hostname.startsWith("[");
    const isLocalHost =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".localdomain") ||
      hostname.endsWith(".lan");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      hostname.includes(".") &&
      !isIpAddress &&
      !isLocalHost &&
      /^[A-Za-z0-9.-]+$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function optionalPrice(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) return undefined;
  return parsed;
}

function safeProvider(row: Record<string, unknown>) {
  const { vault_secret_id, ...publicFields } = row;
  return { ...publicFields, has_credentials: Boolean(vault_secret_id) };
}

function aggregateUsage(
  rows: Record<string, unknown>[],
  providers: Record<string, unknown>[],
  tenants: Record<string, unknown>[],
) {
  const providerNames = new Map(
    providers.map((provider) => [String(provider.id), provider] as const),
  );
  const tenantNames = new Map(
    tenants.map((tenant) => [String(tenant.id), tenant] as const),
  );
  const grouped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    const providerId = String(row.provider_id ?? "unknown");
    const key = tenantId + ":" + providerId;
    const current = grouped.get(key) ?? {
      tenant_id: tenantId,
      tenant_name: String(tenantNames.get(tenantId)?.name ?? "Secretaria"),
      provider_id: providerId,
      provider_name: String(providerNames.get(providerId)?.name ?? "Provedor removido"),
      model: String(row.model ?? ""),
      requests: 0,
      failed_requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      cost_complete: true,
    };
    current.requests = Number(current.requests) + 1;
    if (row.status === "failed") current.failed_requests = Number(current.failed_requests) + 1;
    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    current.input_tokens =
      Number(current.input_tokens) + (Number.isFinite(inputTokens) ? inputTokens : 0);
    current.output_tokens =
      Number(current.output_tokens) + (Number.isFinite(outputTokens) ? outputTokens : 0);
    if (row.estimated_cost_usd === null || row.estimated_cost_usd === undefined) {
      current.cost_complete = false;
    } else {
      current.estimated_cost_usd =
        Number(current.estimated_cost_usd) + Number(row.estimated_cost_usd);
    }
    grouped.set(key, current);
  }

  return [...grouped.values()].sort(
    (a, b) =>
      Number(b.requests) - Number(a.requests) ||
      String(a.tenant_name).localeCompare(String(b.tenant_name)),
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

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return response({ error: "Sessão autenticada obrigatória." }, 401, origin);

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
    console.error("Falha ao validar o Administrador Master:", adminError.code);
    return response(
      { error: "Não foi possível validar a autorização administrativa." },
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

  if (Number(request.headers.get("Content-Length") ?? "0") > 20_000)
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
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [
      configurationResult,
      providersResult,
      tenantsResult,
      settingsResult,
      accessResult,
      usageResult,
    ] = await Promise.all([
        adminClient
          .from("platform_ai_configuration")
          .select("provider,enabled,status,last_test_at,updated_at")
          .eq("id", 1)
          .maybeSingle(),
        adminClient
          .from("platform_ai_providers")
          .select(
            [
              "id",
              "name",
              "provider",
              "model",
              "api_base_url",
              "api_version",
              "status",
              "is_enabled",
              "is_primary",
              "fallback_priority",
              "input_cost_per_million",
              "output_cost_per_million",
              "last_test_at",
              "updated_at",
              "vault_secret_id",
            ].join(","),
          )
          .order("is_primary", { ascending: false })
          .order("fallback_priority", { ascending: true })
          .order("created_at", { ascending: true }),
        adminClient
          .from("tenants")
          .select("id,name,status,commercial_status,trial_starts_at,trial_ends_at")
          .order("name", { ascending: true }),
        adminClient
          .from("tenant_ai_settings")
          .select("tenant_id,enabled,features,updated_at"),
        adminClient
          .from("platform_ai_tenant_provider_access")
          .select("tenant_id,provider_id")
          .eq("is_allowed", true),
        adminClient
          .from("platform_ai_usage")
          .select(
            [
              "tenant_id",
              "provider_id",
              "model",
              "status",
              "input_tokens",
              "output_tokens",
              "estimated_cost_usd",
              "created_at",
            ].join(","),
          )
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10000),
      ]);

    const failure =
      configurationResult.error ||
      providersResult.error ||
      tenantsResult.error ||
      settingsResult.error ||
      accessResult.error ||
      usageResult.error;
    if (failure) {
      console.error("Falha ao carregar o gerenciador multiprovedor:", failure.message);
      return response(
        { error: "Não foi possível carregar as configurações e métricas de IA." },
        500,
        origin,
      );
    }

    const providers = (providersResult.data ?? []).map((row) =>
      safeProvider(row as unknown as Record<string, unknown>),
    );
    const settingsByTenant = new Map(
      (settingsResult.data ?? []).map((setting) => [setting.tenant_id, setting] as const),
    );
    const allowedByTenant = new Map<string, string[]>();
    for (const access of accessResult.data ?? []) {
      const current = allowedByTenant.get(access.tenant_id) ?? [];
      current.push(access.provider_id);
      allowedByTenant.set(access.tenant_id, current);
    }
    const now = Date.now();
    const tenants = (tenantsResult.data ?? []).map((tenant) => {
      const operational =
        tenant.status === "active" &&
        (tenant.commercial_status === "active" ||
          (tenant.commercial_status === "trial" &&
            typeof tenant.trial_starts_at === "string" &&
            new Date(tenant.trial_starts_at).getTime() <= now &&
            typeof tenant.trial_ends_at === "string" &&
            new Date(tenant.trial_ends_at).getTime() > now));
      return {
        id: tenant.id,
        name: tenant.name,
        status: tenant.status,
        commercial_status: tenant.commercial_status,
        operational,
        enabled: settingsByTenant.get(tenant.id)?.enabled === true,
        features: settingsByTenant.get(tenant.id)?.features ?? {},
        updated_at: settingsByTenant.get(tenant.id)?.updated_at ?? null,
        allowed_provider_ids: allowedByTenant.get(tenant.id) ?? [],
      };
    });
    const usage = aggregateUsage(
      (usageResult.data ?? []) as unknown as Record<string, unknown>[],
      (providersResult.data ?? []) as unknown as Record<string, unknown>[],
      (tenantsResult.data ?? []) as unknown as Record<string, unknown>[],
    );

    return response(
      {
        configuration: configurationResult.data ?? {
          provider: null,
          enabled: false,
          status: "not_configured",
          last_test_at: null,
          updated_at: null,
        },
        providers,
        tenants,
        usage,
        usage_period_days: 30,
      },
      200,
      origin,
    );
  }

  if (action === "save_provider") {
    const providerId =
      typeof body.provider_id === "string" && UUID.test(body.provider_id) ? body.provider_id : null;
    const provider = typeof body.provider === "string" ? body.provider : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
    const apiBaseUrl =
      typeof body.api_base_url === "string" && body.api_base_url.trim()
        ? body.api_base_url.trim().replace(/\/+$/, "")
        : null;
    const apiVersion =
      typeof body.api_version === "string" && body.api_version.trim()
        ? body.api_version.trim()
        : null;
    const inputCost = optionalPrice(body.input_cost_per_million);
    const outputCost = optionalPrice(body.output_cost_per_million);
    const fallbackPriority =
      typeof body.fallback_priority === "number"
        ? body.fallback_priority
        : Number(body.fallback_priority ?? 100);

    if (!PROVIDER_TYPES.includes(provider as AiProviderKind))
      return response({ error: "Selecione um tipo de provedor suportado." }, 400, origin);
    if (!name || name.length > 80)
      return response({ error: "Informe um nome de provedor com até 80 caracteres." }, 400, origin);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(model))
      return response({ error: "Informe um identificador de modelo válido." }, 400, origin);
    if (apiKey && (apiKey.length < 20 || apiKey.length > 1000))
      return response(
        { error: "A chave de API deve ter entre 20 e 1000 caracteres." },
        400,
        origin,
      );
    if (providerId === null && !apiKey)
      return response(
        { error: "Informe a chave de API para cadastrar um novo provedor." },
        400,
        origin,
      );
    if (inputCost === undefined || outputCost === undefined)
      return response(
        { error: "Informe preços por milhão de tokens válidos e não negativos." },
        400,
        origin,
      );
    if (!Number.isInteger(fallbackPriority) || fallbackPriority < 1 || fallbackPriority > 9999)
      return response(
        { error: "A prioridade de alternativa deve estar entre 1 e 9999." },
        400,
        origin,
      );

    if (provider === "azure_openai" || provider === "openai_compatible") {
      if (!validBaseUrl(apiBaseUrl))
        return response(
          { error: "Informe uma URL HTTPS válida, sem usuário, senha, query ou fragmento." },
          400,
          origin,
        );
    } else if (apiBaseUrl) {
      return response(
        { error: "Este provedor utiliza endpoint oficial e não aceita URL personalizada." },
        400,
        origin,
      );
    }
    if (
      provider === "azure_openai" &&
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}(-preview)?$/.test(apiVersion ?? "")
    )
      return response({ error: "Informe a versão de API do Azure OpenAI." }, 400, origin);

    const { data, error } = await adminClient.rpc("platform_ai_save_provider", {
      p_actor_id: authData.user.id,
      p_provider_id: providerId,
      p_name: name,
      p_provider: provider,
      p_model: model,
      p_api_base_url: apiBaseUrl,
      p_api_version: provider === "azure_openai" ? apiVersion : null,
      p_api_key: apiKey || null,
      p_input_cost_per_million: inputCost,
      p_output_cost_per_million: outputCost,
      p_fallback_priority: fallbackPriority,
    });
    if (error) {
      console.error("Falha ao salvar provedor de IA:", error.message);
      return response(
        { error: error.message || "Não foi possível salvar o provedor." },
        400,
        origin,
      );
    }
    return response({ result: data }, 200, origin);
  }

  if (action === "test_provider") {
    const providerId = typeof body.provider_id === "string" ? body.provider_id : "";
    if (!UUID.test(providerId))
      return response({ error: "Selecione um provedor válido para testar." }, 400, origin);

    const { data: providerRow, error: providerError } = await adminClient
      .from("platform_ai_providers")
      .select("id,name,provider,model,api_base_url,api_version,vault_secret_id")
      .eq("id", providerId)
      .maybeSingle();
    if (providerError || !providerRow)
      return response({ error: "Provedor não encontrado." }, 404, origin);

    const provider = providerRow as AiProviderConfig;
    const { data: apiKey, error: secretError } = await adminClient.rpc(
      "platform_ai_get_provider_api_key",
      { p_provider_id: providerId },
    );
    let connected = false;
    let message = "Não foi possível validar a conexão com o provedor.";
    if (!secretError && typeof apiKey === "string" && apiKey) {
      try {
        await invokeAiProvider(
          provider,
          apiKey,
          [{ role: "user", content: "Responda somente com OK." }],
          "Teste técnico de conectividade. Responda somente com OK.",
          16,
          15_000,
        );
        connected = true;
        message = "Conexão validada. O provedor está disponível para uso e contingência.";
      } catch (cause) {
        message = cause instanceof Error ? cause.message : message;
      }
    } else {
      message = "Não foi possível recuperar a credencial protegida no Supabase Vault.";
    }

    const { data: statusData, error: statusError } = await adminClient.rpc(
      "platform_ai_update_provider_test_status",
      {
        p_actor_id: authData.user.id,
        p_provider_id: providerId,
        p_status: connected ? "connected" : "failed",
      },
    );
    if (statusError) {
      console.error("Falha ao registrar teste de provedor:", statusError.message);
      return response(
        { error: "O teste terminou, mas o resultado não pôde ser registrado." },
        500,
        origin,
      );
    }
    return response(
      { connected, message, result: statusData },
      200,
      origin,
    );
  }

  if (action === "set_primary_provider") {
    const providerId = typeof body.provider_id === "string" ? body.provider_id : "";
    if (!UUID.test(providerId))
      return response({ error: "Selecione um provedor válido." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_primary_provider", {
      p_actor_id: authData.user.id,
      p_provider_id: providerId,
    });
    if (error) return response({ error: error.message }, 400, origin);
    return response({ result: data }, 200, origin);
  }

  if (action === "set_provider_enabled") {
    const providerId = typeof body.provider_id === "string" ? body.provider_id : "";
    if (!UUID.test(providerId) || typeof body.enabled !== "boolean")
      return response({ error: "Informe um provedor e um estado válidos." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_provider_enabled", {
      p_actor_id: authData.user.id,
      p_provider_id: providerId,
      p_enabled: body.enabled,
    });
    if (error) return response({ error: error.message }, 400, origin);
    return response({ result: data }, 200, origin);
  }

  if (action === "set_provider_priority") {
    const providerId = typeof body.provider_id === "string" ? body.provider_id : "";
    const priority = Number(body.priority);
    if (!UUID.test(providerId) || !Number.isInteger(priority))
      return response({ error: "Informe um provedor e uma prioridade válidos." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_provider_priority", {
      p_actor_id: authData.user.id,
      p_provider_id: providerId,
      p_priority: priority,
    });
    if (error) return response({ error: error.message }, 400, origin);
    return response({ result: data }, 200, origin);
  }

  if (action === "set_tenant_providers") {
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    const providerIds = Array.isArray(body.provider_ids) ? body.provider_ids : null;
    if (
      !UUID.test(tenantId) ||
      !providerIds ||
      providerIds.some((id) => typeof id !== "string" || !UUID.test(id))
    )
      return response({ error: "A lista de provedores da Secretaria é inválida." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_tenant_providers", {
      p_actor_id: authData.user.id,
      p_tenant_id: tenantId,
      p_provider_ids: providerIds,
    });
    if (error) return response({ error: error.message }, 400, origin);
    return response({ result: data }, 200, origin);
  }

  if (action === "set_global_enabled") {
    if (typeof body.enabled !== "boolean")
      return response({ error: "Informe o estado de ativação global." }, 400, origin);
    const { data, error } = await adminClient.rpc("platform_ai_set_global_enabled", {
      p_actor_id: authData.user.id,
      p_enabled: body.enabled,
    });
    if (error) return response({ error: error.message }, 400, origin);
    return response({ result: data }, 200, origin);
  }

  if (action === "save_tenant") {
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (
      !UUID.test(tenantId) ||
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
