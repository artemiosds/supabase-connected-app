import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Building2,
  HeartPulse,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  Users,
  Truck,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

const itensMenu = [
  { para: "/painel", rotulo: "Painel", icone: LayoutDashboard },
  { para: "/organizacoes", rotulo: "Organizações", icone: Building2 },
  { para: "/usuarios", rotulo: "Usuários", icone: Users },
  { para: "/fornecedores", rotulo: "Fornecedores", icone: Truck },
  { para: "/configuracoes", rotulo: "Configurações", icone: Settings },
] as const;

export const Route = createFileRoute("/_authenticated")({
  component: LayoutAutenticado,
});

function LayoutAutenticado() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/entrar", replace: true });
    }
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
            <p className="truncate px-2 text-sm font-medium text-foreground" title={session.user.email ?? undefined}>
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
            <Outlet />
          </main>
        </div>
      </div>
    </TenantProvider>
  );
}

function MenuLateral() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {itensMenu.map(({ para, rotulo, icone: Icone }) => {
        const ativo = pathname.startsWith(para);
        return (
          <Link
            key={para}
            to={para}
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

function SeletorOrganizacao() {
  const { tenants, selecionado, selecionar, loading, bancoPendente } = useTenant();

  if (bancoPendente) {
    return (
      <span className="text-sm text-muted-foreground">
        Organizações: aguardando estrutura do banco
      </span>
    );
  }

  if (loading) {
    return <span className="text-sm text-muted-foreground">Carregando…</span>;
  }

  if (tenants.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">Nenhuma organização vinculada</span>
    );
  }

  return (
    <Select value={selecionado?.id ?? ""} onValueChange={selecionar}>
      <SelectTrigger className="w-64" aria-label="Organização selecionada">
        <SelectValue placeholder="Selecione a organização" />
      </SelectTrigger>
      <SelectContent>
        {tenants.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
