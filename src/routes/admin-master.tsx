import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileClock,
  FileText,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  usePlatformAdmin,
  type AdminCandidate,
  type CommercialTenantInput,
  type MasterTenant,
} from "@/hooks/use-platform-admin";
import { formatarCnpj, validarCnpj, normalizarCnpj } from "@/lib/cnpj";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin-master" as never)({
  head: () => ({
    meta: [
      { title: "Painel Master — Gestão de Fornecedores da Saúde" },
      { name: "description", content: "Backoffice global de clientes e operação comercial da plataforma." },
    ],
  }),
  component: AdminMaster,
});

const MODULES = [
  { key: "fornecedores", label: "Fornecedores e certidões", description: "Cadastro, contatos e documentos dos fornecedores." },
  { key: "processos", label: "Processos de contratação", description: "Fluxo de processos de contratação." },
  { key: "contratos", label: "Contratos e vencimentos", description: "Gestão de contratos, fiscais e prazos." },
  { key: "documentos", label: "Documentos", description: "Documentos gerados e gestão documental." },
  { key: "modelos", label: "Modelos oficiais", description: "DFD, ETP, Termo de Referência e modelos." },
  { key: "ged", label: "GED avançado", description: "Anexos e arquivos gerenciados." },
  { key: "auditoria", label: "Auditoria e relatórios", description: "Histórico, trilhas e relatórios." },
] as const;

type ModuleKey = (typeof MODULES)[number]["key"];
type Draft = CommercialTenantInput & { name: string; slug: string; adminUserId: string };
type CommercialStatus = "active" | "trial" | "blocked_billing" | "suspended" | "cancelled";
type PlanTier = "basico" | "profissional" | "enterprise" | "consorcio";

const EMPTY_DRAFT: Draft = {
  name: "",
  slug: "",
  adminUserId: "",
  trade_name: "",
  cnpj: "",
  municipality: "",
  state: "",
  ibge_code: "",
  manager_name: "",
  contact_email: "",
  contact_phone: "",
  commercial_status: "active",
  plan_tier: "profissional",
  trial_starts_at: null,
  trial_ends_at: null,
  monthly_fee: 0,
  billing_day: 10,
  billing_email: "",
  billing_contact: "",
  enabled_modules: {
    fornecedores: true,
    documentos: true,
    processos: true,
    contratos: true,
    modelos: true,
    ged: false,
    auditoria: true,
  },
  max_users: 20,
  commercial_notes: "",
  street: "",
};

const PLAN_LABELS: Record<PlanTier, string> = {
  basico: "Básico",
  profissional: "Profissional",
  enterprise: "Enterprise",
  consorcio: "Consórcio",
};

const STATUS_LABELS: Record<CommercialStatus, string> = {
  active: "Ativo",
  trial: "Em demonstração",
  blocked_billing: "Bloqueado por cobrança",
  suspended: "Suspenso",
  cancelled: "Cancelado",
};

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function dateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

function dateIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function dataCurta(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR").format(date);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "trial") return "secondary";
  if (status === "blocked_billing" || status === "cancelled") return "destructive";
  return "outline";
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: typeof Wallet;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function AdminMaster() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const {
    authorized,
    loading,
    error,
    tenants,
    metrics,
    candidates,
    auditEvents,
    refresh,
    createTenant,
    updateTenant,
    provisionLocalAdmin,
  } = usePlatformAdmin();

  const [tab, setTab] = useState("visao-geral");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterTenant | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provisionTenant, setProvisionTenant] = useState<MasterTenant | null>(null);
  const [provisionUser, setProvisionUser] = useState("");
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) {
      navigate({ to: "/entrar", replace: true });
    }
  }, [authLoading, session, navigate]);

  const trialsExpiring = useMemo(
    () =>
      tenants.filter(
        (tenant) =>
          tenant.commercial_status === "trial" &&
          !!tenant.trial_ends_at &&
          new Date(tenant.trial_ends_at).getTime() > Date.now() &&
          new Date(tenant.trial_ends_at).getTime() <= Date.now() + 7 * 86_400_000,
      ),
    [tenants],
  );

  const planCounts = useMemo(() => {
    const counts: Record<PlanTier, number> = {
      basico: 0,
      profissional: 0,
      enterprise: 0,
      consorcio: 0,
    };
    tenants.forEach((tenant) => {
      const plan = tenant.plan_tier as PlanTier;
      if (plan in counts) counts[plan] += 1;
    });
    return counts;
  }, [tenants]);

  function abrirNovoCliente() {
    setEditing(null);
    setDraft({
      ...EMPTY_DRAFT,
      trial_starts_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });
    setDialogOpen(true);
  }

  function abrirEdicao(tenant: MasterTenant) {
    setEditing(tenant);
    setDraft({
      ...EMPTY_DRAFT,
      name: tenant.name,
      slug: tenant.slug,
      trade_name: tenant.trade_name ?? "",
      cnpj: tenant.cnpj ? formatarCnpj(tenant.cnpj) : "",
      municipality: tenant.municipality ?? "",
      state: tenant.state ?? "",
      ibge_code: tenant.ibge_code ?? "",
      manager_name: tenant.manager_name ?? "",
      contact_email: tenant.contact_email ?? "",
      contact_phone: tenant.contact_phone ?? "",
      commercial_status: tenant.commercial_status,
      plan_tier: tenant.plan_tier,
      trial_starts_at: tenant.trial_starts_at,
      trial_ends_at: tenant.trial_ends_at,
      monthly_fee: Number(tenant.monthly_fee ?? 0),
      billing_day: tenant.billing_day,
      billing_email: tenant.billing_email ?? "",
      billing_contact: tenant.billing_contact ?? "",
      enabled_modules: (tenant.enabled_modules ?? EMPTY_DRAFT.enabled_modules) as Record<string, boolean>,
      max_users: tenant.max_users,
      commercial_notes: tenant.commercial_notes ?? "",
      street: tenant.street ?? "",
      adminUserId: "",
    });
    setDialogOpen(true);
  }

  function patchDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function patchModule(key: ModuleKey, checked: boolean) {
    setDraft((current) => ({
      ...current,
      enabled_modules: { ...current.enabled_modules, [key]: checked },
    }));
  }

  async function salvarCliente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.slug.trim()) {
      toast.error("Informe o nome e o identificador da Secretaria.");
      return;
    }
    if (draft.cnpj.trim() && !validarCnpj(draft.cnpj)) {
      toast.error("O CNPJ informado não passou na validação dos dígitos verificadores.");
      return;
    }
    if (!editing && !draft.adminUserId) {
      toast.error("Selecione uma conta confirmada para ser o administrador municipal.");
      return;
    }
    if (
      draft.commercial_status === "trial" &&
      (!draft.trial_starts_at || !draft.trial_ends_at || new Date(draft.trial_starts_at) >= new Date(draft.trial_ends_at))
    ) {
      toast.error("Informe datas válidas para o período de demonstração.");
      return;
    }

    setSaving(true);
    const details: CommercialTenantInput = {
      trade_name: draft.trade_name.trim(),
      cnpj: normalizarCnpj(draft.cnpj),
      municipality: draft.municipality.trim(),
      state: draft.state.trim().toUpperCase(),
      ibge_code: draft.ibge_code.trim(),
      manager_name: draft.manager_name.trim(),
      contact_email: draft.contact_email.trim(),
      contact_phone: draft.contact_phone.trim(),
      commercial_status: draft.commercial_status,
      plan_tier: draft.plan_tier,
      trial_starts_at: dateIso(draft.trial_starts_at ?? "") ,
      trial_ends_at: dateIso(draft.trial_ends_at ?? ""),
      monthly_fee: Number(draft.monthly_fee),
      billing_day: Number(draft.billing_day),
      billing_email: draft.billing_email.trim(),
      billing_contact: draft.billing_contact.trim(),
      enabled_modules: draft.enabled_modules,
      max_users: Number(draft.max_users),
      commercial_notes: draft.commercial_notes.trim(),
      street: draft.street.trim(),
    };

    try {
      if (editing) {
        await updateTenant(editing.id, {
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          trade_name: details.trade_name || null,
          cnpj: details.cnpj || null,
          municipality: details.municipality || null,
          state: details.state || null,
          ibge_code: details.ibge_code || null,
          manager_name: details.manager_name || null,
          contact_email: details.contact_email || null,
          contact_phone: details.contact_phone || null,
          street: details.street || null,
          commercial_status: details.commercial_status,
          plan_tier: details.plan_tier,
          trial_starts_at: details.trial_starts_at,
          trial_ends_at: details.trial_ends_at,
          monthly_fee: details.monthly_fee,
          billing_day: details.billing_day,
          billing_email: details.billing_email || null,
          billing_contact: details.billing_contact || null,
          enabled_modules: details.enabled_modules,
          max_users: details.max_users,
          commercial_notes: details.commercial_notes || null,
        });
        toast.success("Dados comerciais e institucionais atualizados.");
      } else {
        await createTenant(draft.name.trim(), draft.slug.trim(), draft.adminUserId, details);
        toast.success("Secretaria cadastrada e administrador local provisionado.");
      }
      setDialogOpen(false);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function atualizarStatus(tenant: MasterTenant, status: CommercialStatus) {
    try {
      await updateTenant(tenant.id, { commercial_status: status });
      toast.success(`Status de ${tenant.name} atualizado para ${STATUS_LABELS[status]}.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível atualizar o status.");
    }
  }

  async function prorrogarTrial(tenant: MasterTenant, days: number) {
    const currentEnd = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : new Date();
    const end = new Date(Math.max(currentEnd.getTime(), Date.now()));
    end.setDate(end.getDate() + days);
    try {
      await updateTenant(tenant.id, {
        commercial_status: "trial",
        trial_starts_at: tenant.trial_starts_at ?? new Date().toISOString(),
        trial_ends_at: end.toISOString(),
        status: "active",
      });
      toast.success(`Demonstração prorrogada por mais ${days} dias.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível prorrogar a demonstração.");
    }
  }

  function abrirProvisionamento(tenant: MasterTenant) {
    setProvisionTenant(tenant);
    setProvisionUser("");
    setProvisionOpen(true);
  }

  async function confirmarProvisionamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provisionTenant || !provisionUser) return;
    setProvisioning(true);
    try {
      await provisionLocalAdmin(provisionTenant.id, provisionUser);
      toast.success("Administrador local adicionado à Secretaria.");
      setProvisionOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível adicionar o administrador.");
    } finally {
      setProvisioning(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!session) return null;

  if (!authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
        <Card className="w-full max-w-lg border-destructive/30">
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <LockKeyhole className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle>Acesso restrito — código 403</CardTitle>
            <p className="text-sm text-muted-foreground">Esta área é exclusiva de administradores globais ativos da plataforma.</p>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button asChild variant="outline"><Link to="/painel">Voltar ao portal</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Backoffice SaaS</p>
              <h1 className="text-xl font-semibold tracking-tight">Painel Master</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.user.email}</span>
            <Button asChild variant="outline" size="sm"><Link to="/painel">Portal operacional</Link></Button>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            <AlertTitle>Alguns dados não puderam ser carregados</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="visao-geral"><LayoutDashboard className="mr-2 h-4 w-4" />Visão geral</TabsTrigger>
            <TabsTrigger value="clientes"><Building2 className="mr-2 h-4 w-4" />Clientes</TabsTrigger>
            <TabsTrigger value="planos"><Wallet className="mr-2 h-4 w-4" />Planos</TabsTrigger>
            <TabsTrigger value="metricas"><Activity className="mr-2 h-4 w-4" />Métricas</TabsTrigger>
            <TabsTrigger value="auditoria"><FileClock className="mr-2 h-4 w-4" />Auditoria global</TabsTrigger>
          </TabsList>

          <TabsContent value="visao-geral" className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Visão executiva</h2>
              <p className="mt-1 text-sm text-muted-foreground">Acompanhamento comercial e operacional de toda a plataforma.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="MRR estimado" value={money(metrics.mrr_estimated)} subtitle="Clientes ativos e adimplentes" icon={CircleDollarSign} />
              <MetricCard title="Clientes ativos" value={String(metrics.active_clients)} subtitle="Secretarias em operação" icon={Building2} />
              <MetricCard title="Em demonstração" value={String(metrics.trial_clients)} subtitle={`${metrics.trials_expiring_7d} vencem nos próximos 7 dias`} icon={Clock3} />
              <MetricCard title="Bloqueados" value={String(metrics.blocked_clients)} subtitle="Pendência de cobrança" icon={LockKeyhole} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div><CardTitle>Clientes que exigem atenção</CardTitle><p className="text-sm text-muted-foreground">Demonstrações próximas do fim e contas bloqueadas.</p></div>
                  <Badge variant={trialsExpiring.length ? "destructive" : "secondary"}>{trialsExpiring.length + metrics.blocked_clients}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {trialsExpiring.map((tenant) => (
                    <div key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0"><p className="truncate font-medium">{tenant.name}</p><p className="text-xs text-muted-foreground">Demonstração termina em {dataCurta(tenant.trial_ends_at)}</p></div>
                      <Badge variant="secondary">Trial próximo do fim</Badge>
                    </div>
                  ))}
                  {tenants.filter((tenant) => tenant.commercial_status === "blocked_billing").map((tenant) => (
                    <div key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 p-3">
                      <div className="min-w-0"><p className="truncate font-medium">{tenant.name}</p><p className="text-xs text-muted-foreground">Pendência financeira</p></div>
                      <Badge variant="destructive">Bloqueado</Badge>
                    </div>
                  ))}
                  {trialsExpiring.length === 0 && metrics.blocked_clients === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nenhum cliente exige ação imediata.</p>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setTab("clientes")}>Abrir gestão de clientes</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Resumo da plataforma</CardTitle><p className="text-sm text-muted-foreground">Volume total já registrado no banco.</p></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div><p className="text-2xl font-semibold">{metrics.contracts_total}</p><p className="text-xs text-muted-foreground">Contratos</p></div>
                  <div><p className="text-2xl font-semibold">{metrics.processes_total}</p><p className="text-xs text-muted-foreground">Processos</p></div>
                  <div><p className="text-2xl font-semibold">{metrics.suppliers_total}</p><p className="text-xs text-muted-foreground">Fornecedores</p></div>
                  <div><p className="text-2xl font-semibold">{metrics.audit_events_total}</p><p className="text-xs text-muted-foreground">Eventos de auditoria</p></div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="clientes" className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-2xl font-semibold tracking-tight">Clientes e secretarias</h2><p className="mt-1 text-sm text-muted-foreground">Controle institucional, comercial, cobrança e módulos contratados.</p></div>
              <Button onClick={abrirNovoCliente}><Plus className="mr-2 h-4 w-4" aria-hidden />Novo cliente</Button>
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Secretaria</TableHead><TableHead>Plano</TableHead><TableHead>Situação comercial</TableHead><TableHead>Mensalidade</TableHead><TableHead>Trial</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {tenants.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhum cliente cadastrado. Cadastre a primeira Secretaria para iniciar a operação comercial.</TableCell></TableRow>
                    ) : tenants.map((tenant) => (
                      <TableRow key={tenant.id}>
                        <TableCell className="min-w-[220px]"><p className="font-medium">{tenant.trade_name || tenant.name}</p><p className="text-xs text-muted-foreground">{tenant.municipality || "Município não informado"}{tenant.state ? ` / ${tenant.state}` : ""}</p></TableCell>
                        <TableCell>{PLAN_LABELS[tenant.plan_tier as PlanTier] ?? tenant.plan_tier}</TableCell>
                        <TableCell><Badge variant={statusVariant(tenant.commercial_status)}>{STATUS_LABELS[tenant.commercial_status as CommercialStatus] ?? tenant.commercial_status}</Badge></TableCell>
                        <TableCell>{money(Number(tenant.monthly_fee ?? 0))}</TableCell>
                        <TableCell className="whitespace-nowrap">{tenant.commercial_status === "trial" ? dataCurta(tenant.trial_ends_at) : "—"}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="sm" onClick={() => abrirEdicao(tenant)}>Configurar</Button>
                            {tenant.commercial_status === "blocked_billing" || tenant.commercial_status === "suspended" ? (
                              <Button size="sm" onClick={() => void atualizarStatus(tenant, "active")}>Reativar</Button>
                            ) : tenant.commercial_status !== "cancelled" ? (
                              <Button variant="destructive" size="sm" onClick={() => void atualizarStatus(tenant, "blocked_billing")}>Bloquear</Button>
                            ) : null}
                            <Select onValueChange={(value) => void prorrogarTrial(tenant, Number(value))}>
                              <SelectTrigger className="h-9 w-[118px]" aria-label={`Prorrogar demonstração de ${tenant.name}`}><SelectValue placeholder="Trial" /></SelectTrigger>
                              <SelectContent><SelectItem value="7">+7 dias</SelectItem><SelectItem value="15">+15 dias</SelectItem><SelectItem value="30">+30 dias</SelectItem></SelectContent>
                            </Select>
                            <Button variant="ghost" size="sm" onClick={() => abrirProvisionamento(tenant)}><Users className="h-4 w-4" aria-hidden /><span className="sr-only">Adicionar administrador</span></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="planos" className="space-y-6">
            <div><h2 className="text-2xl font-semibold tracking-tight">Planos comerciais</h2><p className="mt-1 text-sm text-muted-foreground">Distribuição dos clientes por plano cadastrado.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(["basico", "profissional", "enterprise", "consorcio"] as PlanTier[]).map((plan) => (
                <Card key={plan}><CardHeader><CardTitle className="text-base">{PLAN_LABELS[plan]}</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{planCounts[plan]}</p><p className="text-xs text-muted-foreground">clientes neste plano</p></CardContent></Card>
              ))}
            </div>
            <Alert><CheckCircle2 className="h-4 w-4" aria-hidden /><AlertTitle>Planos configuráveis por cliente</AlertTitle><AlertDescription>O plano e a mensalidade são registrados no cadastro de cada Secretaria. A cobrança ainda é informativa; não há emissão automática de boleto ou integração financeira nesta etapa.</AlertDescription></Alert>
          </TabsContent>

          <TabsContent value="metricas" className="space-y-6">
            <div><h2 className="text-2xl font-semibold tracking-tight">Métricas globais</h2><p className="mt-1 text-sm text-muted-foreground">Indicadores consolidados do ambiente SaaS.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="MRR estimado" value={money(metrics.mrr_estimated)} subtitle="Soma das mensalidades ativas" icon={CircleDollarSign} />
              <MetricCard title="Clientes ativos" value={String(metrics.active_clients)} subtitle="Ativos e com instituição ativa" icon={Building2} />
              <MetricCard title="Demonstrações" value={String(metrics.trial_clients)} subtitle={`${metrics.trials_expiring_7d} vencem em até 7 dias`} icon={CalendarClock} />
              <MetricCard title="Bloqueados" value={String(metrics.blocked_clients)} subtitle="Bloqueio por cobrança" icon={LockKeyhole} />
              <MetricCard title="Suspensos" value={String(metrics.suspended_clients)} subtitle="Suspensão comercial ou institucional" icon={AlertCircle} />
              <MetricCard title="Cancelados" value={String(metrics.cancelled_clients)} subtitle="Contas canceladas ou encerradas" icon={XCircle} />
              <MetricCard title="Contratos" value={String(metrics.contracts_total)} subtitle="Volume global registrado" icon={FileText} />
              <MetricCard title="Processos" value={String(metrics.processes_total)} subtitle="Volume global registrado" icon={Activity} />
            </div>
          </TabsContent>

          <TabsContent value="auditoria" className="space-y-6">
            <div><h2 className="text-2xl font-semibold tracking-tight">Auditoria global</h2><p className="mt-1 text-sm text-muted-foreground">Eventos mais recentes registrados pela plataforma.</p></div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Evento</TableHead><TableHead>Entidade</TableHead><TableHead>Identificador</TableHead><TableHead>Ator</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {auditEvents.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Nenhum evento registrado.</TableCell></TableRow> : auditEvents.map((event) => (
                      <TableRow key={event.id}><TableCell className="whitespace-nowrap">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.created_at))}</TableCell><TableCell><Badge variant={event.action === "ACCESS_DENIED" ? "destructive" : "outline"}>{event.action}</Badge></TableCell><TableCell>{event.entity}</TableCell><TableCell className="max-w-[220px] truncate">{event.entity_id ?? "—"}</TableCell><TableCell className="max-w-[180px] truncate">{event.actor_id ?? "Sistema"}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Configurar cliente" : "Cadastrar nova Secretaria"}</DialogTitle>
            <DialogDescription>Dados institucionais e comerciais. O isolamento de dados é aplicado pelo banco SMS2.</DialogDescription>
          </DialogHeader>
          <form onSubmit={salvarCliente} className="space-y-5">
            <Tabs defaultValue="institucional" className="space-y-4">
              <TabsList><TabsTrigger value="institucional">Institucional</TabsTrigger><TabsTrigger value="comercial">Comercial e módulos</TabsTrigger></TabsList>
              <TabsContent value="institucional" className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2"><Label htmlFor="tenant-name">Razão social / Nome institucional</Label><Input id="tenant-name" value={draft.name} onChange={(e) => { patchDraft("name", e.target.value); if (!editing) patchDraft("slug", slugify(e.target.value)); }} required minLength={3} maxLength={160} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-trade-name">Nome fantasia / Apelido</Label><Input id="tenant-trade-name" value={draft.trade_name} onChange={(e) => patchDraft("trade_name", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-cnpj">CNPJ</Label><Input id="tenant-cnpj" value={draft.cnpj} onChange={(e) => patchDraft("cnpj", formatarCnpj(e.target.value))} placeholder="00.000.000/0000-00" maxLength={18} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-municipality">Município</Label><Input id="tenant-municipality" value={draft.municipality} onChange={(e) => patchDraft("municipality", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-state">UF</Label><Input id="tenant-state" value={draft.state} onChange={(e) => patchDraft("state", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="PA" /></div>
                <div className="space-y-2"><Label htmlFor="tenant-ibge">Código IBGE do município</Label><Input id="tenant-ibge" value={draft.ibge_code} onChange={(e) => patchDraft("ibge_code", e.target.value.replace(/\D/g, "").slice(0, 7))} maxLength={7} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-manager">Secretário / Gestor principal</Label><Input id="tenant-manager" value={draft.manager_name} onChange={(e) => patchDraft("manager_name", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-contact-email">E-mail institucional</Label><Input id="tenant-contact-email" type="email" value={draft.contact_email} onChange={(e) => patchDraft("contact_email", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="tenant-contact-phone">WhatsApp / Telefone</Label><Input id="tenant-contact-phone" value={draft.contact_phone} onChange={(e) => patchDraft("contact_phone", e.target.value)} /></div>
                <div className="space-y-2 md:col-span-2"><Label htmlFor="tenant-street">Endereço</Label><Input id="tenant-street" value={draft.street} onChange={(e) => patchDraft("street", e.target.value)} /></div>
                {!editing && <div className="space-y-2 md:col-span-2"><Label htmlFor="tenant-admin">Primeiro administrador municipal (conta confirmada)</Label><Select value={draft.adminUserId} onValueChange={(value) => patchDraft("adminUserId", value)}><SelectTrigger id="tenant-admin"><SelectValue placeholder="Selecione um usuário cadastrado" /></SelectTrigger><SelectContent>{candidates.map((candidate: AdminCandidate) => <SelectItem key={candidate.user_id} value={candidate.user_id}>{candidate.full_name} · {candidate.email}</SelectItem>)}</SelectContent></Select>{candidates.length === 0 && <p className="text-xs text-muted-foreground">Nenhum usuário confirmado disponível. Cadastre a conta do administrador local e confirme o e-mail antes de criar a Secretaria.</p>}</div>}
                <div className="space-y-2 md:col-span-2"><Label htmlFor="tenant-slug">Identificador interno</Label><Input id="tenant-slug" value={draft.slug} onChange={(e) => patchDraft("slug", slugify(e.target.value))} required minLength={3} maxLength={63} /></div>
              </TabsContent>
              <TabsContent value="comercial" className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2"><Label>Situação comercial</Label><Select value={draft.commercial_status} onValueChange={(value) => patchDraft("commercial_status", value as CommercialStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Plano</Label><Select value={draft.plan_tier} onValueChange={(value) => patchDraft("plan_tier", value as PlanTier)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PLAN_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                  {draft.commercial_status === "trial" && <>
                    <div className="space-y-2"><Label htmlFor="trial-start">Início da demonstração</Label><Input id="trial-start" type="datetime-local" value={dateInput(draft.trial_starts_at)} onChange={(e) => patchDraft("trial_starts_at", dateIso(e.target.value))} required /></div>
                    <div className="space-y-2"><Label htmlFor="trial-end">Expiração da demonstração</Label><Input id="trial-end" type="datetime-local" value={dateInput(draft.trial_ends_at)} onChange={(e) => patchDraft("trial_ends_at", dateIso(e.target.value))} required /></div>
                  </>}
                  <div className="space-y-2"><Label htmlFor="monthly-fee">Mensalidade (R$)</Label><Input id="monthly-fee" type="number" inputMode="decimal" min="0" step="0.01" value={draft.monthly_fee} onChange={(e) => patchDraft("monthly_fee", Number(e.target.value))} /></div>
                  <div className="space-y-2"><Label htmlFor="billing-day">Dia de vencimento</Label><Input id="billing-day" type="number" min="1" max="31" value={draft.billing_day} onChange={(e) => patchDraft("billing_day", Number(e.target.value))} /></div>
                  <div className="space-y-2"><Label htmlFor="billing-email">E-mail financeiro</Label><Input id="billing-email" type="email" value={draft.billing_email} onChange={(e) => patchDraft("billing_email", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="billing-contact">Contato financeiro</Label><Input id="billing-contact" value={draft.billing_contact} onChange={(e) => patchDraft("billing_contact", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="max-users">Limite de usuários ativos</Label><Input id="max-users" type="number" min="1" value={draft.max_users} onChange={(e) => patchDraft("max_users", Number(e.target.value))} /></div>
                </div>
                <div className="space-y-3">
                  <div><h3 className="font-medium">Módulos liberados</h3><p className="text-sm text-muted-foreground">A desativação é aplicada no menu, nas rotas e no banco de dados.</p></div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {MODULES.map((module) => (
                      <div key={module.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0"><Label htmlFor={`module-${module.key}`} className="cursor-pointer">{module.label}</Label><p className="text-xs text-muted-foreground">{module.description}</p></div>
                        <Switch id={`module-${module.key}`} checked={draft.enabled_modules[module.key] === true} onCheckedChange={(checked) => patchModule(module.key, checked)} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2"><Label htmlFor="commercial-notes">Observações comerciais</Label><Textarea id="commercial-notes" rows={3} value={draft.commercial_notes} onChange={(e) => patchDraft("commercial_notes", e.target.value)} /></div>
              </TabsContent>
            </Tabs>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving || (!editing && candidates.length === 0)}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}{editing ? "Salvar alterações" : "Criar Secretaria"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Provisionar administrador local</DialogTitle><DialogDescription>Selecione uma conta confirmada para receber o papel de administrador da Secretaria {provisionTenant?.name}.</DialogDescription></DialogHeader>
          <form onSubmit={confirmarProvisionamento} className="space-y-4">
            <div className="space-y-2"><Label>Usuário confirmado</Label><Select value={provisionUser} onValueChange={setProvisionUser}><SelectTrigger><SelectValue placeholder="Selecione uma conta" /></SelectTrigger><SelectContent>{candidates.map((candidate) => <SelectItem key={candidate.user_id} value={candidate.user_id}>{candidate.full_name} · {candidate.email}</SelectItem>)}</SelectContent></Select></div>
            {candidates.length === 0 && <Alert><AlertDescription>Não há outras contas confirmadas disponíveis para provisionamento.</AlertDescription></Alert>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setProvisionOpen(false)}>Cancelar</Button><Button type="submit" disabled={provisioning || !provisionUser}>{provisioning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Adicionar administrador</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
