import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
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
import {
  normalizeTestRecipient,
  smtpPortSecurityError,
  TEST_EMAIL_MAX_LENGTH,
} from "../../../supabase/functions/_shared/test-email.ts";

type PrivacyRequest = {
  id: string;
  requester_email: string | null;
  request_type: string;
  subject_description: string;
  status: string;
  created_at: string;
};

type IntegrationSettings = {
  email_provider: "none" | "resend" | "smtp_gateway";
  email_from_name: string;
  email_from_address: string;
  email_reply_to: string;
  email_domain: string;
  email_domain_verified_at: string | null;
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
  drive_last_sync_at: string | null;
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
  email_domain: "",
  email_domain_verified_at: null,
  email_smtp_host: "",
  email_smtp_port: "465",
  email_smtp_security: "tls",
  email_smtp_username: "",
  has_smtp_secret: false,
  has_email_api_secret: false,
  drive_enabled: false,
  drive_client_id: "",
  has_drive_client_secret: false,
  has_drive_refresh_token: false,
  drive_connected_at: null,
  drive_last_sync_at: null,
  drive_root_folder_id: "",
  retention_days: "",
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
  const [testRecipient, setTestRecipient] = useState("");
  const [testResult, setTestResult] = useState<{
    outcome: "accepted" | "rejected" | "uncertain" | "configuration" | "error";
    message: string;
  } | null>(null);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [requestType, setRequestType] = useState("access");
  const [requestDescription, setRequestDescription] = useState("");
  const [submittingPrivacy, setSubmittingPrivacy] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [reviewLegalBasis, setReviewLegalBasis] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const smtpPortError =
    settings.email_provider === "smtp_gateway"
      ? smtpPortSecurityError(settings.email_smtp_port, settings.email_smtp_security)
      : null;

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
      retention_days: row.retention_days == null ? "" : String(row.retention_days),
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

  async function verifyEmailDomain() {
    if (!selecionado?.id) return;
    setVerifyingDomain(true);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: { action: "verify_email_domain", tenant_id: selecionado.id },
    });
    setVerifyingDomain(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Não foi possível verificar o domínio.");
      return;
    }
    if (data.verified) toast.success(data.message);
    else toast.warning(data.message ?? "O domínio ainda não foi verificado.");
    await load();
  }

  async function syncDrive() {
    if (!selecionado?.id) return;
    setSyncingDrive(true);
    const { data, error } = await db.functions.invoke("google-drive-sync", {
      body: { tenant_id: selecionado.id },
    });
    setSyncingDrive(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "A sincronização falhou.");
      return;
    }
    toast.success(
      `Drive: ${data.synced} enviado(s), ${data.skipped} ignorado(s), ${data.failed} falha(s), ${data.uncertain} resultado(s) incerto(s).`,
    );
    await load();
  }

  async function testEmail() {
    if (!selecionado?.id || testingEmail) return;
    const recipient = normalizeTestRecipient(testRecipient);
    if (smtpPortError) {
      setTestResult({ outcome: "configuration", message: smtpPortError });
      return;
    }
    if (!recipient) {
      setTestResult({
        outcome: "error",
        message: "Informe exatamente um endereço de e-mail válido, sem espaços ou listas.",
      });
      return;
    }
    setTestingEmail(true);
    setTestResult(null);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: { action: "test_email", tenant_id: selecionado.id, test_recipient_email: recipient },
    });
    setTestingEmail(false);
    if (error || data?.error) {
      const message = data?.error ?? error?.message ?? "O teste de e-mail falhou.";
      setTestResult({ outcome: "error", message });
      toast.error(message);
      return;
    }
    const outcome =
      data.outcome === "accepted" ||
      data.outcome === "uncertain" ||
      data.outcome === "rejected" ||
      data.outcome === "configuration"
        ? data.outcome
        : data.success
          ? "accepted"
          : "rejected";
    setTestResult({ outcome, message: data.message ?? "" });
    if (outcome === "accepted") toast.success(data.message);
    else if (outcome === "uncertain") toast.warning(data.message);
    else toast.error(data.message);
    await load();
  }

  async function submitPrivacyRequest() {
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

  async function reviewPrivacyRequest(requestId: string) {
    if (!selecionado?.id) return;
    setReviewingId(requestId);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: {
        action: "review_privacy_request",
        tenant_id: selecionado.id,
        request_id: requestId,
        decision: reviewDecision,
        legal_basis_review: reviewLegalBasis,
        decision_notes: reviewNotes,
      },
    });
    setReviewingId(null);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Não foi possível registrar a decisão.");
      return;
    }
    setReviewLegalBasis("");
    setReviewNotes("");
    toast.success(data.message ?? "Análise registrada.");
    await load();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selecionado?.id) return;
    if (smtpPortError) {
      toast.error(smtpPortError);
      return;
    }
    setSaving(true);
    const { data, error } = await db.functions.invoke("tenant-integration-settings", {
      body: {
        action: "save",
        tenant_id: selecionado.id,
        ...settings,
        email_smtp_port: settings.email_smtp_port ? Number(settings.email_smtp_port) : null,
        retention_days: settings.retention_days ? Number(settings.retention_days) : null,
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
          Credenciais por Secretaria. Senhas e tokens são criptografados no servidor e nunca
          retornam ao navegador.
        </p>
      </CardHeader>
      <CardContent>
        {!selecionado ? (
          <Alert>
            <AlertTitle>Selecione uma Secretaria</AlertTitle>
            <AlertDescription>As integrações são isoladas por organização.</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Configuração indisponível</AlertTitle>
            <AlertDescription>
              {loadError} Verifique se a migration e a Edge Function foram implantadas.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={save} className="space-y-8">
            {!canEdit && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Modo de consulta</AlertTitle>
                <AlertDescription>
                  Seu papel permite visualizar integrações e registrar solicitações LGPD, mas apenas
                  perfis com permissão de edição da Secretaria podem alterar credenciais e
                  políticas.
                </AlertDescription>
              </Alert>
            )}
            <fieldset disabled={!canEdit} className="space-y-8 disabled:opacity-90">
              <section className="space-y-4">
                <div>
                  <h3 className="font-medium">E-mail institucional</h3>
                  <p className="text-sm text-muted-foreground">
                    Remetente e credenciais operacionais da Secretaria.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="integration-email-from-name">Nome do remetente</Label>
                    <Input
                      id="integration-email-from-name"
                      maxLength={160}
                      value={settings.email_from_name}
                      onChange={(e) => update("email_from_name", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="integration-email-from">E-mail do remetente</Label>
                    <Input
                      id="integration-email-from"
                      type="email"
                      maxLength={254}
                      value={settings.email_from_address}
                      onChange={(e) => update("email_from_address", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="integration-email-reply">Responder para</Label>
                    <Input
                      id="integration-email-reply"
                      type="email"
                      maxLength={254}
                      value={settings.email_reply_to}
                      onChange={(e) => update("email_reply_to", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="integration-email-domain">Domínio institucional</Label>
                    <Input
                      id="integration-email-domain"
                      maxLength={253}
                      value={settings.email_domain}
                      onChange={(e) => update("email_domain", e.target.value.toLowerCase())}
                      placeholder="saude.municipio.gov.br"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="integration-email-provider">Provedor operacional</Label>
                    <select
                      id="integration-email-provider"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={settings.email_provider}
                      onChange={(e) =>
                        update(
                          "email_provider",
                          e.target.value as IntegrationSettings["email_provider"],
                        )
                      }
                    >
                      <option value="none">Ainda não configurado</option>
                      <option value="resend">Resend (API)</option>
                      <option value="smtp_gateway">SMTP institucional</option>
                    </select>
                  </div>
                </div>
                {settings.email_provider === "smtp_gateway" && (
                  <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="smtp-host">Servidor SMTP</Label>
                      <Input
                        id="smtp-host"
                        value={settings.email_smtp_host}
                        onChange={(e) => update("email_smtp_host", e.target.value)}
                        placeholder="smtp.seudominio.gov.br"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtp-port">Porta</Label>
                      <Input
                        id="smtp-port"
                        inputMode="numeric"
                        value={settings.email_smtp_port}
                        onChange={(e) => update("email_smtp_port", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtp-security">Segurança</Label>
                      <select
                        id="smtp-security"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={settings.email_smtp_security}
                        onChange={(e) =>
                          update("email_smtp_security", e.target.value as "tls" | "starttls")
                        }
                      >
                        <option value="tls">TLS</option>
                        <option value="starttls">STARTTLS</option>
                      </select>
                    </div>
                    {smtpPortError && (
                      <p role="alert" className="text-sm text-destructive sm:col-span-2">
                        {smtpPortError}
                      </p>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="smtp-user">Usuário SMTP</Label>
                      <Input
                        id="smtp-user"
                        autoComplete="off"
                        value={settings.email_smtp_username}
                        onChange={(e) => update("email_smtp_username", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="smtp-password">
                        Senha SMTP{" "}
                        {settings.has_smtp_secret
                          ? "(já cadastrada; deixe em branco para manter)"
                          : ""}
                      </Label>
                      <Input
                        id="smtp-password"
                        type="password"
                        autoComplete="new-password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                      />
                    </div>
                    <Alert>
                      <AlertTitle>Conexão SMTP para alertas</AlertTitle>
                      <AlertDescription>
                        Use TLS na porta 465 ou STARTTLS na porta 2525, conforme o provedor. A TI
                        deve autorizar o servidor de saída e confirmar a entrega em uma caixa
                        monitorada.
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
                {settings.email_provider === "resend" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="email-api-secret">
                        Chave API Resend{" "}
                        {settings.has_email_api_secret
                          ? "(já cadastrada; deixe em branco para manter)"
                          : ""}
                      </Label>
                      <Input
                        id="email-api-secret"
                        type="password"
                        autoComplete="new-password"
                        value={emailApiSecret}
                        onChange={(e) => setEmailApiSecret(e.target.value)}
                      />
                    </div>
                    {settings.email_domain_verified_at ? (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4" /> Domínio verificado em{" "}
                        {new Date(settings.email_domain_verified_at).toLocaleString("pt-BR")}.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Adicione e valide os registros DNS do domínio no painel do Resend antes de
                        verificar aqui.
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        verifyingDomain ||
                        saving ||
                        !settings.email_domain ||
                        !settings.has_email_api_secret
                      }
                      onClick={() => void verifyEmailDomain()}
                    >
                      {verifyingDomain ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Verificar domínio no Resend
                    </Button>
                  </div>
                )}
                <Alert>
                  <AlertTitle>SMTP do Supabase Auth</AlertTitle>
                  <AlertDescription>
                    Convites, confirmação de conta e recuperação de senha usam o SMTP global do
                    Supabase Auth. Configure esse serviço no painel do projeto Supabase, em
                    Authentication → SMTP Settings; esta tela não altera essa configuração global.
                  </AlertDescription>
                </Alert>
              </section>

              <section className="space-y-4 border-t pt-6">
                <div>
                  <h3 className="font-medium">Google Drive</h3>
                  <p className="text-sm text-muted-foreground">
                    Credenciais OAuth e pasta de destino. A sincronização só deve ser ativada após
                    concluir o callback OAuth e validar a conexão.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="drive-client-id">OAuth Client ID</Label>
                    <Input
                      id="drive-client-id"
                      value={settings.drive_client_id}
                      onChange={(e) => update("drive_client_id", e.target.value)}
                      maxLength={512}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="drive-client-secret">
                      OAuth Client Secret{" "}
                      {settings.has_drive_client_secret
                        ? "(já cadastrada; deixe em branco para manter)"
                        : ""}
                    </Label>
                    <Input
                      id="drive-client-secret"
                      type="password"
                      autoComplete="new-password"
                      value={driveClientSecret}
                      onChange={(e) => setDriveClientSecret(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="drive-root-folder">ID da pasta raiz no Drive</Label>
                    <Input
                      id="drive-root-folder"
                      value={settings.drive_root_folder_id}
                      onChange={(e) => update("drive_root_folder_id", e.target.value)}
                      maxLength={512}
                    />
                  </div>
                </div>
                {settings.has_drive_refresh_token && settings.drive_connected_at ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" /> Conta Google autorizada em{" "}
                    {new Date(settings.drive_connected_at).toLocaleString("pt-BR")}. A sincronização
                    automática ainda não está habilitada.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Após salvar as credenciais, conecte a conta Google. A autorização usa escopo
                    mínimo drive.file e não transfere arquivos automaticamente.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      connectingDrive ||
                      saving ||
                      !settings.drive_client_id ||
                      !settings.has_drive_client_secret
                    }
                    onClick={() => void connectDrive()}
                  >
                    {connectingDrive ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    {connectingDrive
                      ? "Conectando..."
                      : settings.has_drive_refresh_token
                        ? "Reautorizar Google Drive"
                        : "Conectar Google Drive"}
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      syncingDrive || connectingDrive || saving || !settings.has_drive_refresh_token
                    }
                    onClick={() => void syncDrive()}
                  >
                    {syncingDrive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {syncingDrive ? "Sincronizando..." : "Sincronizar documentos (até 25)"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A sincronização copia até 25 documentos privados por execução. Os originais
                  permanecem no armazenamento da plataforma; resultados incertos não são reenviados
                  automaticamente para evitar duplicatas.
                </p>
                {settings.drive_last_sync_at && (
                  <p className="text-xs text-muted-foreground">
                    Última execução: {new Date(settings.drive_last_sync_at).toLocaleString("pt-BR")}
                    .
                  </p>
                )}
              </section>

              <section className="space-y-3 border-t pt-6">
                <div>
                  <h3 className="font-medium">Modelos oficiais DOCX</h3>
                  <p className="text-sm text-muted-foreground">
                    O módulo Documentos já possui cadastro de modelos, fontes DOCX privadas, versões
                    e motor de geração. Cadastre ou atualize os modelos oficiais por lá; não há uma
                    segunda biblioteca de modelos nesta tela.
                  </p>
                </div>
                <Button type="button" variant="outline" asChild>
                  <Link to="/documentos">Abrir gestão de modelos e documentos</Link>
                </Button>
              </section>

              <section className="space-y-4 border-t pt-6">
                <div>
                  <h3 className="font-medium">LGPD e retenção documental</h3>
                  <p className="text-sm text-muted-foreground">
                    Defina uma política institucional. O prazo não dispara exclusão automática de
                    dados.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="retention-days">Prazo de retenção (dias)</Label>
                    <Input
                      id="retention-days"
                      type="number"
                      min={30}
                      max={36500}
                      value={settings.retention_days}
                      onChange={(e) => update("retention_days", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="retention-version">Versão da política</Label>
                    <Input
                      id="retention-version"
                      maxLength={40}
                      value={settings.retention_policy_version}
                      onChange={(e) => update("retention_policy_version", e.target.value)}
                      placeholder="Ex.: 1.0 - 2026"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retention-text">Texto da política aprovada</Label>
                  <Textarea
                    id="retention-text"
                    rows={5}
                    maxLength={8000}
                    value={settings.retention_policy_text}
                    onChange={(e) => update("retention_policy_text", e.target.value)}
                    placeholder="Descreva finalidade, base legal, prazos, responsáveis, exceções legais e procedimento de descarte seguro."
                  />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approvePolicy}
                    onChange={(e) => setApprovePolicy(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Confirmo que esta política foi revisada e aprovada pela autoridade responsável
                    da Secretaria. Não estou autorizando exclusão automática de registros.
                  </span>
                </label>
                {settings.retention_approved_at && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" /> Política registrada em{" "}
                    {new Date(settings.retention_approved_at).toLocaleString("pt-BR")}.
                  </p>
                )}
              </section>
            </fieldset>

            <section className="space-y-4">
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <h4 className="font-medium">Solicitações de titulares</h4>
                  <p className="text-xs text-muted-foreground">
                    Registre pedidos de acesso, correção, exportação, oposição ou exclusão. Toda
                    exclusão exige análise legal e decisão humana.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-type">Tipo de solicitação</Label>
                    <select
                      id="privacy-request-type"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={requestType}
                      onChange={(e) => setRequestType(e.target.value)}
                    >
                      <option value="access">Acesso aos dados</option>
                      <option value="correction">Correção</option>
                      <option value="export">Exportação</option>
                      <option value="deletion">Exclusão (sujeita à análise legal)</option>
                      <option value="objection">Oposição</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-description">
                      Descrição e identificação do pedido
                    </Label>
                    <Textarea
                      id="privacy-request-description"
                      rows={3}
                      minLength={10}
                      maxLength={4000}
                      value={requestDescription}
                      onChange={(e) => setRequestDescription(e.target.value)}
                      required
                      placeholder="Descreva os dados envolvidos e o que está sendo solicitado."
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submittingPrivacy || requestDescription.trim().length < 10}
                    onClick={() => void submitPrivacyRequest()}
                  >
                    {submittingPrivacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Registrar solicitação
                  </Button>
                </div>
                {canEdit && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">Pedidos registrados nesta Secretaria</p>
                    {privacyRequests.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma solicitação registrada.
                      </p>
                    ) : (
                      privacyRequests.map((request) => (
                        <div key={request.id} className="rounded-md bg-muted/40 p-3 text-sm">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">
                              {request.request_type.toUpperCase()} · {request.status}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(request.created_at).toLocaleString("pt-BR")}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {request.requester_email ?? "Solicitante autenticado"}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap">{request.subject_description}</p>
                          {canEdit &&
                            ["received", "under_review", "awaiting_identity"].includes(
                              request.status,
                            ) && (
                              <div className="mt-3 space-y-2 border-t pt-3">
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label htmlFor={`privacy-decision-${request.id}`}>
                                      Decisão
                                    </Label>
                                    <select
                                      id={`privacy-decision-${request.id}`}
                                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                      value={reviewDecision}
                                      onChange={(e) =>
                                        setReviewDecision(e.target.value as "approved" | "rejected")
                                      }
                                    >
                                      <option value="approved">Aprovar solicitação</option>
                                      <option value="rejected">Rejeitar solicitação</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label htmlFor={`privacy-basis-${request.id}`}>
                                      Análise da base legal
                                    </Label>
                                    <Input
                                      id={`privacy-basis-${request.id}`}
                                      value={reviewLegalBasis}
                                      onChange={(e) => setReviewLegalBasis(e.target.value)}
                                      maxLength={2000}
                                      placeholder="Base legal e obrigações de guarda"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={`privacy-notes-${request.id}`}>
                                    Justificativa da decisão
                                  </Label>
                                  <Textarea
                                    id={`privacy-notes-${request.id}`}
                                    rows={2}
                                    value={reviewNotes}
                                    onChange={(e) => setReviewNotes(e.target.value)}
                                    maxLength={4000}
                                  />
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    reviewingId === request.id ||
                                    !reviewLegalBasis.trim() ||
                                    !reviewNotes.trim()
                                  }
                                  onClick={() => void reviewPrivacyRequest(request.id)}
                                >
                                  {reviewingId === request.id
                                    ? "Registrando..."
                                    : "Registrar decisão"}
                                </Button>
                              </div>
                            )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </section>

            {canEdit &&
              (settings.email_provider === "resend" ||
                settings.email_provider === "smtp_gateway") && (
                <section className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Teste individual de e-mail</h3>
                    <p className="text-xs text-muted-foreground">
                      Envia uma única mensagem ao endereço informado. Não aciona alertas de
                      contratos, profissionais ou filas. Usa a configuração já salva; salve antes de
                      testar. Este campo não é gravado na configuração.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="test-recipient">Destinatário do teste</Label>
                      <Input
                        id="test-recipient"
                        type="email"
                        maxLength={TEST_EMAIL_MAX_LENGTH}
                        autoComplete="off"
                        value={testRecipient}
                        onChange={(e) => setTestRecipient(e.target.value)}
                        placeholder="ex: teste@orgao.gov.br"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        testingEmail ||
                        saving ||
                        Boolean(smtpPortError) ||
                        !normalizeTestRecipient(testRecipient)
                      }
                      onClick={() => void testEmail()}
                    >
                      {testingEmail ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      {testingEmail ? "Enviando..." : "Enviar 1 e-mail de teste"}
                    </Button>
                  </div>
                  {testResult && (
                    <Alert variant={testResult.outcome === "accepted" ? "default" : "destructive"}>
                      {testResult.outcome === "accepted" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                      <AlertTitle>
                        {testResult.outcome === "accepted"
                          ? "Aceito pelo servidor (entrega não confirmada)"
                          : testResult.outcome === "uncertain"
                            ? "Resultado incerto"
                            : testResult.outcome === "rejected"
                              ? "Rejeitado pelo servidor"
                              : testResult.outcome === "configuration"
                                ? "Configuração SMTP inválida"
                                : "Teste não enviado"}
                      </AlertTitle>
                      <AlertDescription>{testResult.message}</AlertDescription>
                    </Alert>
                  )}
                </section>
              )}

            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" /> Segredos criptografados no servidor
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving || testingEmail}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Salvando..." : "Salvar configurações"}
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
