import {
  AlertTriangle,
  ArrowUpRight,
  Cloud,
  DatabaseBackup,
  FileCheck2,
  Mail,
  Settings2,
  WalletCards,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PROJECT_ID = "rwbbznqtocunzrpcvjvk";
const REPOSITORY = "artemiosds/supabase-connected-app";

type Props = { onOpenBilling: () => void };

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

  return (
    <section className="space-y-6" aria-labelledby="platform-setup-title">
      <div>
        <h2 id="platform-setup-title" className="text-2xl font-semibold tracking-tight">
          Configurações técnicas
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Roteiro para configurar manualmente serviços externos. Esta tela não recebe, armazena nem
          verifica credenciais; configure segredos diretamente nos painéis indicados.
        </p>
      </div>

      <Alert>
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Segredos ficam fora da aplicação web</AlertTitle>
        <AlertDescription>
          Não cole senhas, tokens SMTP, chaves de API ou chaves privadas aqui. Use Supabase Secrets,
          GitHub Actions Secrets ou o cofre do provedor. Os status abaixo descrevem o que o código
          suporta; não confirmam que uma configuração externa já foi feita.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" aria-hidden="true" /> E-mail, convites e URLs
              </CardTitle>
              <Badge variant="outline">Configuração manual</Badge>
            </div>
            <CardDescription>
              Convites e recuperação usam o SMTP do Supabase Auth. As Edge Functions também validam
              a origem da aplicação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              <li>Cadastre provedor, remetente e credenciais em Auth → SMTP.</li>
              <li>Configure Site URL e Redirect URLs exatas em Auth → URL Configuration.</li>
              <li>
                Configure nos Edge Function Secrets <code>APP_URL</code> e{" "}
                <code>INVITE_ALLOWED_ORIGINS</code> com origens HTTPS permitidas, sem curingas.
              </li>
              <li>Depois, homologar convite, confirmação e recuperação com contas controladas.</li>
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
                <Mail className="h-4 w-4" aria-hidden="true" /> Alertas automáticos
              </CardTitle>
              <Badge variant="outline">Código preparado · falta configurar</Badge>
            </div>
            <CardDescription>
              A função e o workflow diário estão no repositório. O agendamento fica desligado até
              e-mail e entrega serem homologados.
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
                <DatabaseBackup className="h-4 w-4" aria-hidden="true" /> Backup e recuperação
              </CardTitle>
              <Badge variant="outline">Workflow preparado · restore pendente</Badge>
            </div>
            <CardDescription>
              O backup criptografado está preparado. Não habilite a rotina semanal antes de
              descriptografar e restaurar uma cópia em outro projeto.
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
              Esse backup não inclui identidades/senhas Auth, configurações do projeto nem secrets
              de Edge Functions.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletCards className="h-4 w-4" aria-hidden="true" /> Gateway de pagamento
              </CardTitle>
              <Badge variant="outline">Cadastro disponível · transações desligadas</Badge>
            </div>
            <CardDescription>
              O formulário atual guarda credenciais no backend/Vault. Não processa pagamentos nem
              habilita cobrança real.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha o provedor e configure primeiro o ambiente Sandbox na aba Cobrança. Webhooks,
              conciliação e ativação de pagamentos permanecem pendentes.
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
                <Cloud className="h-4 w-4" aria-hidden="true" /> Google Drive
              </CardTitle>
              <Badge variant="destructive">Integração ainda não implementada</Badge>
            </div>
            <CardDescription>
              A integração exige OAuth por Secretaria, callback seguro, armazenamento de tokens no
              backend e fluxo de revogação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Não cadastre nem compartilhe credenciais OAuth ainda. Primeiro é necessário concluir o
              fluxo de autorização e sincronização no código; até lá, o GED privado do Supabase é o
              armazenamento disponível.
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
                <FileCheck2 className="h-4 w-4" aria-hidden="true" /> PDF e assinatura
              </CardTitle>
              <Badge variant="outline">Decisão e implementação pendentes</Badge>
            </div>
            <CardDescription>
              A emissão atual usa impressão do navegador e a assinatura existente é eletrônica
              simples.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Defina se os documentos exigem PDF server-side e qual nível de assinatura será usado.
              Não há configuração externa que habilite assinatura qualificada sem implementar e
              homologar o serviço correspondente.
            </p>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Não equivale a assinatura ICP-Brasil</AlertTitle>
              <AlertDescription>
                A assinatura atual não é qualificada nem substitui a revisão jurídica do processo.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
