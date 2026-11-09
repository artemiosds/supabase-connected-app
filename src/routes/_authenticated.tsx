import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building2,
  FileText,
  History,
  HeartPulse,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  Truck,
  ScrollText,
  Workflow,
  LockKeyhole,
  Clock3,
} from "lucide-react";
import { SinoAlertas } from "@/components/sino-alertas";
import { useAuth } from "@/hooks/use-auth";
import { TenantProvider, useTenant } from "@/hooks/use-tenant";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  getTenantAccessState,
  getTrialDaysRemaining,
  type CommercialModule,
} from "@/lib/commercial-access";

const itensMenu: {
  para: string;
  rotulo: string;
  icone: typeof LayoutDashboard;
  module?: CommercialModule;
}[] = [
  { para: "/painel", rotulo: "Painel", icone: LayoutDashboard },
  { para: "/organizacoes", rotulo: "Organizações", icone: Building2 },
  { para: "/usuarios", rotulo: "Usuários", icone: Users },
  { para: "/processos", rotulo: "Processos de contratação", icone: Workflow, module: "processos" },
  { para: "/contratos", rotulo: "Contratos e vencimentos", icone: ScrollText, module: "contratos" },
  { para: "/fornecedores", rotulo: "Fornecedores", icone: Truck, module: "fornecedores" },
  {
    para: "/documentos",
    rotulo: "Documentos e vencimentos",
    icone: FileText,
    module: "documentos",
  },
  { para: "/historico", rotulo: "Histórico e auditoria", icone: History, module: "auditoria" },
  { para: "/configuracoes", rotulo: "Configurações", icone: Settings },
];

const moduleByRoute: Array<{ prefix: string; module: CommercialModule }> = [
  { prefix: "/fornecedores", module: "fornecedores" },
  { prefix: "/processos", module: "processos" },
  { prefix: "/contratos", module: "contratos" },
  { prefix: "/documentos", module: "documentos" },
  { prefix: "/historico", module: "auditoria" },
];

export const Route = createFileRoute("/_authenticated")({
  component: LayoutAutenticado,
});

function LayoutAutenticado() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/entrar", replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <TenantProvider>
      <div className="flex min-h-screen bg-background">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HeartPulse className="h-5 w-5" aria-hidden />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-foreground">Gestão de Fornecedores</p>
              <p className="text-xs text-muted-foreground">da Saúde</p>
            </div>
          </div>
          <MenuLateral />
          <div className="border-t p-3">
            <p
              className="truncate px-2 text-sm font-medium text-foreground"
              title={session.user.email ?? undefined}
            >
              {session.user.email}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start text-muted-foreground"
              onClick={() => void signOut()}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sair
            </Button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-4 border-b bg-card px-4 md:px-6">
            <SeletorOrganizacao />
            <div className="ml-auto flex items-center gap-2">
              <SinoAlertas />
              <AtalhoCentralSuporte />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => void signOut()}
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </Button>
          </header>
          <main className="flex-1 p-4 md:p-8">
            <ConteudoPortal />
          </main>
        </div>
      </div>
    </TenantProvider>
  );
}

function AtalhoCentralSuporte() {
  const { supportAccess } = useTenant();
  if (!supportAccess?.is_agent && !supportAccess?.session_id) return null;

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="inline-flex h-9 w-9 p-0 sm:w-auto sm:px-3"
    >
      <Link to="/suporte" aria-label="Abrir Central de Suporte">
        <ShieldCheck className="h-4 w-4 sm:mr-2" aria-hidden />
        <span className="hidden sm:inline">
          {supportAccess.session_id ? "Sessão de suporte" : "Central de Suporte"}
        </span>
      </Link>
    </Button>
  );
}

function MenuLateral() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { session } = useAuth();
  const navigate = useNavigate();
  const { selecionado, supportAccess } = useTenant();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isPlatformStaff, setIsPlatformStaff] = useState(false);

  useEffect(() => {
    let current = true;
    if (!session?.user.id) {
      setIsPlatformAdmin(false);
      setIsPlatformStaff(false);
      return;
    }
    async function checkPlatformAccess() {
      const { data: admin } = await db
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!current) return;
      setIsPlatformAdmin(!!admin);
      if (admin) {
        setIsPlatformStaff(false);
        return;
      }
      const { data: staff } = await db.rpc("get_my_platform_staff_access");
      if (current) {
        const activeStaff = staff?.[0]?.is_staff === true && staff[0]?.staff_status === "active";
        setIsPlatformStaff(activeStaff);
        if (activeStaff && pathname === "/painel") {
          void navigate({ to: "/admin-master", replace: true });
        }
      }
    }
    void checkPlatformAccess();
    return () => {
      current = false;
    };
  }, [session?.user.id, pathname, navigate]);

  const supportOnly = !!supportAccess?.is_agent || !!supportAccess?.session_id;
  const allowedItems = itensMenu.filter((item) => {
    if (supportOnly) return !!supportAccess?.session_id && item.para === "/fornecedores";
    if (!item.module || !selecionado) return true;
    return selecionado.enabled_modules[item.module] === true;
  });

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {(isPlatformAdmin || isPlatformStaff) && !supportAccess?.session_id && (
        <Link
          to="/admin-master"
          className={cn(
            "mb-3 flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10",
            pathname.startsWith("/admin-master") && "bg-primary/10",
          )}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {isPlatformStaff && !isPlatformAdmin ? "Portal Interno" : "Painel Master"}
        </Link>
      )}
      {(supportAccess?.is_agent || supportAccess?.is_platform_admin) && (
        <Link
          to="/suporte"
          className={cn(
            "mb-2 flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors",
            pathname === "/suporte"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-transparent text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Central de Suporte
        </Link>
      )}
      {allowedItems.map(({ para, rotulo, icone: Icone }) => {
        const ativo = pathname.startsWith(para);
        return (
          <Link
            key={para}
            to={para as never}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              ativo
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icone className="h-4 w-4" aria-hidden />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}

function ConteudoPortal() {
  const { selecionado, loading, supportAccess } = useTenant();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const supportOnly = !!supportAccess?.is_agent || !!supportAccess?.session_id;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (
    supportOnly &&
    supportAccess?.is_agent &&
    !supportAccess.session_id &&
    pathname !== "/suporte"
  ) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-xl border bg-card p-6 text-center sm:p-8">
          <ShieldCheck className="mx-auto h-8 w-8 text-primary" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Inicie um atendimento autorizado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta técnica não possui uma sessão temporária aberta. Acesse a central, selecione
            uma Secretaria atribuída e informe o motivo do atendimento.
          </p>
          <Button asChild className="mt-4">
            <Link to="/suporte">Abrir Central de Suporte</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (supportOnly && pathname !== "/suporte" && pathname !== "/fornecedores") {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-xl border bg-card p-6 text-center sm:p-8">
          <LockKeyhole className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Acesso limitado ao suporte</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Durante uma sessão, esta conta só pode acessar a Central de Suporte e o módulo
            Fornecedores da organização atendida.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/suporte">Ver sessão de suporte</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (supportOnly && pathname === "/fornecedores" && !supportAccess?.session_id) {
    return (
      <div className="mx-auto max-w-xl">
        <Button asChild variant="outline">
          <Link to="/suporte">Iniciar sessão de suporte</Link>
        </Button>
      </div>
    );
  }
  if (!selecionado) return <Outlet />;

  const accessState = getTenantAccessState(selecionado);
  if (accessState !== "allowed") {
    const trialExpired = accessState === "trial_expired";
    const title = trialExpired
      ? "Período de Demonstração Encerrado"
      : accessState === "billing_blocked"
        ? "Acesso Temporariamente Suspenso"
        : accessState === "cancelled"
          ? "Contrato Cancelado"
          : "Acesso Temporariamente Indisponível";
    const description = trialExpired
      ? "O período de avaliação gratuita da plataforma para esta Secretaria chegou ao fim. Entre em contato com a equipe comercial para contratar um plano e manter seus dados e processos preservados."
      : accessState === "billing_blocked"
        ? "O acesso desta Secretaria está suspenso por pendência administrativa ou financeira. Para regularizar a situação e restabelecer o acesso da equipe, entre em contato com a central de atendimento."
        : accessState === "cancelled"
          ? "O acesso operacional desta Secretaria foi encerrado. Seus dados permanecem preservados conforme as regras de retenção da plataforma."
          : "O acesso operacional desta Secretaria está suspenso. Entre em contato com o suporte da plataforma.";
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LockKeyhole className="h-7 w-7" aria-hidden />
          </div>
          <Badge variant="destructive" className="mt-5">
            Acesso operacional bloqueado
          </Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
          <p className="mt-4 text-xs text-muted-foreground">Organização: {selecionado.nome}</p>
        </div>
      </div>
    );
  }

  const requiredModule = moduleByRoute.find((entry) => pathname.startsWith(entry.prefix))?.module;
  if (requiredModule && selecionado.enabled_modules[requiredModule] !== true) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-xl border bg-card p-6 text-center sm:p-8">
          <LockKeyhole className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Módulo não contratado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este recurso não está habilitado no plano da {selecionado.nome}. Fale com o gestor
            comercial da plataforma para solicitar a ativação.
          </p>
        </div>
      </div>
    );
  }

  const trialDays =
    selecionado.commercial_status === "trial"
      ? getTrialDaysRemaining(selecionado.trial_ends_at)
      : null;

  return (
    <div className="space-y-4">
      {trialDays !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-foreground">
            <Clock3 className="h-4 w-4 text-amber-600" aria-hidden />
            Versão de Demonstração: restam{" "}
            <strong>
              {trialDays} {trialDays === 1 ? "dia" : "dias"}
            </strong>{" "}
            de teste.
          </span>
          <span className="text-muted-foreground">
            Entre em contato para oficializar a contratação.
          </span>
        </div>
      )}
      <Outlet />
    </div>
  );
}

function SeletorOrganizacao() {
  const { tenants, selecionado, selecionar, loading, bancoPendente, supportAccess } = useTenant();

  if (supportAccess?.session_id) {
    return (
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Atendimento temporário</p>
        <p
          className="max-w-[280px] truncate text-sm font-semibold"
          title={supportAccess.tenant_name ?? undefined}
        >
          {supportAccess.tenant_name ?? selecionado?.nome ?? "Organização"}
        </p>
      </div>
    );
  }
  if (bancoPendente)
    return (
      <span className="text-sm text-muted-foreground">
        Organizações: aguardando estrutura do banco
      </span>
    );
  if (loading) return <span className="text-sm text-muted-foreground">Carregando…</span>;
  if (tenants.length === 0)
    return <span className="text-sm text-muted-foreground">Nenhuma organização vinculada</span>;

  return (
    <Select value={selecionado?.id ?? ""} onValueChange={selecionar}>
      <SelectTrigger className="w-64" aria-label="Organização selecionada">
        <SelectValue placeholder="Selecione a organização" />
      </SelectTrigger>
      <SelectContent>
        {tenants.map((tenant) => (
          <SelectItem key={tenant.id} value={tenant.id}>
            {tenant.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
