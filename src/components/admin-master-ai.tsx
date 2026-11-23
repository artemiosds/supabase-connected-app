import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AI_FEATURES,
  EMPTY_AI_FEATURES,
  parseAiFeatureSettings,
  type AiFeatureKey,
  type AiFeatureSettings,
} from "@/lib/ai-capabilities";
import { db } from "@/lib/db";

type AiProviderKind =
  | "openai"
  | "gemini"
  | "anthropic"
  | "azure_openai"
  | "openai_compatible";

type AiProvider = {
  id: string;
  name: string;
  provider: AiProviderKind;
  model: string;
  api_base_url: string | null;
  api_version: string | null;
  status: string;
  is_enabled: boolean;
  is_primary: boolean;
  fallback_priority: number;
  input_cost_per_million: number | string | null;
  output_cost_per_million: number | string | null;
  last_test_at: string | null;
  last_test_error: string | null;
  last_test_http_status: number | null;
  last_test_error_code: string | null;
  last_test_error_type: string | null;
  last_test_retryable: boolean;
  last_test_retry_after: string | null;
  has_credentials: boolean;
};

type AiTenant = {
  id: string;
  name: string;
  status: string;
  commercial_status: string;
  operational: boolean;
  enabled: boolean;
  features: unknown;
  updated_at: string | null;
  allowed_provider_ids: string[];
};

type AiConfiguration = {
  provider: string | null;
  enabled: boolean;
  status: string;
  last_test_at: string | null;
  updated_at: string | null;
};

type AiUsageSummary = {
  tenant_id: string;
  tenant_name: string;
  provider_id: string;
  provider_name: string;
  model: string;
  requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  cost_available: boolean;
  cost_complete: boolean;
};

type LoadPayload = {
  configuration: AiConfiguration;
  providers: AiProvider[];
  tenants: AiTenant[];
  usage: AiUsageSummary[];
  usage_period_days: number;
};

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  azure_openai: "Azure OpenAI",
  openai_compatible: "API compatível com OpenAI",
};

const EMPTY_PROVIDER_FORM = {
  provider: "openai" as AiProviderKind,
  name: "OpenAI",
  model: "",
  api_key: "",
  api_base_url: "",
  api_version: "2024-10-21",
  input_cost_per_million: "",
  output_cost_per_million: "",
  fallback_priority: "100",
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 8,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Ainda não testado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function providerStatus(provider: AiProvider) {
  if (provider.last_test_retryable) {
    return provider.is_enabled
      ? "Falha temporária; provedor preservado"
      : "Falha temporária; novo teste pendente";
  }
  if (provider.status === "connected" && provider.is_enabled) return "Conectado e disponível";
  if (provider.status === "connected") return "Conectado, desativado";
  if (provider.status === "failed") return "Falha no teste";
  return "Credencial salva; teste pendente";
}

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload: unknown = await context.clone().json();
        if (
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string" &&
          payload.error.trim()
        ) {
          return payload.error;
        }
      } catch {
        // Preserve the fallback when the response is not JSON.
      }
    }
  }

  if (
    error instanceof Error &&
    error.message &&
    error.message !== "Edge Function returned a non-2xx status code"
  ) {
    return error.message;
  }
  return fallback;
}

export function AdminMasterAi() {
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [tenants, setTenants] = useState<AiTenant[]>([]);
  const [usage, setUsage] = useState<AiUsageSummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [features, setFeatures] = useState<AiFeatureSettings>({ ...EMPTY_AI_FEATURES });
  const [tenantEnabled, setTenantEnabled] = useState(false);
  const [allowedProviderIds, setAllowedProviderIds] = useState<string[]>([]);
  const [providerForm, setProviderForm] = useState({ ...EMPTY_PROVIDER_FORM });
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [changingProviderId, setChangingProviderId] = useState<string | null>(null);
  const [providerPendingDeletion, setProviderPendingDeletion] = useState<AiProvider | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingTenantProviders, setSavingTenantProviders] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [tenants, selectedTenantId],
  );
  const selectedTenantOperational = selectedTenant?.operational === true;
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await db.functions.invoke<LoadPayload>(
        "platform-ai-configuration",
        { body: { action: "get" } },
      );
      if (invokeError) {
        setError(
          await getFunctionErrorMessage(
            invokeError,
            "Não foi possível carregar as configurações de IA.",
          ),
        );
        return;
      }
      if (!data) {
        setError("O serviço de configuração de IA retornou uma resposta vazia.");
        return;
      }
      setConfiguration(data.configuration);
      setProviders(data.providers ?? []);
      setTenants(data.tenants ?? []);
      setUsage(data.usage ?? []);
      setPriorityDrafts(
        Object.fromEntries(
          (data.providers ?? []).map((provider) => [
            provider.id,
            String(provider.fallback_priority),
          ]),
        ),
      );
      setSelectedTenantId((current) => current || data.tenants?.[0]?.id || "");
    } catch (cause) {
      setError(
        await getFunctionErrorMessage(
          cause,
          "Não foi possível carregar as configurações de IA.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedTenant) {
      setTenantEnabled(false);
      setFeatures({ ...EMPTY_AI_FEATURES });
      setAllowedProviderIds([]);
      return;
    }
    setTenantEnabled(selectedTenant.enabled);
    setFeatures(parseAiFeatureSettings(selectedTenant.features));
    setAllowedProviderIds(selectedTenant.allowed_provider_ids ?? []);
  }, [selectedTenant]);

  async function invokeAction<T>(action: string, values: Record<string, unknown> = {}) {
    const { data, error: invokeError } = await db.functions.invoke<T>(
      "platform-ai-configuration",
      { body: { action, ...values } },
    );
    if (invokeError) {
      throw new Error(
        await getFunctionErrorMessage(invokeError, "Falha na solicitação de configuração."),
      );
    }
    return data;
  }

  function resetProviderForm() {
    setEditingProviderId(null);
    setProviderForm({ ...EMPTY_PROVIDER_FORM });
  }

  function editProvider(provider: AiProvider) {
    setEditingProviderId(provider.id);
    setProviderForm({
      provider: provider.provider,
      name: provider.name,
      model: provider.model,
      api_key: "",
      api_base_url: provider.api_base_url ?? "",
      api_version: provider.api_version ?? "2024-10-21",
      input_cost_per_million:
        provider.input_cost_per_million === null
          ? ""
          : String(provider.input_cost_per_million),
      output_cost_per_million:
        provider.output_cost_per_million === null
          ? ""
          : String(provider.output_cost_per_million),
      fallback_priority: String(provider.fallback_priority),
    });
  }

  async function saveProvider() {
    setSavingProvider(true);
    try {
      await invokeAction("save_provider", {
        provider_id: editingProviderId,
        provider: providerForm.provider,
        name: providerForm.name.trim(),
        model: providerForm.model.trim(),
        api_key: providerForm.api_key,
        api_base_url: providerForm.api_base_url.trim(),
        api_version: providerForm.api_version.trim(),
        input_cost_per_million:
          providerForm.input_cost_per_million === ""
            ? null
            : Number(providerForm.input_cost_per_million),
        output_cost_per_million:
          providerForm.output_cost_per_million === ""
            ? null
            : Number(providerForm.output_cost_per_million),
        fallback_priority: Number(providerForm.fallback_priority),
      });
      toast.success(
        editingProviderId
          ? "Provedor atualizado. Teste novamente se houve alteração de credencial, modelo ou endpoint."
          : "Provedor cadastrado no servidor. Teste a conexão para habilitá-lo.",
      );
      resetProviderForm();
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o provedor.");
    } finally {
      setSavingProvider(false);
    }
  }

  async function testProvider(provider: AiProvider) {
    setTestingProviderId(provider.id);
    try {
      const result = await invokeAction<{
        connected: boolean;
        message: string;
        retryable?: boolean;
        provider_preserved?: boolean;
      }>("test_provider", {
        provider_id: provider.id,
      });
      if (result?.connected) toast.success(result.message);
      else toast.error(result?.message ?? "A conexão não foi validada.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível testar o provedor.");
    } finally {
      setTestingProviderId(null);
    }
  }

  async function setPrimaryProvider(provider: AiProvider) {
    setChangingProviderId(provider.id);
    try {
      await invokeAction("set_primary_provider", { provider_id: provider.id });
      toast.success(provider.name + " definido como provedor principal.");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Não foi possível definir o provedor principal.",
      );
    } finally {
      setChangingProviderId(null);
    }
  }

  async function setProviderEnabled(provider: AiProvider, enabled: boolean) {
    setChangingProviderId(provider.id);
    try {
      await invokeAction("set_provider_enabled", { provider_id: provider.id, enabled });
      toast.success(enabled ? "Provedor habilitado como alternativa." : "Provedor desabilitado.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível alterar o provedor.");
    } finally {
      setChangingProviderId(null);
    }
  }

  async function saveProviderPriority(provider: AiProvider) {
    setChangingProviderId(provider.id);
    try {
      await invokeAction("set_provider_priority", {
        provider_id: provider.id,
        priority: Number(priorityDrafts[provider.id]),
      });
      toast.success("Prioridade de contingência atualizada.");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível alterar a prioridade.",
      );
    } finally {
      setChangingProviderId(null);
    }
  }

  async function deleteProvider(provider: AiProvider) {
    setDeletingProviderId(provider.id);
    try {
      const result = await invokeAction<{
        result?: {
          primary_replaced?: boolean;
          global_disabled?: boolean;
          usage_records_preserved?: number;
        };
      }>("delete_provider", { provider_id: provider.id });

      if (editingProviderId === provider.id) resetProviderForm();
      setProviderPendingDeletion(null);

      if (result?.result?.global_disabled) {
        toast.success(
          provider.name +
            " excluído. Como não havia outra alternativa conectada, a IA global foi desligada.",
        );
      } else if (result?.result?.primary_replaced) {
        toast.success(
          provider.name + " excluído. Outra IA conectada foi promovida automaticamente.",
        );
      } else {
        toast.success(provider.name + " excluído. O histórico de consumo foi preservado.");
      }
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível excluir o provedor.");
    } finally {
      setDeletingProviderId(null);
    }
  }

  async function setGlobalEnabled(enabled: boolean) {
    setSavingGlobal(true);
    try {
      await invokeAction("set_global_enabled", { enabled });
      toast.success(
        enabled ? "IA global ativada." : "IA global desativada para todas as Secretarias.",
      );
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível alterar a ativação global.",
      );
    } finally {
      setSavingGlobal(false);
    }
  }

  async function saveTenantProviders() {
    if (!selectedTenant) return;
    setSavingTenantProviders(true);
    try {
      await invokeAction("set_tenant_providers", {
        tenant_id: selectedTenant.id,
        provider_ids: allowedProviderIds,
      });
      toast.success("Provedores autorizados atualizados para " + selectedTenant.name + ".");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar os provedores da Secretaria.",
      );
    } finally {
      setSavingTenantProviders(false);
    }
  }

  async function saveTenantSettings() {
    if (!selectedTenant) return;
    setSavingTenant(true);
    try {
      await invokeAction("save_tenant", {
        tenant_id: selectedTenant.id,
        enabled: tenantEnabled,
        features,
      });
      toast.success("Recursos de IA atualizados para " + selectedTenant.name + ".");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar os recursos desta Secretaria.",
      );
    } finally {
      setSavingTenant(false);
    }
  }

  function updateFeature(key: AiFeatureKey, enabled: boolean) {
    setFeatures((current) => ({ ...current, [key]: enabled }));
  }

  function toggleTenantProvider(providerId: string, enabled: boolean) {
    setAllowedProviderIds((current) =>
      enabled
        ? [...new Set([...current, providerId])]
        : current.filter((id) => id !== providerId),
    );
  }

  if (loading)
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Carregando configurações"
        />
      </div>
    );

  const primaryProvider = providers.find((provider) => provider.is_primary) ?? null;

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Configuração indisponível</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Inteligência Artificial</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Gerencie vários provedores, defina a IA principal e alternativas e controle o acesso por
          Secretaria. As respostas são preparadas para revisão humana.
        </p>
      </div>

      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>Credenciais protegidas no servidor</AlertTitle>
        <AlertDescription>
          As chaves ficam no Supabase Vault e nunca retornam ao navegador. As solicitações enviam
          somente o contexto necessário ao provedor escolhido. Antes de liberar dados institucionais,
          valide contrato, privacidade e retenção de cada serviço externo.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Cadastro de provedores e APIs
          </CardTitle>
          <CardDescription>
            Cadastre quantas integrações forem necessárias. Alterações em chave, modelo ou endpoint
            exigem novo teste antes que o provedor volte a ficar disponível.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-provider-type">Tipo de provedor</Label>
              <Select
                value={providerForm.provider}
                onValueChange={(value) =>
                  setProviderForm((current) => ({
                    ...current,
                    provider: value as AiProviderKind,
                    name:
                      current.name === "OpenAI" || current.name === ""
                        ? PROVIDER_LABELS[value as AiProviderKind]
                        : current.name,
                    api_base_url:
                      value === "azure_openai" || value === "openai_compatible"
                        ? current.api_base_url
                        : "",
                  }))
                }
              >
                <SelectTrigger id="ai-provider-type">
                  <SelectValue placeholder="Selecione o provedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="anthropic">Anthropic Claude</SelectItem>
                  <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                  <SelectItem value="openai_compatible">API compatível com OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-provider-name">Nome de identificação</Label>
              <Input
                id="ai-provider-name"
                value={providerForm.name}
                onChange={(event) =>
                  setProviderForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Ex.: OpenAI institucional"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-provider-model">Identificador do modelo ou deployment</Label>
              <Input
                id="ai-provider-model"
                value={providerForm.model}
                onChange={(event) =>
                  setProviderForm((current) => ({ ...current, model: event.target.value }))
                }
                placeholder="Ex.: gpt-4.1, gemini-2.5-flash, claude-sonnet-4-5"
                maxLength={150}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-provider-key">Chave da API</Label>
              <Input
                id="ai-provider-key"
                type="password"
                autoComplete="new-password"
                value={providerForm.api_key}
                onChange={(event) =>
                  setProviderForm((current) => ({ ...current, api_key: event.target.value }))
                }
                placeholder={
                  editingProviderId
                    ? "Credencial protegida; vazio mantém a chave atual"
                    : "Cole a chave fornecida pelo provedor"
                }
                maxLength={1000}
              />
            </div>

            {(providerForm.provider === "azure_openai" ||
              providerForm.provider === "openai_compatible") && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="ai-provider-url">
                  {providerForm.provider === "azure_openai"
                    ? "Endpoint do recurso Azure OpenAI"
                    : "URL base da API compatível"}
                </Label>
                <Input
                  id="ai-provider-url"
                  value={providerForm.api_base_url}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      api_base_url: event.target.value,
                    }))
                  }
                  placeholder={
                    providerForm.provider === "azure_openai"
                      ? "https://seu-recurso.openai.azure.com"
                      : "https://api.seu-provedor.com/v1"
                  }
                  maxLength={500}
                />
              </div>
            )}

            {providerForm.provider === "azure_openai" && (
              <div className="space-y-2">
                <Label htmlFor="ai-provider-version">Versão da API Azure</Label>
                <Input
                  id="ai-provider-version"
                  value={providerForm.api_version}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      api_version: event.target.value,
                    }))
                  }
                  placeholder="2024-10-21"
                  maxLength={30}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ai-provider-priority">Prioridade de contingência</Label>
              <Input
                id="ai-provider-priority"
                type="number"
                min={1}
                max={9999}
                value={providerForm.fallback_priority}
                onChange={(event) =>
                  setProviderForm((current) => ({
                    ...current,
                    fallback_priority: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Menor número é tentado primeiro quando a IA principal falha.
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <p className="mb-3 font-medium">
              Tarifas para estimativa de custos (USD por 1 milhão de tokens)
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-provider-input-cost">Tokens de entrada</Label>
                <Input
                  id="ai-provider-input-cost"
                  type="number"
                  min={0}
                  step="0.000001"
                  value={providerForm.input_cost_per_million}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      input_cost_per_million: event.target.value,
                    }))
                  }
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-provider-output-cost">Tokens de saída</Label>
                <Input
                  id="ai-provider-output-cost"
                  type="number"
                  min={0}
                  step="0.000001"
                  value={providerForm.output_cost_per_million}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      output_cost_per_million: event.target.value,
                    }))
                  }
                  placeholder="Opcional"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Os valores são informados pelo Administrador Master e não são atualizados
              automaticamente. O custo exibido é uma estimativa baseada nos tokens retornados pela API.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void saveProvider()}
              disabled={
                savingProvider ||
                !providerForm.name.trim() ||
                !providerForm.model.trim() ||
                (!editingProviderId && !providerForm.api_key)
              }
            >
              {savingProvider ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : editingProviderId ? (
                <Save className="mr-2 h-4 w-4" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {savingProvider
                ? "Salvando…"
                : editingProviderId
                  ? "Salvar alterações"
                  : "Cadastrar provedor"}
            </Button>
            {editingProviderId && (
              <Button variant="outline" onClick={resetProviderForm}>
                Cancelar edição
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provedores cadastrados</CardTitle>
          <CardDescription>
            Defina o provedor principal. Os demais provedores habilitados funcionam como alternativas
            na ordem de prioridade configurada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {providers.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Nenhum provedor cadastrado</AlertTitle>
              <AlertDescription>
                Cadastre uma integração e teste sua conexão antes de definir a IA principal.
              </AlertDescription>
            </Alert>
          ) : (
            providers.map((provider) => (
              <div key={provider.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{provider.name}</p>
                      {provider.is_primary && <Badge>IA principal</Badge>}
                      <Badge
                        variant={
                          provider.status === "failed"
                            ? "destructive"
                            : provider.status === "connected"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {providerStatus(provider)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {PROVIDER_LABELS[provider.provider]} · {provider.model}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Último teste: {formatDate(provider.last_test_at)}
                      {" · "}
                      Prioridade alternativa: {provider.fallback_priority}
                    </p>
                    {provider.api_base_url && (
                      <p className="break-all text-xs text-muted-foreground">
                        Endpoint: {provider.api_base_url}
                      </p>
                    )}
                    {provider.last_test_error && (
                      <div
                        className={
                          provider.last_test_retryable
                            ? "max-w-2xl rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
                            : "max-w-2xl rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs"
                        }
                      >
                        <p className="font-medium">
                          {provider.last_test_retryable
                            ? "Falha temporária — o provedor foi preservado"
                            : "Detalhe da última falha"}
                          {provider.last_test_http_status
                            ? " · HTTP " + provider.last_test_http_status
                            : ""}
                        </p>
                        <p className="mt-1 break-words text-muted-foreground">
                          {provider.last_test_error}
                        </p>
                        {provider.last_test_retry_after && (
                          <p className="mt-1 text-muted-foreground">
                            Retry-After: {provider.last_test_retry_after}
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Entrada:{" "}
                      {provider.input_cost_per_million === null
                        ? "não informada"
                        : formatUsd(Number(provider.input_cost_per_million)) + "/1M"}
                      {" · "}
                      Saída:{" "}
                      {provider.output_cost_per_million === null
                        ? "não informada"
                        : formatUsd(Number(provider.output_cost_per_million)) + "/1M"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void testProvider(provider)}
                      disabled={testingProviderId === provider.id}
                    >
                      {testingProviderId === provider.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Wifi className="mr-2 h-4 w-4" />
                      )}
                      Testar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => editProvider(provider)}
                      disabled={Boolean(deletingProviderId)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setProviderPendingDeletion(provider)}
                      disabled={
                        Boolean(deletingProviderId) ||
                        testingProviderId === provider.id ||
                        changingProviderId === provider.id
                      }
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir
                    </Button>
                    {!provider.is_primary &&
                      provider.status === "connected" &&
                      provider.is_enabled && (
                      <Button
                        size="sm"
                        onClick={() => void setPrimaryProvider(provider)}
                        disabled={changingProviderId === provider.id}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Tornar principal
                      </Button>
                    )}
                    {!provider.is_primary && provider.status === "connected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setProviderEnabled(provider, !provider.is_enabled)}
                        disabled={changingProviderId === provider.id}
                      >
                        {provider.is_enabled ? "Desabilitar" : "Habilitar alternativa"}
                      </Button>
                    )}
                  </div>
                </div>
                {!provider.is_primary && provider.is_enabled && (
                  <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
                    <div className="w-36 space-y-1">
                      <Label htmlFor={"priority-" + provider.id}>Ordem de contingência</Label>
                      <Input
                        id={"priority-" + provider.id}
                        type="number"
                        min={1}
                        max={9999}
                        value={priorityDrafts[provider.id] ?? String(provider.fallback_priority)}
                        onChange={(event) =>
                          setPriorityDrafts((current) => ({
                            ...current,
                            [provider.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void saveProviderPriority(provider)}
                      disabled={changingProviderId === provider.id}
                    >
                      Salvar prioridade
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={providerPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open && deletingProviderId === null) setProviderPendingDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir provedor de IA?</AlertDialogTitle>
            <AlertDialogDescription>
              {providerPendingDeletion && (
                <>
                  Você está prestes a excluir{" "}
                  <strong>{providerPendingDeletion.name}</strong> (
                  {providerPendingDeletion.model}).
                </>
              )}
              {" "}A credencial correspondente também será removida do Supabase Vault. Os registros
              históricos de consumo serão preservados, mas deixarão de estar vinculados a este
              cadastro.
              {providerPendingDeletion?.is_primary
                ? " Este é o provedor principal: uma alternativa conectada será promovida automaticamente. Se não houver alternativa, a IA global e as Secretarias que dependem dela serão desligadas."
                : " Se alguma Secretaria depender exclusivamente deste provedor, a IA dessa Secretaria será desligada."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProviderId === providerPendingDeletion?.id}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!providerPendingDeletion || deletingProviderId !== null}
              onClick={(event) => {
                event.preventDefault();
                if (providerPendingDeletion) void deleteProvider(providerPendingDeletion);
              }}
            >
              {deletingProviderId === providerPendingDeletion?.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {deletingProviderId === providerPendingDeletion?.id
                ? "Excluindo…"
                : "Confirmar exclusão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Ativação global
          </CardTitle>
          <CardDescription>
            A ativação global só é permitida com um provedor principal testado e disponível.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">
              {configuration?.enabled ? "IA global ligada" : "IA global desligada"}
            </p>
            <p className="text-sm text-muted-foreground">
              Principal atual: {primaryProvider?.name ?? "Nenhum provedor principal"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={configuration?.enabled ? "default" : "secondary"}>
              {configuration?.enabled ? "Ativa" : "Inativa"}
            </Badge>
            <Switch
              checked={configuration?.enabled ?? false}
              disabled={savingGlobal || !primaryProvider}
              onCheckedChange={(checked) => void setGlobalEnabled(checked)}
              aria-label="Ativar IA globalmente"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permissões e recursos por Secretaria</CardTitle>
          <CardDescription>
            Autorize provedores específicos para cada Secretaria. A Secretaria só usa provedores
            marcados abaixo e a ordem de contingência global é respeitada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {tenants.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Nenhuma Secretaria cadastrada</AlertTitle>
              <AlertDescription>
                Cadastre uma organização antes de liberar provedores e recursos de IA.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="ai-tenant">Secretaria</Label>
                <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
                  <SelectTrigger id="ai-tenant">
                    <SelectValue placeholder="Selecione uma Secretaria" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                        {tenant.status !== "active" ? " — " + tenant.status : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTenant && (
                <>
                  {!selectedTenantOperational && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Secretaria fora do estado operacional</AlertTitle>
                      <AlertDescription>
                        Somente organizações ativas ou em período de demonstração válido podem usar
                        a IA.
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-3 rounded-lg border p-4">
                    <div>
                      <p className="font-medium">Provedores autorizados</p>
                      <p className="text-sm text-muted-foreground">
                        Marque pelo menos um provedor conectado para permitir o uso nesta Secretaria.
                      </p>
                    </div>
                    {providers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Cadastre um provedor primeiro.
                      </p>
                    ) : (
                      providers.map((provider) => {
                        const available =
                          provider.status === "connected" && provider.is_enabled;
                        return (
                          <div
                            key={provider.id}
                            className="flex items-center justify-between gap-3 border-t pt-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium">{provider.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {PROVIDER_LABELS[provider.provider]} · {provider.model}
                                {provider.is_primary ? " · principal global" : ""}
                              </p>
                            </div>
                            <Switch
                              checked={allowedProviderIds.includes(provider.id)}
                              disabled={
                                !available || !selectedTenantOperational || savingTenantProviders
                              }
                              onCheckedChange={(checked) =>
                                toggleTenantProvider(provider.id, checked)
                              }
                              aria-label={
                                "Autorizar " + provider.name + " para " + selectedTenant.name
                              }
                            />
                          </div>
                        );
                      })
                    )}
                    <Button
                      onClick={() => void saveTenantProviders()}
                      disabled={
                        savingTenantProviders ||
                        !selectedTenant ||
                        (!allowedProviderIds.length && selectedTenant.enabled)
                      }
                    >
                      {savingTenantProviders ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Salvar provedores autorizados
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
                    <div>
                      <p className="font-medium">Habilitar IA para {selectedTenant.name}</p>
                      <p className="text-sm text-muted-foreground">
                        A ativação global e ao menos um provedor autorizado também são necessários.
                      </p>
                    </div>
                    <Switch
                      checked={tenantEnabled}
                      disabled={
                        !configuration?.enabled ||
                        !selectedTenantOperational ||
                        allowedProviderIds.length === 0 ||
                        savingTenant
                      }
                      onCheckedChange={setTenantEnabled}
                      aria-label="Habilitar IA para a Secretaria selecionada"
                    />
                  </div>
                  <div className="divide-y rounded-lg border">
                    {AI_FEATURES.map((feature) => (
                      <div
                        key={feature.key}
                        className="flex items-center justify-between gap-4 p-4"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{feature.label}</p>
                          <p className="text-sm text-muted-foreground">{feature.description}</p>
                        </div>
                        <Switch
                          checked={features[feature.key]}
                          disabled={!tenantEnabled || !selectedTenantOperational || savingTenant}
                          onCheckedChange={(checked) => updateFeature(feature.key, checked)}
                          aria-label={"Habilitar " + feature.label}
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => void saveTenantSettings()}
                    disabled={
                      savingTenant ||
                      !selectedTenant ||
                      (tenantEnabled &&
                        (!selectedTenantOperational || allowedProviderIds.length === 0))
                    }
                  >
                    {savingTenant ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar recursos da Secretaria
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Consumo e custos por Secretaria
          </CardTitle>
          <CardDescription>
            Últimos 30 dias. Custos são estimativas em USD calculadas com as tarifas cadastradas para
            cada provedor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há consumo registrado no período.
            </p>
          ) : (
            <div className="space-y-2">
              {usage.map((item) => (
                <div
                  key={item.tenant_id + ":" + item.provider_id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.tenant_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.provider_name} · {item.model}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.requests} tentativas · {item.failed_requests} falhas ·{" "}
                      {(item.input_tokens + item.output_tokens).toLocaleString("pt-BR")} tokens
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-semibold tabular-nums">
                      {!item.cost_available
                        ? "Sem tarifa cadastrada"
                        : item.cost_complete
                          ? formatUsd(Number(item.estimated_cost_usd))
                          : "Custo parcial: " + formatUsd(Number(item.estimated_cost_usd))}
                    </p>
                    {!item.cost_complete && (
                      <p className="text-xs text-muted-foreground">
                        Tarifas ou tokens não informados em todas as chamadas
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <WifiOff className="h-4 w-4" />
        <AlertTitle>Limites e segurança operacional</AlertTitle>
        <AlertDescription>
          O sistema tenta o provedor principal e, em caso de falha, os provedores alternativos
          autorizados para a Secretaria. O custo depende das tarifas informadas pelo Administrador
          Master. Aprovações, assinaturas, publicações, gravações e envios continuam exigindo ação
          humana.
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar dados
        </Button>
      </div>
    </div>
  );
}
