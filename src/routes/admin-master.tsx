import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Building2,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  Clock3,
  Download,
  FileClock,
  FileText,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  Settings2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { exportToXlsx } from "@/lib/xlsx-export";
import {
  agruparClientesPorPlano,
  agruparClientesPorStatus,
  aplicarTemplatePlanoNoDraft,
  avaliarCotaIa,
  filtrarAuditoriaMaster,
  filtrarClientesMaster,
  type PlatformPlanTemplate,
} from "@/lib/admin-master-helper";
import { MasterBillingSettings } from "@/components/admin-master-billing";
import { AdminMasterSupport } from "@/components/admin-master-support";
import { AdminMasterStaff } from "@/components/admin-master-staff";
import { AdminMasterConfiguration } from "@/components/admin-master-configuration";
import { AdminMasterAi } from "@/components/admin-master-ai";
import { PlatformStaffWorkspace } from "@/components/platform-staff-workspace";
import { TenantProvider } from "@/hooks/use-tenant";
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

export const Route = createFileRoute("/admin-master")({
  head: () => ({
    meta: [
      { title: "Painel Master — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Backoffice global de clientes e operação comercial da plataforma.",
      },
    ],
  }),
  component: AdminMasterPage,
});

const MODULES = [
  {
    key: "fornecedores",
    label: "Fornecedores e certidões",
    description: "Cadastro, contatos e documentos dos fornecedores.",
  },
  {
    key: "processos",
    label: "Processos de contratação",
    description: "Fluxo de processos de contratação.",
  },
  {
    key: "contratos",
    label: "Contratos e vencimentos",
    description: "Gestão de contratos, fiscais e prazos.",
  },
  {
    key: "documentos",
    label: "Documentos",
    description: "Documentos gerados e gestão documental.",
  },
  {
    key: "modelos",
    label: "Modelos oficiais",
    description: "DFD, ETP, Termo de Referência e modelos.",
  },
  {
    key: "ged",
    label: "GED avançado",
    description:
      "Recursos avançados do GED. Upload e armazenamento privados básicos já estão disponíveis em Documentos.",
  },
  {
    key: "auditoria",
    label: "Auditoria e histórico",
    description: "Histórico e trilhas operacionais.",
  },
  {
    key: "relatorios",
    label: "Relatórios & BI",
    description: "Central de relatórios executivos, gráficos e exportações.",
  },
  {
    key: "pca",
    label: "Plano Anual (PCA)",
    description: "Planejamento anual de contratações e consolidação de demandas.",
  },
] as const;

type ModuleKey = (typeof MODULES)[number]["key"];
type Draft = CommercialTenantInput & {
  name: string;
  slug: string;
  adminUserId: string;
  aiBudgetUsd: string;
  aiTokenLimit: string;
};
type CommercialStatus = "active" | "trial" | "blocked_billing" | "suspended" | "cancelled";
type PlanTier = "basico" | "profissional" | "enterprise" | "consorcio";

const EMPTY_DRAFT: Draft = {
  name: "",
  slug: "",
  adminUserId: "",
  aiBudgetUsd: "",
  aiTokenLimit: "",
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
    relatorios: true,
    pca: true,
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
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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
    isPlatformAdmin,
    staffAccess,
    loading,
    error,
    tenants,
    metrics,
    candidates,
    auditEvents,
    activeUsersByTenant,
    aiEnabledByTenant,
    aiUsageByTenant,
    plans,
    plansBackedByDatabase,
    aiLimitsByTenant,
    refresh,
    createTenant,
    updateTenant,
    provisionLocalAdmin,
    savePlan,
    saveTenantAiLimits,
  } = usePlatformAdmin();

  const [tab, setTab] = useState("visao-geral");
  const [clienteBusca, setClienteBusca] = useState("");
  const [clienteStatusFiltro, setClienteStatusFiltro] = useState("todos");
  const [clientePlanoFiltro, setClientePlanoFiltro] = useState("todos");
  const [auditoriaBusca, setAuditoriaBusca] = useState("");
  const [auditoriaAcaoFiltro, setAuditoriaAcaoFiltro] = useState("todas");
  const [auditoriaEntidadeFiltro, setAuditoriaEntidadeFiltro] = useState("todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterTenant | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<PlatformPlanTemplate | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
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

  const tenantNameById = useMemo(
    () => new Map(tenants.map((t) => [t.id, t.trade_name || t.name])),
    [tenants],
  );

  const planById = useMemo(() => {
    const map = new Map<string, PlatformPlanTemplate>();
    for (const plan of plans) map.set(plan.id, plan);
    return map;
  }, [plans]);

  const clientesFiltrados = useMemo(
    () =>
      filtrarClientesMaster(tenants, {
        busca: clienteBusca,
        status: clienteStatusFiltro,
        plano: clientePlanoFiltro,
      }),
    [tenants, clienteBusca, clienteStatusFiltro, clientePlanoFiltro],
  );

  const acoesAuditoria = useMemo(
    () => Array.from(new Set(auditEvents.map((e) => e.action))).sort(),
    [auditEvents],
  );

  const entidadesAuditoria = useMemo(
    () => Array.from(new Set(auditEvents.map((e) => e.entity))).sort(),
    [auditEvents],
  );

  const auditoriaFiltrada = useMemo(
    () =>
      filtrarAuditoriaMaster(auditEvents, {
        busca: auditoriaBusca,
        acao: auditoriaAcaoFiltro,
        entidade: auditoriaEntidadeFiltro,
      }),
    [auditEvents, auditoriaBusca, auditoriaAcaoFiltro, auditoriaEntidadeFiltro],
  );

  const dadosGraficoPlano = useMemo(
    () => agruparClientesPorPlano(tenants, PLAN_LABELS),
    [tenants],
  );

  const dadosGraficoStatus = useMemo(
    () => agruparClientesPorStatus(tenants, STATUS_LABELS),
    [tenants],
  );

  async function exportarAuditoriaXlsx() {
    try {
      const columns = [
        {
          header: "Data/Hora",
          value: (ev: (typeof auditoriaFiltrada)[number]) =>
            new Intl.DateTimeFormat("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(ev.created_at)),
        },
        { header: "Ação", value: (ev: (typeof auditoriaFiltrada)[number]) => ev.action },
        { header: "Entidade", value: (ev: (typeof auditoriaFiltrada)[number]) => ev.entity },
        {
          header: "Secretaria",
          value: (ev: (typeof auditoriaFiltrada)[number]) =>
            ev.tenant_id ? (tenantNameById.get(ev.tenant_id) ?? ev.tenant_id) : "Global",
        },
        {
          header: "Identificador",
          value: (ev: (typeof auditoriaFiltrada)[number]) => ev.entity_id ?? "—",
        },
        {
          header: "Ator",
          value: (ev: (typeof auditoriaFiltrada)[number]) => ev.actor_id ?? "Sistema",
        },
      ];
      await exportToXlsx("auditoria-global-primus", columns, auditoriaFiltrada);
      toast.success("Auditoria global exportada em XLSX.");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível exportar a auditoria.",
      );
    }
  }

  function aplicarTemplatePlano(planId: PlanTier) {
    const template = planById.get(planId);
    if (!template) {
      patchDraft("plan_tier", planId);
      return;
    }
    setDraft((current) => {
      const next = aplicarTemplatePlanoNoDraft(current, template);
      return {
        ...next,
        aiBudgetUsd:
          template.default_ai_monthly_budget_usd === null
            ? ""
            : String(template.default_ai_monthly_budget_usd),
        aiTokenLimit:
          template.default_ai_monthly_token_limit === null
            ? ""
            : String(template.default_ai_monthly_token_limit),
      };
    });
  }

  function abrirNovoCliente() {
    setEditing(null);
    const defaultPlan = planById.get("profissional");
    const baseDraft: Draft = {
      ...EMPTY_DRAFT,
      trial_starts_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    };
    setDraft(
      defaultPlan
        ? {
            ...aplicarTemplatePlanoNoDraft(baseDraft, defaultPlan),
            aiBudgetUsd:
              defaultPlan.default_ai_monthly_budget_usd === null
                ? ""
                : String(defaultPlan.default_ai_monthly_budget_usd),
            aiTokenLimit:
              defaultPlan.default_ai_monthly_token_limit === null
                ? ""
                : String(defaultPlan.default_ai_monthly_token_limit),
          }
        : baseDraft,
    );
    setDialogOpen(true);
  }

  function abrirEdicao(tenant: MasterTenant) {
    setEditing(tenant);
    const aiQuota = aiLimitsByTenant[tenant.id];
    const mergedModules = {
      ...EMPTY_DRAFT.enabled_modules,
      ...((tenant.enabled_modules ?? {}) as Record<string, boolean>),
    };
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
      enabled_modules: mergedModules,
      max_users: tenant.max_users,
      commercial_notes: tenant.commercial_notes ?? "",
      street: tenant.street ?? "",
      adminUserId: "",
      aiBudgetUsd:
        aiQuota?.monthly_budget_usd != null ? String(aiQuota.monthly_budget_usd) : "",
      aiTokenLimit:
        aiQuota?.monthly_token_limit != null ? String(aiQuota.monthly_token_limit) : "",
    });
    setDialogOpen(true);
  }

  function abrirEdicaoPlano(plan: PlatformPlanTemplate) {
    setPlanDraft({
      ...plan,
      default_modules: {
        ...EMPTY_DRAFT.enabled_modules,
        ...plan.default_modules,
      },
    });
    setPlanDialogOpen(true);
  }

  async function salvarPlanoCatalogo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!planDraft) return;
    setSavingPlan(true);
    try {
      await savePlan(planDraft);
      toast.success(`Plano ${planDraft.name} atualizado no catálogo.`);
      setPlanDialogOpen(false);
      setPlanDraft(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível salvar as regras do plano.",
      );
    } finally {
      setSavingPlan(false);
    }
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
      (!draft.trial_starts_at ||
        !draft.trial_ends_at ||
        new Date(draft.trial_starts_at) >= new Date(draft.trial_ends_at))
    ) {
      toast.error("Informe datas válidas para o período de demonstração.");
      return;
    }

    const parsedBudget =
      draft.aiBudgetUsd.trim() === "" ? null : Number(draft.aiBudgetUsd.replace(",", "."));
    const parsedTokens =
      draft.aiTokenLimit.trim() === "" ? null : Math.round(Number(draft.aiTokenLimit));
    if (parsedBudget !== null && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
      toast.error("Informe um orçamento mensal de IA válido (>= 0).");
      return;
    }
    if (parsedTokens !== null && (!Number.isFinite(parsedTokens) || parsedTokens < 0)) {
      toast.error("Informe um limite mensal de tokens válido (>= 0).");
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
      trial_starts_at: dateIso(draft.trial_starts_at ?? ""),
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
      let targetTenantId: string | null = editing ? editing.id : null;
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
      } else {
        const created = await createTenant(
          draft.name.trim(),
          draft.slug.trim(),
          draft.adminUserId,
          details,
        );
        targetTenantId = created?.tenant_id ?? null;
      }

      const previousQuota = editing ? aiLimitsByTenant[editing.id] : undefined;
      const quotaChanged =
        (parsedBudget ?? null) !== (previousQuota?.monthly_budget_usd ?? null) ||
        (parsedTokens ?? null) !== (previousQuota?.monthly_token_limit ?? null);

      if (targetTenantId && (quotaChanged || (!editing && (parsedBudget !== null || parsedTokens !== null)))) {
        try {
          await saveTenantAiLimits(targetTenantId, parsedBudget, parsedTokens);
        } catch {
          toast.warning(
            "Cliente salvo, mas a cota de IA não foi gravada porque a migration SQL ainda precisa ser aplicada no banco.",
          );
        }
      }

      toast.success(
        editing
          ? "Dados comerciais e institucionais atualizados."
          : "Secretaria cadastrada e administrador local provisionado.",
      );
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
      await updateTenant(tenant.id, {
        commercial_status: status,
        ...(status === "active" ? { status: "active" as const } : {}),
      });
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
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível prorrogar a demonstração.",
      );
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
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível adicionar o administrador.",
      );
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

  if (authorized && !isPlatformAdmin && staffAccess) {
    return <PlatformStaffWorkspace access={staffAccess} />;
  }

  if (!authorized || !isPlatformAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
        <Card className="w-full max-w-lg border-destructive/30">
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <LockKeyhole className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle>Acesso restrito — código 403</CardTitle>
            <p className="text-sm text-muted-foreground">
              Esta área é exclusiva de administradores globais ativos da plataforma.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button asChild variant="outline">
              <Link to="/painel">Voltar ao portal</Link>
            </Button>
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
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Backoffice SaaS
              </p>
              <h1 className="text-xl font-semibold tracking-tight">Painel Master</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.email}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link to="/painel">Portal operacional</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" aria-hidden />
            <AlertTitle>Alguns dados não puderam ser carregados</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="grid gap-6 lg:grid-cols-[240px_1fr] lg:items-start"
        >
          {/* Navegação mobile compacta */}
          <div className="lg:hidden">
            <Label htmlFor="master-nav-mobile" className="sr-only">
              Seção do Painel Master
            </Label>
            <Select value={tab} onValueChange={setTab}>
              <SelectTrigger id="master-nav-mobile" className="w-full bg-card">
                <SelectValue placeholder="Selecione a área" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="visao-geral">Dashboard Executivo</SelectItem>
                <SelectItem value="clientes">Clientes e Secretarias</SelectItem>
                <SelectItem value="planos">Planos Comerciais</SelectItem>
                <SelectItem value="cobranca">Cobrança e Gateway</SelectItem>
                <SelectItem value="ia">Inteligência Artificial</SelectItem>
                <SelectItem value="configuracoes">Configuração Técnica</SelectItem>
                <SelectItem value="auditoria">Auditoria Global</SelectItem>
                <SelectItem value="equipe-interna">Equipe Interna</SelectItem>
                <SelectItem value="suporte">Equipe de Suporte</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Menu lateral organizado do Backoffice SaaS */}
          <aside className="hidden rounded-xl border bg-card p-3 lg:sticky lg:top-6 lg:block">
            <nav aria-label="Navegação do Painel Master" className="space-y-5">
              {[
                {
                  grupo: "Visão Executiva",
                  itens: [
                    { id: "visao-geral", label: "Dashboard Executivo", icon: LayoutDashboard },
                  ],
                },
                {
                  grupo: "Comercial & Clientes",
                  itens: [
                    { id: "clientes", label: "Clientes e Secretarias", icon: Building2 },
                    { id: "planos", label: "Planos Comerciais", icon: Wallet },
                    { id: "cobranca", label: "Cobrança e Gateway", icon: CreditCard },
                  ],
                },
                {
                  grupo: "IA & Infraestrutura",
                  itens: [
                    { id: "ia", label: "Inteligência Artificial", icon: Sparkles },
                    { id: "configuracoes", label: "Configuração Técnica", icon: Settings2 },
                  ],
                },
                {
                  grupo: "Governança & Equipes",
                  itens: [
                    { id: "auditoria", label: "Auditoria Global", icon: FileClock },
                    { id: "equipe-interna", label: "Equipe Interna", icon: Users },
                    { id: "suporte", label: "Equipe de Suporte", icon: Users },
                  ],
                },
              ].map((secao) => (
                <div key={secao.grupo} className="space-y-1">
                  <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {secao.grupo}
                  </p>
                  <div className="space-y-0.5">
                    {secao.itens.map((item) => {
                      const Icon = item.icon;
                      const active = tab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setTab(item.id)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground font-medium shadow-xs"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 space-y-6">
            {/* 1. DASHBOARD EXECUTIVO (Visão Geral + Métricas unificadas com gráficos) */}
            <TabsContent value="visao-geral" className="mt-0 space-y-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Dashboard Executivo</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Visão consolidada comercial, operacional e de uso de toda a plataforma SaaS.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  title="MRR estimado"
                  value={money(metrics.mrr_estimated)}
                  subtitle="Clientes ativos e adimplentes"
                  icon={CircleDollarSign}
                />
                <MetricCard
                  title="Clientes ativos"
                  value={String(metrics.active_clients)}
                  subtitle="Secretarias em operação"
                  icon={Building2}
                />
                <MetricCard
                  title="Em demonstração"
                  value={String(metrics.trial_clients)}
                  subtitle={`${metrics.trials_expiring_7d} vencem nos próximos 7 dias`}
                  icon={Clock3}
                />
                <MetricCard
                  title="Bloqueados / Suspensos"
                  value={String(metrics.blocked_clients + metrics.suspended_clients)}
                  subtitle={`${metrics.blocked_clients} cobrança · ${metrics.suspended_clients} suspensão`}
                  icon={LockKeyhole}
                />
                <MetricCard
                  title="Contratos"
                  value={String(metrics.contracts_total)}
                  subtitle="Volume global registrado"
                  icon={FileText}
                />
                <MetricCard
                  title="Processos"
                  value={String(metrics.processes_total)}
                  subtitle="Volume global registrado"
                  icon={Activity}
                />
                <MetricCard
                  title="Fornecedores"
                  value={String(metrics.suppliers_total)}
                  subtitle="Cadastros nas Secretarias"
                  icon={Users}
                />
                <MetricCard
                  title="Cancelados / Auditoria"
                  value={String(metrics.audit_events_total)}
                  subtitle={`${metrics.cancelled_clients} contas canceladas`}
                  icon={XCircle}
                />
              </div>

              {/* Gráficos Recharts do SaaS */}
              <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      Distribuição de Clientes por Plano
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {tenants.length === 0 ? (
                      <p className="py-12 text-center text-sm text-muted-foreground">
                        Nenhum cliente cadastrado para gerar gráfico.
                      </p>
                    ) : (
                      <div className="h-60 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={dadosGraficoPlano}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                            <XAxis dataKey="nome" tick={{ fontSize: 12 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                            <Tooltip
                              formatter={(val: unknown) => [String(val), "Clientes"]}
                              contentStyle={{
                                backgroundColor: "var(--background)",
                                borderColor: "var(--border)",
                                fontSize: "12px",
                                borderRadius: "8px",
                              }}
                            />
                            <Bar dataKey="clientes" radius={[4, 4, 0, 0]} fill="#0f766e" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      Situação Comercial da Base
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dadosGraficoStatus.length === 0 ? (
                      <p className="py-12 text-center text-sm text-muted-foreground">
                        Nenhum dado disponível.
                      </p>
                    ) : (
                      <div className="h-60 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={dadosGraficoStatus}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                            <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                            <Tooltip
                              formatter={(val: unknown) => [String(val), "Secretarias"]}
                              contentStyle={{
                                backgroundColor: "var(--background)",
                                borderColor: "var(--border)",
                                fontSize: "12px",
                                borderRadius: "8px",
                              }}
                            />
                            <Bar dataKey="quantidade" radius={[4, 4, 0, 0]}>
                              {dadosGraficoStatus.map((entry, idx) => (
                                <Cell
                                  key={entry.status}
                                  fill={
                                    entry.status === "active"
                                      ? "#10b981"
                                      : entry.status === "trial"
                                        ? "#0284c7"
                                        : entry.status === "blocked_billing"
                                          ? "#ef4444"
                                          : ["#f59e0b", "#64748b"][idx % 2]
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Clientes que exigem atenção</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Demonstrações próximas do fim e contas bloqueadas.
                      </p>
                    </div>
                    <Badge variant={trialsExpiring.length ? "destructive" : "secondary"}>
                      {trialsExpiring.length + metrics.blocked_clients}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {trialsExpiring.map((tenant) => (
                      <div
                        key={tenant.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Demonstração termina em {dataCurta(tenant.trial_ends_at)}
                          </p>
                        </div>
                        <Badge variant="secondary">Trial próximo do fim</Badge>
                      </div>
                    ))}
                    {tenants
                      .filter((tenant) => tenant.commercial_status === "blocked_billing")
                      .map((tenant) => (
                        <div
                          key={tenant.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{tenant.name}</p>
                            <p className="text-xs text-muted-foreground">Pendência financeira</p>
                          </div>
                          <Badge variant="destructive">Bloqueado</Badge>
                        </div>
                      ))}
                    {trialsExpiring.length === 0 && metrics.blocked_clients === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Nenhum cliente exige ação imediata.
                      </p>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setTab("clientes")}>
                      Abrir gestão de clientes
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Resumo operacional</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Indicadores rápidos de adoção e governança.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <span className="text-muted-foreground">Total de Secretarias</span>
                      <span className="font-semibold tabular-nums">{tenants.length}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <span className="text-muted-foreground">Usuários ativos nas Secretarias</span>
                      <span className="font-semibold tabular-nums">
                        {Object.values(activeUsersByTenant).reduce((a, b) => a + b, 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <span className="text-muted-foreground">Secretarias com IA ativa</span>
                      <span className="font-semibold tabular-nums">
                        {Object.values(aiEnabledByTenant).filter((a) => a.enabled).length}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* 2. CLIENTES E SECRETARIAS */}
            <TabsContent value="clientes" className="mt-0 space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Clientes e secretarias</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Controle institucional, comercial, usuários ativos, IA e módulos contratados.
                  </p>
                </div>
                <Button onClick={abrirNovoCliente}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  Novo cliente
                </Button>
              </div>

              {/* Barra de busca e filtros */}
              <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={clienteBusca}
                    onChange={(e) => setClienteBusca(e.target.value)}
                    placeholder="Buscar por Secretaria, município, UF ou CNPJ..."
                    className="pl-9"
                  />
                </div>
                <Select value={clienteStatusFiltro} onValueChange={setClienteStatusFiltro}>
                  <SelectTrigger className="w-full sm:w-[190px]">
                    <SelectValue placeholder="Situação comercial" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas as situações</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={clientePlanoFiltro} onValueChange={setClientePlanoFiltro}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Plano" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os planos</SelectItem>
                    {Object.entries(PLAN_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Secretaria</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Usuários</TableHead>
                        <TableHead>IA</TableHead>
                        <TableHead>Mensalidade</TableHead>
                        <TableHead>Trial</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientesFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                            {tenants.length === 0
                              ? "Nenhum cliente cadastrado. Cadastre a primeira Secretaria para iniciar a operação comercial."
                              : "Nenhuma Secretaria encontrada para os filtros aplicados."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        clientesFiltrados.map((tenant) => {
                          const activeCount = activeUsersByTenant[tenant.id] ?? 0;
                          const aiStatus = aiEnabledByTenant[tenant.id];
                          const nearLimit =
                            tenant.max_users > 0 && activeCount >= tenant.max_users;

                          return (
                            <TableRow key={tenant.id}>
                              <TableCell className="min-w-[210px]">
                                <p className="font-medium">{tenant.trade_name || tenant.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {tenant.municipality || "Município não informado"}
                                  {tenant.state ? ` / ${tenant.state}` : ""}
                                  {tenant.cnpj ? ` · ${formatarCnpj(tenant.cnpj)}` : ""}
                                </p>
                              </TableCell>
                              <TableCell>
                                {PLAN_LABELS[tenant.plan_tier as PlanTier] ?? tenant.plan_tier}
                              </TableCell>
                              <TableCell>
                                <Badge variant={statusVariant(tenant.commercial_status)}>
                                  {STATUS_LABELS[tenant.commercial_status as CommercialStatus] ??
                                    tenant.commercial_status}
                                </Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge variant={nearLimit ? "destructive" : "outline"} className="tabular-nums">
                                  {activeCount} / {tenant.max_users}
                                </Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {(() => {
                                  const aiUsage = aiUsageByTenant[tenant.id];
                                  const aiQuota = aiLimitsByTenant[tenant.id];
                                  const quotaStatus = avaliarCotaIa(
                                    aiUsage?.costUsd ?? 0,
                                    aiUsage?.tokens ?? 0,
                                    aiQuota?.monthly_budget_usd,
                                    aiQuota?.monthly_token_limit,
                                  );
                                  return (
                                    <div className="space-y-1">
                                      <button
                                        type="button"
                                        onClick={() => setTab("ia")}
                                        title="Gerenciar Inteligência Artificial"
                                        className="inline-flex items-center"
                                      >
                                        <Badge variant={aiStatus?.enabled ? "default" : "secondary"}>
                                          <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                                          {aiStatus?.enabled ? "Ativa" : "Inativa"}
                                        </Badge>
                                      </button>
                                      {(aiUsage?.requests || aiQuota?.monthly_budget_usd != null) && (
                                        <p className="text-[11px] tabular-nums text-muted-foreground">
                                          US$ {(aiUsage?.costUsd ?? 0).toFixed(2)}
                                          {aiQuota?.monthly_budget_usd != null
                                            ? ` / US$ ${aiQuota.monthly_budget_usd.toFixed(0)}`
                                            : ""}
                                          {quotaStatus.exceeded && (
                                            <span className="ml-1 font-semibold text-destructive">
                                              · Cota atingida
                                            </span>
                                          )}
                                          {quotaStatus.nearLimit && (
                                            <span className="ml-1 font-medium text-amber-600">
                                              · 80%+
                                            </span>
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })()}
                              </TableCell>
                              <TableCell>{money(Number(tenant.monthly_fee ?? 0))}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {tenant.commercial_status === "trial"
                                  ? dataCurta(tenant.trial_ends_at)
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => abrirEdicao(tenant)}
                                  >
                                    Configurar
                                  </Button>
                                  {tenant.commercial_status === "blocked_billing" ||
                                  tenant.commercial_status === "suspended" ? (
                                    <Button
                                      size="sm"
                                      onClick={() => void atualizarStatus(tenant, "active")}
                                    >
                                      Reativar
                                    </Button>
                                  ) : tenant.commercial_status !== "cancelled" ? (
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      onClick={() =>
                                        void atualizarStatus(tenant, "blocked_billing")
                                      }
                                    >
                                      Bloquear
                                    </Button>
                                  ) : null}
                                  <Select
                                    onValueChange={(value) =>
                                      void prorrogarTrial(tenant, Number(value))
                                    }
                                  >
                                    <SelectTrigger
                                      className="h-9 w-[110px]"
                                      aria-label={`Prorrogar demonstração de ${tenant.name}`}
                                    >
                                      <SelectValue placeholder="Trial" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="7">+7 dias</SelectItem>
                                      <SelectItem value="15">+15 dias</SelectItem>
                                      <SelectItem value="30">+30 dias</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => abrirProvisionamento(tenant)}
                                  >
                                    <Users className="h-4 w-4" aria-hidden />
                                    <span className="sr-only">Adicionar administrador</span>
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            {/* 3. PLANOS COMERCIAIS */}
            <TabsContent value="planos" className="mt-0 space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Planos comerciais</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Configure preços padrão, limites de usuários, cotas de IA e pacotes de módulos
                    aplicados automaticamente ao cadastrar novas Secretarias.
                  </p>
                </div>
                <Badge variant={plansBackedByDatabase ? "default" : "secondary"}>
                  {plansBackedByDatabase ? "Catálogo sincronizado no banco" : "Padrão local"}
                </Badge>
              </div>
              {!plansBackedByDatabase && (
                <Alert>
                  <AlertCircle className="h-4 w-4" aria-hidden />
                  <AlertTitle>Aguardando migration do catálogo de planos no banco</AlertTitle>
                  <AlertDescription>
                    Os valores padrão abaixo já preenchem novos cadastros automaticamente. Para
                    persistir alterações no catálogo, aplique a migration SQL{" "}
                    <code>20261124130000_platform_plans_modules_ai_quota.sql</code> no Supabase.
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {plans.map((plan) => {
                  const mrrPlano = dadosGraficoPlano.find((p) => p.plano === plan.id)?.mrr ?? 0;
                  const activeModules = MODULES.filter((m) => plan.default_modules[m.key] === true);
                  return (
                    <Card key={plan.id} className="flex flex-col justify-between">
                      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{plan.name}</CardTitle>
                            <Badge variant={plan.is_active ? "outline" : "secondary"}>
                              {plan.is_active ? "Ativo" : "Oculto"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!plansBackedByDatabase}
                          onClick={() => abrirEdicaoPlano(plan)}
                        >
                          <Settings2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                          Editar padrão
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-4">
                          <div>
                            <p className="text-muted-foreground">Mensalidade</p>
                            <p className="mt-0.5 font-semibold">
                              {money(plan.default_monthly_fee)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Usuários padrão</p>
                            <p className="mt-0.5 font-semibold">{plan.default_max_users}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Cota IA / mês</p>
                            <p className="mt-0.5 font-semibold">
                              {plan.default_ai_monthly_budget_usd != null
                                ? `US$ ${plan.default_ai_monthly_budget_usd.toFixed(0)}`
                                : "Livre"}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Clientes (MRR)</p>
                            <p className="mt-0.5 font-semibold text-primary">
                              {planCounts[plan.id]} ({money(mrrPlano)})
                            </p>
                          </div>
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Módulos inclusos ({activeModules.length}/{MODULES.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {MODULES.map((module) => {
                              const included = plan.default_modules[module.key] === true;
                              return (
                                <Badge
                                  key={module.key}
                                  variant={included ? "secondary" : "outline"}
                                  className={included ? "" : "opacity-45"}
                                >
                                  {module.label}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* 4. COBRANÇA */}
            <TabsContent value="cobranca" className="mt-0 space-y-6">
              <MasterBillingSettings tenants={tenants} onBillingChanged={refresh} />
            </TabsContent>

            {/* 5. CONFIGURAÇÕES TÉCNICAS */}
            <TabsContent value="configuracoes" className="mt-0 space-y-6">
              <AdminMasterConfiguration onOpenBilling={() => setTab("cobranca")} />
            </TabsContent>

            {/* 6. INTELIGÊNCIA ARTIFICIAL */}
            <TabsContent value="ia" className="mt-0 space-y-6">
              <AdminMasterAi />
            </TabsContent>

            {/* 7. AUDITORIA GLOBAL */}
            <TabsContent value="auditoria" className="mt-0 space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Auditoria global</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Eventos recentes registrados pela plataforma ({auditoriaFiltrada.length} exibidos).
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportarAuditoriaXlsx()}
                  disabled={auditoriaFiltrada.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Exportar XLSX
                </Button>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={auditoriaBusca}
                    onChange={(e) => setAuditoriaBusca(e.target.value)}
                    placeholder="Filtrar por ação, entidade, ID ou ator..."
                    className="pl-9"
                  />
                </div>
                <Select value={auditoriaAcaoFiltro} onValueChange={setAuditoriaAcaoFiltro}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Ação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as ações</SelectItem>
                    {acoesAuditoria.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={auditoriaEntidadeFiltro} onValueChange={setAuditoriaEntidadeFiltro}>
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue placeholder="Entidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as entidades</SelectItem>
                    {entidadesAuditoria.map((ent) => (
                      <SelectItem key={ent} value={ent}>
                        {ent}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Evento</TableHead>
                        <TableHead>Entidade</TableHead>
                        <TableHead>Secretaria</TableHead>
                        <TableHead>Identificador</TableHead>
                        <TableHead>Ator</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditoriaFiltrada.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                            Nenhum evento encontrado para os filtros aplicados.
                          </TableCell>
                        </TableRow>
                      ) : (
                        auditoriaFiltrada.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell className="whitespace-nowrap">
                              {new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(event.created_at))}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={event.action === "ACCESS_DENIED" ? "destructive" : "outline"}
                              >
                                {event.action}
                              </Badge>
                            </TableCell>
                            <TableCell>{event.entity}</TableCell>
                            <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                              {event.tenant_id
                                ? (tenantNameById.get(event.tenant_id) ?? event.tenant_id)
                                : "Global"}
                            </TableCell>
                            <TableCell className="max-w-[180px] truncate">
                              {event.entity_id ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate">
                              {event.actor_id ?? "Sistema"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            {/* 8. EQUIPE INTERNA */}
            <TabsContent value="equipe-interna" className="mt-0 space-y-6">
              <AdminMasterStaff />
            </TabsContent>

            {/* 9. EQUIPE DE SUPORTE */}
            <TabsContent value="suporte" className="mt-0 space-y-6">
              <AdminMasterSupport tenants={tenants} />
            </TabsContent>
          </div>
        </Tabs>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Configurar cliente" : "Cadastrar nova Secretaria"}
            </DialogTitle>
            <DialogDescription>
              Dados institucionais e comerciais. O isolamento de dados é aplicado pelo banco SMS2.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span className="text-muted-foreground">Usuários ativos: </span>
                  <strong className="tabular-nums">
                    {activeUsersByTenant[editing.id] ?? 0} / {editing.max_users}
                  </strong>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">IA: </span>
                  <Badge
                    variant={aiEnabledByTenant[editing.id]?.enabled ? "default" : "outline"}
                    className="text-[11px]"
                  >
                    {aiEnabledByTenant[editing.id]?.enabled ? "Habilitada" : "Desligada"}
                  </Badge>
                  {aiUsageByTenant[editing.id] && (
                    <span className="text-muted-foreground tabular-nums">
                      ({aiUsageByTenant[editing.id].requests} req ·{" "}
                      {aiUsageByTenant[editing.id].tokens.toLocaleString("pt-BR")} tokens)
                    </span>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setDialogOpen(false);
                  setTab("ia");
                }}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                Gerenciar IA desta Secretaria
              </Button>
            </div>
          )}
          <form onSubmit={salvarCliente} className="space-y-5">
            <Tabs defaultValue="institucional" className="space-y-4">
              <TabsList>
                <TabsTrigger value="institucional">Institucional</TabsTrigger>
                <TabsTrigger value="comercial">Comercial e módulos</TabsTrigger>
              </TabsList>
              <TabsContent value="institucional" className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="tenant-name">Razão social / Nome institucional</Label>
                  <Input
                    id="tenant-name"
                    value={draft.name}
                    onChange={(e) => {
                      patchDraft("name", e.target.value);
                      if (!editing) patchDraft("slug", slugify(e.target.value));
                    }}
                    required
                    minLength={3}
                    maxLength={160}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-trade-name">Nome fantasia / Apelido</Label>
                  <Input
                    id="tenant-trade-name"
                    value={draft.trade_name}
                    onChange={(e) => patchDraft("trade_name", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-cnpj">CNPJ</Label>
                  <Input
                    id="tenant-cnpj"
                    value={draft.cnpj}
                    onChange={(e) => patchDraft("cnpj", formatarCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-municipality">Município</Label>
                  <Input
                    id="tenant-municipality"
                    value={draft.municipality}
                    onChange={(e) => patchDraft("municipality", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-state">UF</Label>
                  <Input
                    id="tenant-state"
                    value={draft.state}
                    onChange={(e) => patchDraft("state", e.target.value.toUpperCase().slice(0, 2))}
                    maxLength={2}
                    placeholder="PA"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-ibge">Código IBGE do município</Label>
                  <Input
                    id="tenant-ibge"
                    value={draft.ibge_code}
                    onChange={(e) =>
                      patchDraft("ibge_code", e.target.value.replace(/\D/g, "").slice(0, 7))
                    }
                    maxLength={7}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-manager">Secretário / Gestor principal</Label>
                  <Input
                    id="tenant-manager"
                    value={draft.manager_name}
                    onChange={(e) => patchDraft("manager_name", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-contact-email">E-mail institucional</Label>
                  <Input
                    id="tenant-contact-email"
                    type="email"
                    value={draft.contact_email}
                    onChange={(e) => patchDraft("contact_email", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-contact-phone">WhatsApp / Telefone</Label>
                  <Input
                    id="tenant-contact-phone"
                    value={draft.contact_phone}
                    onChange={(e) => patchDraft("contact_phone", e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="tenant-street">Endereço</Label>
                  <Input
                    id="tenant-street"
                    value={draft.street}
                    onChange={(e) => patchDraft("street", e.target.value)}
                  />
                </div>
                {!editing && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="tenant-admin">
                      Primeiro administrador municipal (conta confirmada)
                    </Label>
                    <Select
                      value={draft.adminUserId}
                      onValueChange={(value) => patchDraft("adminUserId", value)}
                    >
                      <SelectTrigger id="tenant-admin">
                        <SelectValue placeholder="Selecione um usuário cadastrado" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((candidate: AdminCandidate) => (
                          <SelectItem key={candidate.user_id} value={candidate.user_id}>
                            {candidate.full_name} · {candidate.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {candidates.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Nenhum usuário confirmado disponível. Cadastre a conta do administrador
                        local e confirme o e-mail antes de criar a Secretaria.
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="tenant-slug">Identificador interno</Label>
                  <Input
                    id="tenant-slug"
                    value={draft.slug}
                    onChange={(e) => patchDraft("slug", slugify(e.target.value))}
                    required
                    minLength={3}
                    maxLength={63}
                  />
                </div>
              </TabsContent>
              <TabsContent value="comercial" className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Situação comercial</Label>
                    <Select
                      value={draft.commercial_status}
                      onValueChange={(value) =>
                        patchDraft("commercial_status", value as CommercialStatus)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Plano</Label>
                      {editing && (
                        <button
                          type="button"
                          onClick={() => aplicarTemplatePlano(draft.plan_tier as PlanTier)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Aplicar padrão deste plano
                        </button>
                      )}
                    </div>
                    <Select
                      value={draft.plan_tier}
                      onValueChange={(value) => {
                        const nextPlan = value as PlanTier;
                        if (!editing) {
                          aplicarTemplatePlano(nextPlan);
                        } else {
                          patchDraft("plan_tier", nextPlan);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PLAN_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!editing && (
                      <p className="text-[11px] text-muted-foreground">
                        Ao selecionar o plano, mensalidade, usuários, módulos e cota de IA são
                        preenchidos automaticamente.
                      </p>
                    )}
                  </div>
                  {draft.commercial_status === "trial" && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="trial-start">Início da demonstração</Label>
                        <Input
                          id="trial-start"
                          type="datetime-local"
                          value={dateInput(draft.trial_starts_at)}
                          onChange={(e) => patchDraft("trial_starts_at", dateIso(e.target.value))}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="trial-end">Expiração da demonstração</Label>
                        <Input
                          id="trial-end"
                          type="datetime-local"
                          value={dateInput(draft.trial_ends_at)}
                          onChange={(e) => patchDraft("trial_ends_at", dateIso(e.target.value))}
                          required
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="monthly-fee">Mensalidade (R$)</Label>
                    <Input
                      id="monthly-fee"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={draft.monthly_fee}
                      onChange={(e) => patchDraft("monthly_fee", Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-day">Dia de vencimento</Label>
                    <Input
                      id="billing-day"
                      type="number"
                      min="1"
                      max="31"
                      value={draft.billing_day}
                      onChange={(e) => patchDraft("billing_day", Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-email">E-mail financeiro</Label>
                    <Input
                      id="billing-email"
                      type="email"
                      value={draft.billing_email}
                      onChange={(e) => patchDraft("billing_email", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-contact">Contato financeiro</Label>
                    <Input
                      id="billing-contact"
                      value={draft.billing_contact}
                      onChange={(e) => patchDraft("billing_contact", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-users">Limite de usuários ativos</Label>
                    <Input
                      id="max-users"
                      type="number"
                      min="1"
                      value={draft.max_users}
                      onChange={(e) => patchDraft("max_users", Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium">Módulos liberados</h3>
                    <p className="text-sm text-muted-foreground">
                      A desativação é aplicada no menu, nas rotas e no banco de dados.
                    </p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {MODULES.map((module) => (
                      <div
                        key={module.key}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <Label htmlFor={`module-${module.key}`} className="cursor-pointer">
                            {module.label}
                          </Label>
                          <p className="text-xs text-muted-foreground">{module.description}</p>
                        </div>
                        <Switch
                          id={`module-${module.key}`}
                          checked={draft.enabled_modules[module.key] === true}
                          onCheckedChange={(checked) => patchModule(module.key, checked)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-1.5 font-medium">
                        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                        Inteligência Artificial & Cota Mensal
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {editing
                          ? `Status: ${aiEnabledByTenant[editing.id]?.enabled ? "Ativa" : "Inativa"} · Uso recente (30d): ${aiUsageByTenant[editing.id]?.requests ?? 0} reqs · ${(aiUsageByTenant[editing.id]?.tokens ?? 0).toLocaleString("pt-BR")} tokens · US$ ${(aiUsageByTenant[editing.id]?.costUsd ?? 0).toFixed(2)}`
                          : "Defina limites mensais opcionais para conter gastos da Secretaria com IA."}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDialogOpen(false);
                        setTab("ia");
                      }}
                    >
                      Gerenciar provedores e recursos
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ai-budget-usd">Orçamento mensal máximo (US$)</Label>
                      <Input
                        id="ai-budget-usd"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="Sem limite"
                        value={draft.aiBudgetUsd}
                        onChange={(e) => patchDraft("aiBudgetUsd", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ai-token-limit">Limite mensal de tokens</Label>
                      <Input
                        id="ai-token-limit"
                        type="number"
                        min="0"
                        step="1000"
                        placeholder="Sem limite"
                        value={draft.aiTokenLimit}
                        onChange={(e) => patchDraft("aiTokenLimit", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commercial-notes">Observações comerciais</Label>
                  <Textarea
                    id="commercial-notes"
                    rows={3}
                    value={draft.commercial_notes}
                    onChange={(e) => patchDraft("commercial_notes", e.target.value)}
                  />
                </div>
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || (!editing && candidates.length === 0)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {editing ? "Salvar alterações" : "Criar Secretaria"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provisionar administrador local</DialogTitle>
            <DialogDescription>
              Selecione uma conta confirmada para receber o papel de administrador da Secretaria{" "}
              {provisionTenant?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={confirmarProvisionamento} className="space-y-4">
            <div className="space-y-2">
              <Label>Usuário confirmado</Label>
              <Select value={provisionUser} onValueChange={setProvisionUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma conta" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.user_id} value={candidate.user_id}>
                      {candidate.full_name} · {candidate.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {candidates.length === 0 && (
              <Alert>
                <AlertDescription>
                  Não há outras contas confirmadas disponíveis para provisionamento.
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProvisionOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={provisioning || !provisionUser}>
                {provisioning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Adicionar administrador
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar padrão do plano {planDraft?.name}</DialogTitle>
            <DialogDescription>
              Essas configurações preenchem automaticamente mensalidade, usuários, cota de IA e
              módulos ao criar novos clientes neste plano.
            </DialogDescription>
          </DialogHeader>
          {planDraft && (
            <form onSubmit={salvarPlanoCatalogo} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="plan-name">Nome comercial</Label>
                  <Input
                    id="plan-name"
                    value={planDraft.name}
                    onChange={(e) =>
                      setPlanDraft((curr) => (curr ? { ...curr, name: e.target.value } : curr))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-fee">Mensalidade padrão (R$)</Label>
                  <Input
                    id="plan-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={planDraft.default_monthly_fee}
                    onChange={(e) =>
                      setPlanDraft((curr) =>
                        curr ? { ...curr, default_monthly_fee: Number(e.target.value) } : curr,
                      )
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-users">Limite padrão de usuários</Label>
                  <Input
                    id="plan-users"
                    type="number"
                    min="1"
                    max="10000"
                    value={planDraft.default_max_users}
                    onChange={(e) =>
                      setPlanDraft((curr) =>
                        curr ? { ...curr, default_max_users: Number(e.target.value) } : curr,
                      )
                    }
                    required
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <Label htmlFor="plan-active">Plano ativo para venda</Label>
                    <p className="text-xs text-muted-foreground">Exibido no catálogo comercial</p>
                  </div>
                  <Switch
                    id="plan-active"
                    checked={planDraft.is_active}
                    onCheckedChange={(checked) =>
                      setPlanDraft((curr) => (curr ? { ...curr, is_active: checked } : curr))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-ai-budget">Cota padrão de IA (US$ / mês)</Label>
                  <Input
                    id="plan-ai-budget"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Sem limite"
                    value={planDraft.default_ai_monthly_budget_usd ?? ""}
                    onChange={(e) =>
                      setPlanDraft((curr) =>
                        curr
                          ? {
                              ...curr,
                              default_ai_monthly_budget_usd:
                                e.target.value === "" ? null : Number(e.target.value),
                            }
                          : curr,
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-ai-tokens">Limite padrão de tokens / mês</Label>
                  <Input
                    id="plan-ai-tokens"
                    type="number"
                    min="0"
                    step="10000"
                    placeholder="Sem limite"
                    value={planDraft.default_ai_monthly_token_limit ?? ""}
                    onChange={(e) =>
                      setPlanDraft((curr) =>
                        curr
                          ? {
                              ...curr,
                              default_ai_monthly_token_limit:
                                e.target.value === "" ? null : Math.round(Number(e.target.value)),
                            }
                          : curr,
                      )
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="plan-desc">Descrição comercial</Label>
                  <Textarea
                    id="plan-desc"
                    rows={2}
                    value={planDraft.description}
                    onChange={(e) =>
                      setPlanDraft((curr) =>
                        curr ? { ...curr, description: e.target.value } : curr,
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Módulos padrão do plano</Label>
                <div className="grid gap-2 md:grid-cols-2">
                  {MODULES.map((module) => (
                    <div
                      key={module.key}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                    >
                      <Label htmlFor={`plan-mod-${module.key}`} className="cursor-pointer text-xs">
                        {module.label}
                      </Label>
                      <Switch
                        id={`plan-mod-${module.key}`}
                        checked={planDraft.default_modules[module.key] === true}
                        onCheckedChange={(checked) =>
                          setPlanDraft((curr) =>
                            curr
                              ? {
                                  ...curr,
                                  default_modules: {
                                    ...curr.default_modules,
                                    [module.key]: checked,
                                  },
                                }
                              : curr,
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPlanDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={savingPlan}>
                  {savingPlan && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  Salvar padrão do plano
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminMasterPage() {
  return (
    <TenantProvider>
      <AdminMaster />
    </TenantProvider>
  );
}
