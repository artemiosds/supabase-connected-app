import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Save,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
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

type AiTenant = {
  id: string;
  name: string;
  status: string;
  commercial_status: string;
  operational: boolean;
  enabled: boolean;
  features: unknown;
  updated_at: string | null;
};
type AiConfiguration = {
  provider: string;
  model: string | null;
  enabled: boolean;
  status: string;
  has_credentials: boolean;
  last_test_at: string | null;
  updated_at: string | null;
} | null;
type LoadPayload = { configuration: AiConfiguration; tenants: AiTenant[] };

export function AdminMasterAi() {
  const [configuration, setConfiguration] = useState<AiConfiguration>(null);
  const [tenants, setTenants] = useState<AiTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [features, setFeatures] = useState<AiFeatureSettings>({ ...EMPTY_AI_FEATURES });
  const [tenantEnabled, setTenantEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [globalSaving, setGlobalSaving] = useState(false);
  const [tenantSaving, setTenantSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [tenants, selectedTenantId],
  );
  const selectedTenantOperational = selectedTenant?.operational === true;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await db.functions.invoke<LoadPayload>(
      "platform-ai-configuration",
      { body: { action: "get" } },
    );
    if (invokeError || !data) {
      setError(invokeError?.message ?? "Não foi possível carregar as configurações de IA.");
      setLoading(false);
      return;
    }
    setConfiguration(data.configuration);
    setTenants(data.tenants ?? []);
    setModel(data.configuration?.model ?? "");
    setSelectedTenantId((current) => current || data.tenants?.[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedTenant) {
      setTenantEnabled(false);
      setFeatures({ ...EMPTY_AI_FEATURES });
      return;
    }
    setTenantEnabled(selectedTenant.enabled);
    setFeatures(parseAiFeatureSettings(selectedTenant.features));
  }, [selectedTenant]);

  async function invokeAction<T>(action: string, values: Record<string, unknown> = {}) {
    const { data, error: invokeError } = await db.functions.invoke<T>("platform-ai-configuration", {
      body: { action, ...values },
    });
    if (invokeError)
      throw new Error(invokeError.message || "Falha na solicitação de configuração.");
    return data;
  }

  async function saveConfiguration() {
    setSaving(true);
    try {
      await invokeAction("save", { model: model.trim(), api_key: apiKey });
      setApiKey("");
      toast.success("Configuração salva no servidor. Teste a conexão antes de ativar.");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível salvar a configuração.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await invokeAction<{ connected: boolean; message: string }>("test");
      if (result?.connected) toast.success(result.message);
      else toast.error(result?.message ?? "A conexão não foi validada.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível testar a conexão.");
    } finally {
      setTesting(false);
    }
  }

  async function setGlobalEnabled(enabled: boolean) {
    setGlobalSaving(true);
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
      setGlobalSaving(false);
    }
  }

  async function saveTenantSettings() {
    if (!selectedTenant) return;
    setTenantSaving(true);
    try {
      await invokeAction("save_tenant", {
        tenant_id: selectedTenant.id,
        enabled: tenantEnabled,
        features,
      });
      toast.success(`Recursos de IA atualizados para ${selectedTenant.name}.`);
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar os recursos desta Secretaria.",
      );
    } finally {
      setTenantSaving(false);
    }
  }

  function updateFeature(key: AiFeatureKey, enabled: boolean) {
    setFeatures((current) => ({ ...current, [key]: enabled }));
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

  const statusLabel =
    configuration?.status === "connected"
      ? "Conexão validada"
      : configuration?.has_credentials
        ? "Credencial cadastrada; teste pendente"
        : "Pendente de credencial";
  const statusVariant = configuration?.status === "connected" ? "default" : "secondary";

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
          O Administrador Master controla o provedor central e habilita capacidades separadamente
          para cada Secretaria. A IA prepara análises e rascunhos para revisão humana.
        </p>
      </div>
      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>Chave protegida no servidor</AlertTitle>
        <AlertDescription>
          A credencial é armazenada no Supabase Vault e nunca retorna ao navegador. Dados
          selecionados para uma solicitação podem ser enviados ao provedor configurado; não envie
          informações sigilosas sem autorização institucional.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Provedor global
              </CardTitle>
              <CardDescription>
                Credencial e modelo são definidos pelo dono da plataforma.
              </CardDescription>
            </div>
            <Badge variant={statusVariant}>
              {configuration?.status === "connected" ? (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              ) : null}
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-model">Identificador do modelo</Label>
              <Input
                id="ai-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Informe o modelo habilitado na conta do provedor"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-api-key">Chave da API OpenAI</Label>
              <Input
                id="ai-api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  configuration?.has_credentials
                    ? "Credencial salva; deixe vazio para manter"
                    : "Pendente de credencial do órgão/plataforma"
                }
                maxLength={500}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A chave só é enviada à Edge Function autenticada quando você salva. Ela não é exibida
            novamente. Para trocar, informe a nova chave e salve.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void saveConfiguration()}
              disabled={saving || !model.trim() || (!configuration?.has_credentials && !apiKey)}
            >
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Salvando…" : "Salvar configuração"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void testConnection()}
              disabled={testing || !configuration?.has_credentials}
            >
              <Wifi className="mr-2 h-4 w-4" />
              {testing ? "Testando…" : "Testar conexão"}
            </Button>
            <Button variant="ghost" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Ativação global</p>
              <p className="text-sm text-muted-foreground">
                A IA só pode ser ligada após o teste real da credencial.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm">{configuration?.enabled ? "Ligada" : "Desligada"}</span>
              <Switch
                checked={configuration?.enabled ?? false}
                disabled={globalSaving || configuration?.status !== "connected"}
                onCheckedChange={(checked) => void setGlobalEnabled(checked)}
                aria-label="Ativar IA globalmente"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Recursos por Secretaria
          </CardTitle>
          <CardDescription>
            Selecione a organização e libere somente as funções autorizadas. Toda Secretaria começa
            desativada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {tenants.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Nenhuma Secretaria cadastrada</AlertTitle>
              <AlertDescription>
                Cadastre a organização antes de habilitar recursos de IA.
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
                        {tenant.status !== "active" ? ` — ${tenant.status}` : ""}
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
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
                    <div>
                      <p className="font-medium">Habilitar IA para {selectedTenant.name}</p>
                      <p className="text-sm text-muted-foreground">
                        A ativação global também precisa estar ligada.
                      </p>
                    </div>
                    <Switch
                      checked={tenantEnabled}
                      disabled={
                        !configuration?.enabled || !selectedTenantOperational || tenantSaving
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
                          disabled={!tenantEnabled || !selectedTenantOperational || tenantSaving}
                          onCheckedChange={(checked) => updateFeature(feature.key, checked)}
                          aria-label={`Habilitar ${feature.label}`}
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => void saveTenantSettings()}
                    disabled={
                      tenantSaving ||
                      !selectedTenant ||
                      (tenantEnabled && !selectedTenantOperational)
                    }
                  >
                    {tenantSaving ? (
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
      <Alert variant="default">
        <WifiOff className="h-4 w-4" />
        <AlertTitle>Capacidades iniciais e limites</AlertTitle>
        <AlertDescription>
          Esta etapa habilita consulta contextual e geração de rascunhos revisáveis. Aprovação,
          assinatura, publicação, envio de e-mail e gravação automática continuam exigindo ação
          humana. Leitura de arquivos privados/OCR e consulta automática ao PNCP precisam de
          integrações próprias antes de serem anunciadas como disponíveis.
        </AlertDescription>
      </Alert>
    </div>
  );
}
