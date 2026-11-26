import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  DatabaseBackup,
  FileCheck2,
  Globe,
  Lock,
  Mail,
  Settings2,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

const PROJECT_ID = "rwbbznqtocunzrpcvjvk";
const REPOSITORY = "artemiosds/supabase-connected-app";
const CHECKLIST_STORAGE_KEY = "primus_master_golive_checklist_v1";

type Props = { onOpenBilling: () => void };

type GateItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
      </a>
    </Button>
  );
}

function SecretNames({ names }: { names: string[] }) {
  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {names.map((name) => (
        <li key={name}>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{name}</code>
        </li>
      ))}
    </ul>
  );
}

export function AdminMasterConfiguration({ onOpenBilling }: Props) {
  const supabaseDashboard = `https://supabase.com/dashboard/project/${PROJECT_ID}`;
  const githubSettings = `https://github.com/${REPOSITORY}/settings`;

  const gateItems: GateItem[] = [
    {
      id: "github_private",
      title: "Tornar repositório privado no GitHub",
      detail: "Em Danger Zone do repositório, altere a visibilidade para Private antes do Go-Live.",
      href: githubSettings,
      cta: "Abrir Settings GitHub",
    },
    {
      id: "leaked_password",
      title: "Ativar Leaked Password Protection no Auth (SMS2)",
      detail: "Elimina o último WARN de segurança do Supabase Auth contra senhas vazadas.",
      href: `${supabaseDashboard}/auth/providers`,
      cta: "Abrir Auth Security",
    },
    {
      id: "auth_smtp_urls",
      title: "Configurar Auth SMTP, Site URL e Redirect URLs",
      detail:
        "Necessário para convites de administradores, confirmação de e-mail e recuperação de senha.",
      href: `${supabaseDashboard}/auth/smtp`,
      cta: "Abrir Auth SMTP",
    },
    {
      id: "edge_secrets",
      title: "Cadastrar Edge Function Secrets no Supabase",
      detail:
        "Configure APP_URL, INVITE_ALLOWED_ORIGINS, INTEGRATION_SECRETS_KEY (32 bytes base64), SMTP_ALLOWED_ENDPOINTS, RESEND_API_KEY, EXPIRY_ALERTS_FROM e EXPIRY_ALERTS_CRON_SECRET.",
      href: `${supabaseDashboard}/settings/functions`,
      cta: "Abrir Function Secrets",
    },
    {
      id: "backup_restore",
      title: "Testar 1 backup criptografado + restore e ativar SUPABASE_BACKUP_ENABLED",
      detail:
        "Configure SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY e AGE_RECIPIENT no GitHub antes de ativar a rotina semanal.",
      href: `https://github.com/${REPOSITORY}/actions/workflows/backup-sms2.yml`,
      cta: "Abrir Backup SMS2",
    },
    {
      id: "legal_docs",
      title: "Revisar dados comerciais/jurídicos em Privacidade e Termos",
      detail:
        "Confira CPF/CNPJ, endereço e remova avisos preliminares quando adotar a versão final.",
      href: "/privacidade",
      cta: "Ver Política de Privacidade",
    },
  ];

  const [checkedIds, setCheckedIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(CHECKLIST_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(checkedIds));
    } catch {
      // noop
    }
  }, [checkedIds]);

  function toggleGateItem(id: string) {
    setCheckedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  const completedCount = gateItems.filter((item) => checkedIds.includes(item.id)).length;

  return (
    <section className="space-y-6" aria-labelledby="platform-setup-title">
      <div>
        <h2 id="platform-setup-title" className="text-2xl font-semibold tracking-tight">
          Configurações técnicas e Gate Operacional (Go-Live)
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Roteiro operacional para produção. Segredos nunca trafegam pelo frontend; configure-os
          diretamente nos painéis oficiais do Supabase e do GitHub.
        </p>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              Gate Operacional — Checklist antes do 1º Cliente Real
            </CardTitle>
            <Badge variant={completedCount === gateItems.length ? "default" : "secondary"}>
              {completedCount}/{gateItems.length} concluído(s)
            </Badge>
          </div>
          <CardDescription>
            Toda a engenharia (Fases A–E) já está em produção no Supabase e GitHub. Marque cada
            etapa conforme concluir no painel externo (salvo localmente neste navegador).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {gateItems.map((item) => {
            const done = checkedIds.includes(item.id);
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-background p-3"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={done}
                    onCheckedChange={() => toggleGateItem(item.id)}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <p
                      className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}
                    >
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </label>
                {item.href.startsWith("/") ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={item.href} target="_blank" rel="noopener noreferrer">
                      {item.cta}
                      <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                ) : (
                  <ExternalLink href={item.href}>{item.cta}</ExternalLink>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Alert>
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Segredos ficam fora da aplicação web</AlertTitle>
        <AlertDescription>
          Não cole senhas, tokens SMTP, chaves AES ou tokens de API aqui. Use Supabase Edge Function
          Secrets, GitHub Actions Secrets ou o cofre criptografado por Secretaria.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" aria-hidden="true" /> E-mail institucional, convites e
                cotações
              </CardTitle>
              <Badge variant="outline">Configurar segredos no painel</Badge>
            </div>
            <CardDescription>
              Convites usam Auth SMTP. Cotações eletrônicas e testes usam{" "}
              <code>send-quote-request-email</code> e <code>tenant-integration-settings</code> com
              credenciais criptografadas por Secretaria.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              <li>Cadastre remetente e SMTP em Auth → SMTP e ative Leaked Password Protection.</li>
              <li>Configure Site URL e Redirect URLs exatas em Auth → URL Configuration.</li>
              <li>
                Nos Edge Function Secrets, defina <code>APP_URL</code>,{" "}
                <code>INVITE_ALLOWED_ORIGINS</code>, <code>INTEGRATION_SECRETS_KEY</code> e{" "}
                <code>SMTP_ALLOWED_ENDPOINTS</code>.
              </li>
              <li>
                Homologue convite, confirmação e disparo de cotação para uma conta controlada.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <ExternalLink href={`${supabaseDashboard}/auth/smtp`}>
                Abrir SMTP do Auth
              </ExternalLink>
              <ExternalLink href={`${supabaseDashboard}/auth/url-configuration`}>
                Abrir URLs do Auth
              </ExternalLink>
              <ExternalLink href={`${supabaseDashboard}/settings/functions`}>
                Abrir secrets de Functions
              </ExternalLink>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" aria-hidden="true" /> Alertas automáticos (Vencimentos &
                Comercial)
              </CardTitle>
              <Badge variant="outline">Workflows prontos · ativar quando homologar</Badge>
            </div>
            <CardDescription>
              Cobre <code>send-expiry-notifications</code> e <code>platform-commercial-alerts</code>{" "}
              (trials/faturas vencidas). Mantenha desativado até concluir o teste de e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-medium">Supabase Edge Function Secrets</p>
                <SecretNames
                  names={[
                    "RESEND_API_KEY",
                    "EXPIRY_ALERTS_FROM",
                    "EXPIRY_ALERTS_CRON_SECRET",
                    "INTEGRATION_SECRETS_KEY",
                    "APP_URL",
                  ]}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">GitHub Actions</p>
                <SecretNames
                  names={["SUPABASE_URL", "SUPABASE_ANON_KEY", "EXPIRY_ALERTS_CRON_SECRET"]}
                />
                <p className="text-xs text-muted-foreground">
                  Variable: <code>EXPIRY_ALERTS_ENABLED</code>. Mantê-la como <code>false</code> até
                  concluir a homologação de e-mail.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ExternalLink href={`${supabaseDashboard}/settings/functions`}>
                Configurar secrets Supabase
              </ExternalLink>
              <ExternalLink href={`${githubSettings}/secrets/actions`}>
                Configurar secrets GitHub
              </ExternalLink>
              <ExternalLink href={`${githubSettings}/variables/actions`}>
                Configurar variables GitHub
              </ExternalLink>
              <ExternalLink
                href={`https://github.com/${REPOSITORY}/actions/workflows/send-expiry-notifications.yml`}
              >
                Abrir workflow
              </ExternalLink>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <DatabaseBackup className="h-4 w-4" aria-hidden="true" /> Backup criptografado
                (SMS2)
              </CardTitle>
              <Badge variant="outline">Workflow pronto · testar restore</Badge>
            </div>
            <CardDescription>
              O backup criptografado (`age`) está configurado. Rode 1 execução manual e valide a
              restauração antes de ativar o agendamento semanal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">GitHub Actions</p>
              <SecretNames names={["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]} />
              <p className="text-xs text-muted-foreground">
                Variables: <code>AGE_RECIPIENT</code> e <code>SUPABASE_BACKUP_ENABLED</code>. Ative
                a última somente depois de comprovar a restauração.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ExternalLink href={`${githubSettings}/secrets/actions`}>
                Configurar secrets GitHub
              </ExternalLink>
              <ExternalLink href={`${githubSettings}/variables/actions`}>
                Configurar variables GitHub
              </ExternalLink>
              <ExternalLink
                href={`https://github.com/${REPOSITORY}/actions/workflows/backup-sms2.yml`}
              >
                Abrir workflow de backup
              </ExternalLink>
            </div>
            <p className="text-xs text-muted-foreground">
              Esse backup lógico não inclui senhas Auth nem Edge Function Secrets.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletCards className="h-4 w-4" aria-hidden="true" /> Gateway de pagamento SaaS
              </CardTitle>
              <Badge variant="secondary">Ativo p/ homologar Sandbox</Badge>
            </div>
            <CardDescription>
              As funções <code>platform-billing-config</code> e{" "}
              <code>platform-billing-webhook</code> estão ativas com validação HMAC fail-closed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure as credenciais de Sandbox na aba Cobrança e registre a URL do webhook no
              provedor antes de ativar cobranças em produção.
            </p>
            <Button type="button" variant="outline" onClick={onOpenBilling}>
              Abrir configuração de cobrança
              <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cloud className="h-4 w-4" aria-hidden="true" /> Google Drive (GED externo)
              </CardTitle>
              <Badge variant="secondary">OAuth + Sync ativos · opcional</Badge>
            </div>
            <CardDescription>
              <code>google-drive-oauth-callback</code> e <code>google-drive-sync</code> usam escopo{" "}
              <code>drive.file</code> com criptografia via <code>INTEGRATION_SECRETS_KEY</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Para habilitar, defina <code>GOOGLE_DRIVE_REDIRECT_URI</code> nos Secrets do Supabase
              e cadastre o Client ID/Secret da Secretaria em Configurações → Integrações. O GED
              privado do Supabase já funciona sem Drive.
            </p>
            <ExternalLink href="https://console.cloud.google.com/apis/credentials">
              Abrir credenciais Google Cloud
            </ExternalLink>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4" aria-hidden="true" /> Preços Públicos & PNCP (Lei 14.133)
              </CardTitle>
              <Badge variant="default">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Ativo · API gratuita
              </Badge>
            </div>
            <CardDescription>
              Consulta em tempo real aos Dados Abertos Compras.gov.br (`fetch-public-prices`) e
              pré-validação/exportação JSON padrão PNCP sem custo de chave externa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Exige apenas <code>APP_URL</code> / <code>INVITE_ALLOWED_ORIGINS</code> configurados
              corretamente para o domínio oficial de produção.
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Banco `SMS2`: migrações sincronizadas, índices otimizados e Edge Functions ativas.
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="h-4 w-4" aria-hidden="true" /> Geração de PDF e Assinatura
                Eletrônica
              </CardTitle>
              <Badge variant="secondary">PDF nativo + Hash SHA-256 ativos</Badge>
            </div>
            <CardDescription>
              Dossiê TCE consolidado, mapa comparativo e documentos oficiais geram PDF timbrado com
              registro criptográfico de assinatura verificável (<code>sign-generated-document</code>
              ).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Não equivale a assinatura qualificada ICP-Brasil</AlertTitle>
              <AlertDescription>
                A assinatura eletrônica simples com hash SHA-256 garante integridade e autoria no
                sistema, mas não substitui certificado ICP-Brasil quando exigido por norma local.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
