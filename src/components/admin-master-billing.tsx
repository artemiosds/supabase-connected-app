import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Save,
  ShieldCheck,
  Unplug,
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
import { supabase } from "@/integrations/supabase/client";

type Provider = "mercado_pago" | "stripe" | "other";
type Environment = "sandbox" | "production";
type ProviderChoice = Provider | "";

type BillingConfiguration = {
  provider: Provider;
  provider_other_name: string | null;
  environment: Environment;
  account_name: string;
  account_reference: string | null;
  account_email: string | null;
  client_id: string | null;
  public_key: string | null;
  status: "credentials_saved" | "disabled";
  payments_enabled: false;
  has_credentials: boolean;
  updated_at: string;
};

type BillingForm = {
  provider: ProviderChoice;
  provider_other_name: string;
  environment: Environment;
  account_name: string;
  account_reference: string;
  account_email: string;
  client_id: string;
  public_key: string;
  access_token: string;
  secret_key: string;
  client_secret: string;
  webhook_secret: string;
};

const EMPTY_FORM: BillingForm = {
  provider: "",
  provider_other_name: "",
  environment: "sandbox",
  account_name: "",
  account_reference: "",
  account_email: "",
  client_id: "",
  public_key: "",
  access_token: "",
  secret_key: "",
  client_secret: "",
  webhook_secret: "",
};

function providerLabel(provider: Provider, otherName?: string | null): string {
  if (provider === "mercado_pago") return "Mercado Pago";
  if (provider === "stripe") return "Stripe";
  return otherName?.trim() || "Outro provedor";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function MasterBillingSettings() {
  const [configuration, setConfiguration] = useState<BillingConfiguration | null>(null);
  const [form, setForm] = useState<BillingForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasPrivateCredential = useMemo(
    () =>
      Boolean(
        form.access_token.trim() ||
          form.secret_key.trim() ||
          form.client_secret.trim() ||
          form.webhook_secret.trim(),
      ),
    [form],
  );

  const setField = <K extends keyof BillingForm>(field: K, value: BillingForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.functions.invoke("platform-billing-config", {
      body: { action: "get" },
    });

    if (error) {
      setLoadError(
        "Não foi possível consultar a configuração. Confirme a sessão do Administrador Master e tente novamente.",
      );
      setLoading(false);
      return;
    }

    const saved = (data?.configuration ?? null) as BillingConfiguration | null;
    setConfiguration(saved);
    if (saved) {
      setForm((current) => ({
        ...current,
        provider: saved.provider,
        provider_other_name: saved.provider_other_name ?? "",
        environment: saved.environment,
        account_name: saved.account_name,
        account_reference: saved.account_reference ?? "",
        account_email: saved.account_email ?? "",
        client_id: saved.client_id ?? "",
        public_key: saved.public_key ?? "",
        access_token: "",
        secret_key: "",
        client_secret: "",
        webhook_secret: "",
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  const saveConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.provider) {
      toast.error("Escolha o provedor quando decidir qual conta será vinculada.");
      return;
    }
    if (!form.account_name.trim()) {
      toast.error("Informe o nome da conta de cobrança.");
      return;
    }
    if (form.provider === "other" && !form.provider_other_name.trim()) {
      toast.error("Informe o nome do provedor.");
      return;
    }
    if (!configuration?.has_credentials && !hasPrivateCredential) {
      toast.error("Informe o token ou a chave privada antes de salvar.");
      return;
    }
    if (
      configuration?.has_credentials &&
      (configuration.provider !== form.provider ||
        configuration.environment !== form.environment) &&
      !hasPrivateCredential
    ) {
      toast.error("Informe novamente a credencial privada ao trocar de provedor ou ambiente.");
      return;
    }

    const credentials = {
      ...(form.access_token.trim() ? { access_token: form.access_token.trim() } : {}),
      ...(form.secret_key.trim() ? { secret_key: form.secret_key.trim() } : {}),
      ...(form.client_secret.trim() ? { client_secret: form.client_secret.trim() } : {}),
      ...(form.webhook_secret.trim() ? { webhook_secret: form.webhook_secret.trim() } : {}),
    };

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("platform-billing-config", {
      body: {
        action: "save",
        provider: form.provider,
        provider_other_name: form.provider === "other" ? form.provider_other_name.trim() : null,
        environment: form.environment,
        account_name: form.account_name.trim(),
        account_reference: form.account_reference.trim() || null,
        account_email: form.account_email.trim() || null,
        client_id: form.client_id.trim() || null,
        public_key: form.public_key.trim() || null,
        credentials: Object.keys(credentials).length ? credentials : undefined,
      },
    });

    setSaving(false);
    if (error || !data?.saved) {
      const message =
        typeof data?.error === "string"
          ? data.error
          : "Não foi possível salvar as credenciais. Confira os campos e tente novamente.";
      toast.error(message);
      return;
    }

    toast.success("Conta de cobrança cadastrada com segurança.");
    setForm((current) => ({
      ...current,
      access_token: "",
      secret_key: "",
      client_secret: "",
      webhook_secret: "",
    }));
    await loadConfiguration();
  };

  const disconnect = async () => {
    setDisconnecting(true);
    const { data, error } = await supabase.functions.invoke("platform-billing-config", {
      body: { action: "disconnect" },
    });
    setDisconnecting(false);

    if (error || !data?.result?.disconnected) {
      toast.error("Não foi possível desconectar a conta de cobrança.");
      return;
    }

    setConfirmDisconnect(false);
    toast.success("Credenciais privadas removidas do cofre.");
    setConfiguration((data.configuration ?? null) as BillingConfiguration | null);
    setForm(EMPTY_FORM);
  };

  const credentialLabels =
    form.provider === "mercado_pago"
      ? {
          access_token: "Access Token privado",
          secret_key: "Chave secreta adicional (opcional)",
          client_secret: "Client Secret (opcional)",
          webhook_secret: "Segredo de assinatura do webhook (opcional)",
        }
      : form.provider === "stripe"
        ? {
            access_token: "Token de acesso (opcional)",
            secret_key: "Secret Key privada",
            client_secret: "Client Secret (opcional)",
            webhook_secret: "Webhook signing secret (opcional)",
          }
        : {
            access_token: "Token de acesso privado",
            secret_key: "Chave secreta privada",
            client_secret: "Client Secret (opcional)",
            webhook_secret: "Segredo de webhook (opcional)",
          };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Conta de recebimento da plataforma</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Cadastre a conta que futuramente receberá as mensalidades das Secretarias. O provedor
            permanece à sua escolha e pode ser vinculado aqui pelo Painel Master.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadConfiguration()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>Cobranças desativadas nesta etapa</AlertTitle>
        <AlertDescription>
          Este cadastro guarda as credenciais com criptografia no Supabase Vault. Ele ainda não
          cria cobranças, assinaturas, links de pagamento ou webhooks. A ativação ficará para uma
          etapa própria, depois da escolha e homologação do provedor.
        </AlertDescription>
      </Alert>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Configuração indisponível</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {configuration && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4" />
                  Conta cadastrada
                </CardTitle>
                <CardDescription className="mt-1">
                  {providerLabel(configuration.provider, configuration.provider_other_name)} ·{" "}
                  {configuration.environment === "sandbox" ? "Ambiente de teste" : "Produção"}
                </CardDescription>
              </div>
              <Badge variant={configuration.has_credentials ? "secondary" : "outline"}>
                {configuration.has_credentials ? "Credenciais guardadas" : "Desconectada"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Conta</p>
              <p className="font-medium">{configuration.account_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Identificador</p>
              <p className="font-medium">{configuration.account_reference || "Não informado"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">E-mail</p>
              <p className="font-medium">{configuration.account_email || "Não informado"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Última atualização</p>
              <p className="font-medium">{formatDate(configuration.updated_at)}</p>
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Nenhuma chave privada é exibida novamente depois de salva.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {configuration ? "Editar ou substituir credenciais" : "Cadastrar conta"}
          </CardTitle>
          <CardDescription>
            Você poderá retornar a esta tela para trocar o provedor ou atualizar os tokens sem
            precisar enviá-los pelo chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração...
            </div>
          ) : (
            <form onSubmit={saveConfiguration} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Provedor de pagamento</Label>
                  <Select value={form.provider} onValueChange={(value) => setField("provider", value as Provider)}>
                    <SelectTrigger><SelectValue placeholder="Selecione quando decidir" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mercado_pago">Mercado Pago</SelectItem>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="other">Outro provedor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ambiente</Label>
                  <Select value={form.environment} onValueChange={(value) => setField("environment", value as Environment)}>
                    <SelectTrigger><SelectValue placeholder="Selecione o ambiente" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sandbox">Teste / Sandbox</SelectItem>
                      <SelectItem value="production">Produção</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.provider === "other" && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="billing-provider-other">Nome do provedor</Label>
                    <Input id="billing-provider-other" value={form.provider_other_name} maxLength={100}
                      onChange={(event) => setField("provider_other_name", event.target.value)} required />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="billing-account-name">Nome da conta / titular</Label>
                  <Input id="billing-account-name" value={form.account_name} maxLength={160}
                    onChange={(event) => setField("account_name", event.target.value)}
                    placeholder="Nome cadastrado no provedor" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing-account-reference">ID da conta / Merchant ID</Label>
                  <Input id="billing-account-reference" value={form.account_reference} maxLength={160}
                    onChange={(event) => setField("account_reference", event.target.value)}
                    placeholder="Identificador da conta no gateway" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing-account-email">E-mail da conta</Label>
                  <Input id="billing-account-email" type="email" value={form.account_email}
                    onChange={(event) => setField("account_email", event.target.value)}
                    placeholder="financeiro@empresa.com.br" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing-client-id">Client ID (quando aplicável)</Label>
                  <Input id="billing-client-id" value={form.client_id} maxLength={512}
                    onChange={(event) => setField("client_id", event.target.value)}
                    autoComplete="off" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="billing-public-key">
                    {form.provider === "stripe" ? "Publishable Key" : "Public Key"}
                  </Label>
                  <Input id="billing-public-key" value={form.public_key} maxLength={1024}
                    onChange={(event) => setField("public_key", event.target.value)}
                    autoComplete="off" />
                  <p className="text-xs text-muted-foreground">
                    Campo público do provedor. Nunca coloque aqui tokens privados ou chaves secretas.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start gap-2">
                  <LockKeyhole className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">Credenciais privadas</h3>
                    <p className="text-xs text-muted-foreground">
                      {configuration?.has_credentials
                        ? "Já existem credenciais no cofre. Deixe os campos vazios para manter as atuais; preencha somente o que deseja substituir."
                        : "Preencha o token ou a chave privada disponibilizada pelo seu provedor."}
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="billing-access-token">{credentialLabels.access_token}</Label>
                    <Input id="billing-access-token" type="password" value={form.access_token}
                      onChange={(event) => setField("access_token", event.target.value)}
                      autoComplete="new-password" spellCheck={false} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-secret-key">{credentialLabels.secret_key}</Label>
                    <Input id="billing-secret-key" type="password" value={form.secret_key}
                      onChange={(event) => setField("secret_key", event.target.value)}
                      autoComplete="new-password" spellCheck={false} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-client-secret">{credentialLabels.client_secret}</Label>
                    <Input id="billing-client-secret" type="password" value={form.client_secret}
                      onChange={(event) => setField("client_secret", event.target.value)}
                      autoComplete="new-password" spellCheck={false} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-webhook-secret">{credentialLabels.webhook_secret}</Label>
                    <Input id="billing-webhook-secret" type="password" value={form.webhook_secret}
                      onChange={(event) => setField("webhook_secret", event.target.value)}
                      autoComplete="new-password" spellCheck={false} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Os valores privados são enviados diretamente à função administrativa e armazenados
                  no Vault criptografado. Não são gravados no perfil, no cadastro da Secretaria,
                  no log de auditoria ou no navegador após salvar.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                {configuration?.has_credentials && (
                  <div className="space-y-2">
                    {!confirmDisconnect ? (
                      <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(true)}>
                        <Unplug className="mr-2 h-4 w-4" /> Desconectar conta
                      </Button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-muted-foreground">Remover as credenciais do Vault?</span>
                        <Button type="button" variant="destructive" onClick={() => void disconnect()} disabled={disconnecting}>
                          {disconnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Confirmar remoção
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}>
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <Button type="submit" disabled={saving || loading} className="ml-auto">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {configuration ? "Salvar configuração" : "Cadastrar conta"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Pronto para a escolha futura do gateway</AlertTitle>
        <AlertDescription>
          O cadastro aceita Mercado Pago, Stripe ou outro provedor. A integração de API, validação
          de credenciais, webhooks, planos, assinaturas e recebimento de mensalidades será feita
          depois que você escolher o serviço. Até lá, o sistema mantém os pagamentos desligados.
        </AlertDescription>
      </Alert>
    </div>
  );
}
