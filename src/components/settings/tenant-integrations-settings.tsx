import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/use-tenant";
import { db } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PrivacyRequest = { id: string; requester_email: string | null; request_type: string; subject_description: string; status: string; created_at: string };

type IntegrationSettings = {
  email_provider: "none" | "resend" | "smtp_gateway";
  email_from_name: string;
  email_from_address: string;
  email_reply_to: string;
  email_smtp_host: string;
  email_smtp_port: string;
  email_smtp_security: "tls" | "starttls";
  email_smtp_username: string;
  has_smtp_secret: boolean;
  has_email_api_secret: boolean;
  drive_enabled: boolean;
  drive_client_id: string;
  has_drive_client_secret: boolean;
  has_drive_refresh_token: boolean;
  drive_connected_at: string | null;
  drive_root_folder_id: string;
  retention_days: string;
  retention_policy_version: string;
  retention_policy_text: string;
  retention_approved_at: string | null;
  updated_at: string | null;
};

const EMPTY: IntegrationSettings = {
  email_provider: "none",
  email_from_name: "",
  email_from_address: "",
  email_reply_to: "",
  email_smtp_host: "",
  email_smtp_port: "587",
  email_smtp_security: "starttls",
  email_smtp_username: "",
  has_smtp_secret: false,
  has_email_api_secret: false,
  drive_enabled: false,
  drive_client_id: "",
  has_drive_client_secret: false,
  has_drive_refresh_token: false,
  drive_connected_at: null,
  drive_root_folder_id: "",
  retention_days: "2555",
  retention_policy_version: "",
  retention_policy_text: "",
  retention_approved_at: null,
  updated_at: null,
};

export function TenantIntegrationsSettings() {
  const { selecionado } = useTenant();
  const [settings, setSettings] = useState<IntegrationSettings>(EMPTY);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [emailApiSecret, setEmailApiSecret] = useState("");
  const [driveClientSecret, setDriveClientSecret] = useState("");
  const [approvePolicy, setApprovePolicy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [requestType, setRequestType] = useState("access");
  const [requestDescription, setRequestDescription] = useState("");
  const [submittingPrivacy, setSubmittingPrivacy] = useState(false);

  const update = <K extends keyof IntegrationSettings>(key: K, value: IntegrationSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const load = useCallback(async () => {
    if (!selecionado?.id) {
      setSettings(EMPTY);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: { action: "get", tenant_id: selecionado.id },
    });
    setLoading(false);
    if (error || data?.error) {
      setLoadError(data?.error ?? "Não foi possível carregar as configurações protegidas.");
      return;
    }
    setCanEdit(data?.can_edit === true);
    if (data?.can_edit === true) {
      const listed = await db.functions.invoke("tenant-integration-settings", {
        body: { action: "list_privacy_requests", tenant_id: selecionado.id },
      });
      setPrivacyRequests(listed.data?.requests ?? []);
    } else {
      setPrivacyRequests([]);
    }
    const row = data?.configuration;
    if (!row) {
      setSettings(EMPTY);
      return;
    }
    setSettings({
      ...EMPTY,
      ...row,
      email_smtp_port: row.email_smtp_port == null ? "" : String(row.email_smtp_port),
      retention_days: String(row.retention_days ?? 2555),
      retention_policy_text: row.retention_policy_text ?? "",
      retention_policy_version: row.retention_policy_version ?? "",
    });
  }, [selecionado?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connectDrive() {
    if (!selecionado?.id) return;
    setConnectingDrive(true);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: { action: "start_drive_oauth", tenant_id: selecionado.id },
    });
    setConnectingDrive(false);
    if (error || data?.error || !data?.authorization_url) {
      toast.error(data?.error ?? error?.message ?? "Não foi possível iniciar a conexão.");
      return;
    }
    window.location.assign(data.authorization_url);
  }

  async function testEmail() {
    if (!selecionado?.id) return;
    setTestingEmail(true);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: { action: "test_email", tenant_id: selecionado.id },
    });
    setTestingEmail(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "O teste de e-mail falhou.");
      return;
    }
    toast.success(data.message ?? "Teste de e-mail aceito pelo provedor.");
    await load();
  }

  async function submitPrivacyRequest(event: FormEvent) {
    event.preventDefault();
    if (!selecionado?.id) return;
    setSubmittingPrivacy(true);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: {
        action: "submit_privacy_request",
        tenant_id: selecionado.id,
        request_type: requestType,
        subject_description: requestDescription,
      },
    });
    setSubmittingPrivacy(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Não foi possível registrar a solicitação.");
      return;
    }
    setRequestDescription("");
    toast.success("Solicitação registrada para análise.");
    await load();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selecionado?.id) return;
    setSaving(true);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: {
        action: "save",
        tenant_id: selecionado.id,
        ...settings,
        email_smtp_port: settings.email_smtp_port ? Number(settings.email_smtp_port) : null,
        retention_days: Number(settings.retention_days),
        email_smtp_password: smtpPassword || undefined,
        email_api_secret: emailApiSecret || undefined,
        drive_client_secret: driveClientSecret || undefined,
        approve_retention_policy: approvePolicy,
      },
    });
    setSaving(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Não foi possível salvar.");
      return;
    }
    setSmtpPassword("");
    setEmailApiSecret("");
    setDriveClientSecret("");
    setApprovePolicy(false);
    toast.success("Configurações protegidas atualizadas.");
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Integrações e conformidade da Secretaria</CardTitle>
        <p className="text-sm text-muted-foreground">
          Credenciais por Secretaria. Senhas e tokens são criptografados no servidor e nunca retornam ao navegador.
        </p>
      </CardHeader>
      <CardContent>
        {!selecionado ? (
          <Alert><AlertTitle>Selecione uma Secretaria</AlertTitle><AlertDescription>As integrações são isoladas por organização.</AlertDescription></Alert>
        ) : loading ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : loadError ? (
          <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Configuração indisponível</AlertTitle><AlertDescription>{loadError} Verifique se a migration e a Edge Function foram implantadas.</AlertDescription></Alert>
        ) : (
          <form onSubmit={save} className="space-y-8">
            <section className="space-y-4">
              <div>
                <h3 className="font-medium">E-mail institucional</h3>
                <p className="text-sm text-muted-foreground">Remetente e credenciais operacionais da Secretaria.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="integration-email-from-name">Nome do remetente</Label>
                  <Input id="integration-email-from-name" maxLength={160} value={settings.email_from_name} onChange={(e) => update("email_from_name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="integration-email-from">E-mail do remetente</Label>
                  <Input id="integration-email-from" type="email" maxLength={254} value={settings.email_from_address} onChange={(e) => update("email_from_address", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="integration-email-reply">Responder para</Label>
                  <Input id="integration-email-reply" type="email" maxLength={254} value={settings.email_reply_to} onChange={(e) => update("email_reply_to", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="integration-email-provider">Provedor operacional</Label>
                  <select id="integration-email-provider" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={settings.email_provider} onChange={(e) => update("email_provider", e.target.value as IntegrationSettings["email_provider"])}>
                    <option value="none">Ainda não configurado</option>
                    <option value="resend">Resend (API)</option>
                    <option value="smtp_gateway">SMTP (gateway externo necessário)</option>
                  </select>
                </div>
              </div>
              {settings.email_provider === "smtp_gateway" && (
                <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="smtp-host">Servidor SMTP</Label><Input id="smtp-host" value={settings.email_smtp_host} onChange={(e) => update("email_smtp_host", e.target.value)} placeholder="smtp.seudominio.gov.br" /></div>
                  <div className="space-y-2"><Label htmlFor="smtp-port">Porta</Label><Input id="smtp-port" inputMode="numeric" value={settings.email_smtp_port} onChange={(e) => update("email_smtp_port", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="smtp-security">Segurança</Label><select id="smtp-security" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={settings.email_smtp_security} onChange={(e) => update("email_smtp_security", e.target.value as "tls" | "starttls")}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></div>
                  <div className="space-y-2"><Label htmlFor="smtp-user">Usuário SMTP</Label><Input id="smtp-user" autoComplete="off" value={settings.email_smtp_username} onChange={(e) => update("email_smtp_username", e.target.value)} /></div>
                  <div className="space-y-2 sm:col-span-2"><Label htmlFor="smtp-password">Senha SMTP {settings.has_smtp_secret ? "(já cadastrada; deixe em branco para manter)" : ""}</Label><Input id="smtp-password" type="password" autoComplete="new-password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} /></div>
                  <Alert><AlertTitle>Limite de execução</AlertTitle><AlertDescription>Os dados ficam criptografados e isolados por Secretaria. O envio SMTP direto ainda exige um gateway de saída compatível com o ambiente Edge; salvar estes campos, sozinho, não ativa o envio.</AlertDescription></Alert>
                </div>
              )}
              {settings.email_provider === "resend" && (
                <div className="space-y-2">
                  <Label htmlFor="email-api-secret">Chave API Resend {settings.has_email_api_secret ? "(já cadastrada; deixe em branco para manter)" : ""}</Label>
                  <Input id="email-api-secret" type="password" autoComplete="new-password" value={emailApiSecret} onChange={(e) => setEmailApiSecret(e.target.value)} />
                  <p className="text-xs text-muted-foreground">A validação de domínio e o teste de envio serão habilitados na etapa do conector de entrega.</p>
                </div>
              )}
              <Alert><AlertTitle>SMTP do Supabase Auth</AlertTitle><AlertDescription>Convites, confirmação de conta e recuperação de senha usam o SMTP global do Supabase Auth. Configure esse serviço no painel do projeto Supabase, em Authentication → SMTP Settings; esta tela não altera essa configuração global.</AlertDescription></Alert>
            </section>

            <section className="space-y-4 border-t pt-6">
              <div><h3 className="font-medium">Google Drive</h3><p className="text-sm text-muted-foreground">Credenciais OAuth e pasta de destino. A sincronização só deve ser ativada após concluir o callback OAuth e validar a conexão.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="drive-client-id">OAuth Client ID</Label><Input id="drive-client-id" value={settings.drive_client_id} onChange={(e) => update("drive_client_id", e.target.value)} maxLength={512} /></div>
                <div className="space-y-2"><Label htmlFor="drive-client-secret">OAuth Client Secret {settings.has_drive_client_secret ? "(já cadastrada; deixe em branco para manter)" : ""}</Label><Input id="drive-client-secret" type="password" autoComplete="new-password" value={driveClientSecret} onChange={(e) => setDriveClientSecret(e.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="drive-root-folder">ID da pasta raiz no Drive</Label><Input id="drive-root-folder" value={settings.drive_root_folder_id} onChange={(e) => update("drive_root_folder_id", e.target.value)} maxLength={512} /></div>
              </div>
              {settings.has_drive_refresh_token && settings.drive_connected_at ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Conta Google autorizada em {new Date(settings.drive_connected_at).toLocaleString("pt-BR")}. A sincronização automática ainda não está habilitada.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Após salvar as credenciais, conecte a conta Google. A autorização usa escopo mínimo drive.file e não transfere arquivos automaticamente.</p>
              )}
              <Button type="button" variant="outline" disabled={connectingDrive || saving || !settings.drive_client_id || !settings.has_drive_client_secret} onClick={() => void connectDrive()}>
                {connectingDrive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {connectingDrive ? "Conectando..." : settings.has_drive_refresh_token ? "Reautorizar Google Drive" : "Conectar Google Drive"}
              </Button>
            </section>

            <section className="space-y-4 border-t pt-6">
              <div><h3 className="font-medium">LGPD e retenção documental</h3><p className="text-sm text-muted-foreground">Defina uma política institucional. O prazo não dispara exclusão automática de dados.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="retention-days">Prazo de retenção (dias)</Label><Input id="retention-days" type="number" min={30} max={36500} value={settings.retention_days} onChange={(e) => update("retention_days", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="retention-version">Versão da política</Label><Input id="retention-version" maxLength={40} value={settings.retention_policy_version} onChange={(e) => update("retention_policy_version", e.target.value)} placeholder="Ex.: 1.0 - 2026" /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="retention-text">Texto da política aprovada</Label><Textarea id="retention-text" rows={5} maxLength={8000} value={settings.retention_policy_text} onChange={(e) => update("retention_policy_text", e.target.value)} placeholder="Descreva finalidade, base legal, prazos, responsáveis, exceções legais e procedimento de descarte seguro." /></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approvePolicy} onChange={(e) => setApprovePolicy(e.target.checked)} className="mt-1" /><span>Confirmo que esta política foi revisada e aprovada pela autoridade responsável da Secretaria. Não estou autorizando exclusão automática de registros.</span></label>
              {settings.retention_approved_at && <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Política registrada em {new Date(settings.retention_approved_at).toLocaleString("pt-BR")}.</p>}
              <div className="space-y-3 rounded-lg border p-4">
                <div><h4 className="font-medium">Solicitações de titulares</h4><p className="text-xs text-muted-foreground">Registre pedidos de acesso, correção, exportação, oposição ou exclusão. Toda exclusão exige análise legal e decisão humana.</p></div>
                <form onSubmit={(event) => void submitPrivacyRequest(event)} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-type">Tipo de solicitação</Label>
                    <select id="privacy-request-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
                      <option value="access">Acesso aos dados</option><option value="correction">Correção</option><option value="export">Exportação</option><option value="deletion">Exclusão (sujeita à análise legal)</option><option value="objection">Oposição</option>
                    </select>
                  </div>
                  <div className="space-y-2"><Label htmlFor="privacy-request-description">Descrição e identificação do pedido</Label><Textarea id="privacy-request-description" rows={3} minLength={10} maxLength={4000} value={requestDescription} onChange={(e) => setRequestDescription(e.target.value)} required placeholder="Descreva os dados envolvidos e o que está sendo solicitado." /></div>
                  <Button type="submit" variant="outline" disabled={submittingPrivacy || requestDescription.trim().length < 10}>{submittingPrivacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Registrar solicitação</Button>
                </form>
                {canEdit && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">Pedidos registrados nesta Secretaria</p>
                    {privacyRequests.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma solicitação registrada.</p> : privacyRequests.map((request) => (
                      <div key={request.id} className="rounded-md bg-muted/40 p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{request.request_type.toUpperCase()} · {request.status}</span><span className="text-xs text-muted-foreground">{new Date(request.created_at).toLocaleString("pt-BR")}</span></div>
                        <p className="mt-1 text-xs text-muted-foreground">{request.requester_email ?? "Solicitante autenticado"}</p>
                        <p className="mt-2 whitespace-pre-wrap">{request.subject_description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Segredos criptografados no servidor</p>
              <div className="flex flex-wrap gap-2">
                {settings.email_provider === "resend" && (
                  <Button type="button" variant="outline" disabled={testingEmail || saving} onClick={() => void testEmail()}>
                    {testingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Enviar teste para meu e-mail
                  </Button>
                )}
                <Button type="submit" disabled={saving || testingEmail}><Save className="mr-2 h-4 w-4" />{saving ? "Salvando..." : "Salvar configurações"}</Button>
              </div>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
