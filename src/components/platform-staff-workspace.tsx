import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/db";
import { AdminMasterSupport } from "@/components/admin-master-support";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlatformStaffAccess } from "@/hooks/use-platform-admin";

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  commercial_status: string;
  plan_tier: string;
  monthly_fee: number | null;
  municipality: string | null;
  state: string | null;
  created_at: string;
};
type Metrics = {
  mrr_estimated: number | null;
  active_clients: number;
  trial_clients: number;
  blocked_clients: number;
  suspended_clients: number;
  contracts_total: number;
  processes_total: number;
  suppliers_total: number;
};
type AuditRow = {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
  actor_email: string | null;
  tenant_name: string | null;
};

const STATUS: Record<string, string> = {
  active: "Ativo",
  trial: "Demonstração",
  blocked_billing: "Bloqueado por cobrança",
  suspended: "Suspenso",
  closed: "Encerrado",
  cancelled: "Cancelado",
};

export function PlatformStaffWorkspace({ access }: { access: PlatformStaffAccess }) {
  const { session, signOut } = useAuth();
  const permissionKey = access.permissionCodes.join("|");
  const permissions = new Set(permissionKey.split("|").filter(Boolean));
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true);
      const activePermissions = new Set(permissionKey.split("|").filter(Boolean));
      const canSeeClients =
        activePermissions.has("clients.view") ||
        activePermissions.has("plans.view") ||
        activePermissions.has("billing.summary.view") ||
        activePermissions.has("support.team.manage");
      const canSeeSummary =
        activePermissions.has("metrics.view") || activePermissions.has("billing.summary.view");
      const jobs: Promise<unknown>[] = [];
      const results: { tenants?: TenantSummary[]; metrics?: Metrics; audit?: AuditRow[] } = {};
      if (canSeeClients) {
        jobs.push(
          Promise.resolve(db.rpc("list_platform_staff_tenants")).then(({ data, error }) => {
            if (error) throw error;
            results.tenants = (data ?? []) as TenantSummary[];
          }),
        );
      }
      if (canSeeSummary) {
        jobs.push(
          Promise.resolve(db.rpc("get_platform_staff_metrics")).then(({ data, error }) => {
            if (error) throw error;
            results.metrics = data as Metrics;
          }),
        );
      }
      if (activePermissions.has("audit.view")) {
        jobs.push(
          Promise.resolve(db.rpc("list_platform_staff_audit_events", { p_limit: 100 })).then(
            ({ data, error }) => {
              if (error) throw error;
              results.audit = (data ?? []) as AuditRow[];
            },
          ),
        );
      }
      try {
        await Promise.all(jobs);
        if (!current) return;
        setTenants(results.tenants ?? []);
        setMetrics(results.metrics ?? null);
        setAudit(results.audit ?? []);
      } catch (cause) {
        if (current) {
          setTenants([]);
          setMetrics(null);
          setAudit([]);
          toast.error(
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar seu ambiente de trabalho.",
          );
        }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [permissionKey]);

  const canManageSupport = permissions.has("support.team.manage");
  const showClients = permissions.has("clients.view");
  const showPlans = permissions.has("plans.view");
  const showFinance = permissions.has("billing.summary.view");
  const showMetrics = permissions.has("metrics.view");
  const showAudit = permissions.has("audit.view");
  const defaultTab = showClients
    ? "clientes"
    : showFinance
      ? "financeiro"
      : showMetrics
        ? "metricas"
        : showAudit
          ? "auditoria"
          : canManageSupport
            ? "suporte"
            : "inicio";

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Área interna
            </p>
            <h1 className="text-xl font-semibold">Portal da Equipe Interna</h1>
            <p className="text-sm text-muted-foreground">
              {access.displayName} · {session?.user.email ?? ""} · {access.roleNames.join(", ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Acesso limitado por perfil</Badge>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" aria-hidden />
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] space-y-6 px-4 py-6 md:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Bem-vindo(a), {access.displayName}</CardTitle>
            <CardDescription>
              Você visualiza somente os recursos liberados pelos seus perfis. As permissões são
              novamente verificadas no servidor a cada consulta.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <p>
              Perfis: <strong>{access.roleNames.join(", ") || "Sem perfil"}</strong>
            </p>
            <p>
              Permissões ativas: <strong>{access.permissionCodes.length}</strong>
            </p>
            <p>
              Conta: <strong>{access.status === "active" ? "Ativa" : access.status}</strong>
            </p>
          </CardContent>
        </Card>
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando permissões do seu perfil...
          </p>
        ) : (
          <Tabs defaultValue={defaultTab} className="space-y-6">
            <TabsList className="h-auto flex-wrap justify-start">
              {permissions.has("dashboard.view") && (
                <TabsTrigger value="inicio">Visão geral</TabsTrigger>
              )}
              {showClients && <TabsTrigger value="clientes">Clientes</TabsTrigger>}
              {showPlans && <TabsTrigger value="planos">Planos</TabsTrigger>}
              {showFinance && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
              {showMetrics && <TabsTrigger value="metricas">Métricas</TabsTrigger>}
              {showAudit && <TabsTrigger value="auditoria">Auditoria</TabsTrigger>}
              {canManageSupport && <TabsTrigger value="suporte">Equipe de Suporte</TabsTrigger>}
            </TabsList>

            {permissions.has("dashboard.view") && (
              <TabsContent value="inicio">
                <Card>
                  <CardHeader>
                    <CardTitle>Seu escopo de trabalho</CardTitle>
                    <CardDescription>
                      Os dados abaixo são os recursos que seu Administrador Master liberou.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {access.permissionCodes.map((code) => (
                      <Badge key={code} variant="outline">
                        {code}
                      </Badge>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {showClients && (
              <TabsContent value="clientes" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Secretarias clientes</CardTitle>
                    <CardDescription>
                      Consulta somente leitura. Dados financeiros detalhados e credenciais não são
                      exibidos nesta tela.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Secretaria</TableHead>
                            <TableHead>Município</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Plano</TableHead>
                            <TableHead>Cadastro</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tenants.map((tenant) => (
                            <TableRow key={tenant.id}>
                              <TableCell className="font-medium">{tenant.name}</TableCell>
                              <TableCell>
                                {tenant.municipality
                                  ? `${tenant.municipality}${tenant.state ? ` / ${tenant.state}` : ""}`
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={tenant.status === "active" ? "default" : "secondary"}
                                >
                                  {STATUS[tenant.commercial_status] ??
                                    STATUS[tenant.status] ??
                                    tenant.status}
                                </Badge>
                              </TableCell>
                              <TableCell>{tenant.plan_tier}</TableCell>
                              <TableCell>
                                {new Intl.DateTimeFormat("pt-BR").format(
                                  new Date(tenant.created_at),
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {showPlans && (
              <TabsContent value="planos">
                <Card>
                  <CardHeader>
                    <CardTitle>Planos contratados</CardTitle>
                    <CardDescription>Distribuição dos clientes por plano.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {["basico", "profissional", "enterprise", "consorcio"].map((plan) => (
                      <div key={plan} className="rounded-lg border p-4">
                        <p className="text-sm text-muted-foreground">{plan}</p>
                        <p className="text-2xl font-semibold">
                          {tenants.filter((tenant) => tenant.plan_tier === plan).length}
                        </p>
                        <p className="text-xs text-muted-foreground">cliente(s)</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {showFinance && (
              <TabsContent value="financeiro">
                <Card>
                  <CardHeader>
                    <CardTitle>Resumo financeiro</CardTitle>
                    <CardDescription>
                      Valores consultivos. Tokens, chaves privadas e configuração do provedor
                      continuam inacessíveis.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border p-4">
                        <p className="text-sm text-muted-foreground">MRR estimado</p>
                        <p className="text-2xl font-semibold">
                          {metrics?.mrr_estimated == null
                            ? "—"
                            : new Intl.NumberFormat("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              }).format(metrics.mrr_estimated)}
                        </p>
                      </div>
                      <div className="rounded-lg border p-4">
                        <p className="text-sm text-muted-foreground">Secretarias ativas</p>
                        <p className="text-2xl font-semibold">
                          {metrics?.active_clients ??
                            tenants.filter((tenant) => tenant.commercial_status === "active")
                              .length}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Secretaria</TableHead>
                            <TableHead>Situação</TableHead>
                            <TableHead>Mensalidade</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tenants.map((tenant) => (
                            <TableRow key={tenant.id}>
                              <TableCell>{tenant.name}</TableCell>
                              <TableCell>
                                {STATUS[tenant.commercial_status] ?? tenant.commercial_status}
                              </TableCell>
                              <TableCell>
                                {tenant.monthly_fee == null
                                  ? "Restrito"
                                  : new Intl.NumberFormat("pt-BR", {
                                      style: "currency",
                                      currency: "BRL",
                                    }).format(tenant.monthly_fee)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {showMetrics && (
              <TabsContent value="metricas">
                <Card>
                  <CardHeader>
                    <CardTitle>Métricas globais</CardTitle>
                    <CardDescription>
                      Indicadores agregados, sem acesso aos registros operacionais individuais.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ["Clientes ativos", metrics?.active_clients],
                      ["Em demonstração", metrics?.trial_clients],
                      ["Bloqueados", metrics?.blocked_clients],
                      ["Suspensos", metrics?.suspended_clients],
                      ["Contratos", metrics?.contracts_total],
                      ["Processos", metrics?.processes_total],
                      ["Fornecedores", metrics?.suppliers_total],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg border p-4">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="text-2xl font-semibold">{value ?? "—"}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {showAudit && (
              <TabsContent value="auditoria">
                <Card>
                  <CardHeader>
                    <CardTitle>Auditoria da plataforma</CardTitle>
                    <CardDescription>
                      Eventos recentes. Payloads detalhados e dados sensíveis não são
                      disponibilizados.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Evento</TableHead>
                            <TableHead>Entidade</TableHead>
                            <TableHead>Secretaria</TableHead>
                            <TableHead>Ator</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {audit.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell>
                                {new Intl.DateTimeFormat("pt-BR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                }).format(new Date(row.created_at))}
                              </TableCell>
                              <TableCell>{row.action}</TableCell>
                              <TableCell>{row.entity}</TableCell>
                              <TableCell>{row.tenant_name ?? "—"}</TableCell>
                              <TableCell>{row.actor_email ?? "Sistema"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {canManageSupport && (
              <TabsContent value="suporte">
                <AdminMasterSupport
                  tenants={tenants.map(({ id, name }) => ({ id, name }))}
                  allowMasterSessions={false}
                />
              </TabsContent>
            )}
          </Tabs>
        )}
      </main>
    </div>
  );
}
