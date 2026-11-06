import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";

export type Tenant = {
  id: string;
  nome: string;
  slug: string;
  status: string;
  commercial_status: string;
  plan_tier: string;
  monthly_fee: number;
  trial_starts_at: string | null;
  trial_ends_at: string | null;
  enabled_modules: Record<string, boolean>;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  commercial_status: string;
  plan_tier: string;
  monthly_fee: number;
  trial_starts_at: string | null;
  trial_ends_at: string | null;
  enabled_modules: unknown;
};

type TenantContextValue = {
  tenants: Tenant[];
  selecionado: Tenant | null;
  selecionar: (id: string) => void;
  loading: boolean;
  erro: string | null;
  bancoPendente: boolean;
  recarregar: () => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);
const CHAVE_ORG = "gfs:organizacao-id";

function mapTenant(row: TenantRow): Tenant {
  const enabledModules =
    row.enabled_modules &&
    typeof row.enabled_modules === "object" &&
    !Array.isArray(row.enabled_modules)
      ? (row.enabled_modules as Record<string, boolean>)
      : {};
  return {
    id: row.id,
    nome: row.name,
    slug: row.slug,
    status: row.status,
    commercial_status: row.commercial_status,
    plan_tier: row.plan_tier,
    monthly_fee: Number((row as TenantRow & { monthly_fee?: number }).monthly_fee ?? 0),
    trial_starts_at: row.trial_starts_at,
    trial_ends_at: row.trial_ends_at,
    enabled_modules: enabledModules,
  };
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [bancoPendente, setBancoPendente] = useState(false);

  const carregar = useCallback(async () => {
    if (!session?.user.id) {
      setTenants([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErro(null);
    setBancoPendente(false);

    try {
      // O administrador global não é membro municipal; sua lista vem de tenants.
      const adminResult = await db
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (adminResult.error) throw adminResult.error;

      const tenantSelect =
        "id, name, slug, status, commercial_status, plan_tier, trial_starts_at, trial_ends_at, enabled_modules, monthly_fee";

      if (adminResult.data) {
        const { data, error } = await db
          .from("tenants")
          .select(tenantSelect)
          .order("name", { ascending: true });
        if (error) throw error;
        setTenants(((data ?? []) as TenantRow[]).map(mapTenant));
      } else {
        const { data, error } = await db
          .from("tenant_memberships")
          .select(`tenant:tenants(${tenantSelect})`)
          .eq("status", "active");
        if (error) throw error;

        const registros = (data ?? []) as unknown as { tenant: TenantRow | null }[];
        setTenants(
          registros
            .map(({ tenant }) => (tenant ? mapTenant(tenant) : null))
            .filter((tenant): tenant is Tenant => tenant !== null),
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTenants([]);
      if (bancoNaoConfigurado(message)) setBancoPendente(true);
      else setErro(message);
    } finally {
      setLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    try {
      setSelecionadoId(window.localStorage.getItem(CHAVE_ORG));
    } catch {
      setSelecionadoId(null);
    }
  }, []);

  const selecionar = useCallback((id: string) => {
    setSelecionadoId(id);
    try {
      window.localStorage.setItem(CHAVE_ORG, id);
    } catch {
      // A seleção permanece apenas em memória quando o storage não estiver disponível.
    }
  }, []);

  const selecionado = tenants.find((tenant) => tenant.id === selecionadoId) ?? tenants[0] ?? null;

  const recarregar = useCallback(() => {
    void carregar();
  }, [carregar]);

  return (
    <TenantContext.Provider
      value={{ tenants, selecionado, selecionar, loading, erro, bancoPendente, recarregar }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) throw new Error("useTenant deve ser usado dentro de TenantProvider");
  return context;
}
