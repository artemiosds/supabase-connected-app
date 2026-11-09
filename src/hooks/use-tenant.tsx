import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { supportRpc } from "@/lib/support-rpc";
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

export type PlatformSupportAccess = {
  is_agent: boolean;
  agent_status: string | null;
  is_platform_admin: boolean;
  session_id: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  reason: string | null;
  expires_at: string | null;
  allowed_actions: string[] | null;
};

type PlatformSupportTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type TenantContextValue = {
  tenants: Tenant[];
  selecionado: Tenant | null;
  selecionar: (id: string) => void;
  loading: boolean;
  erro: string | null;
  bancoPendente: boolean;
  supportAccess: PlatformSupportAccess | null;
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
  const [supportAccess, setSupportAccess] = useState<PlatformSupportAccess | null>(null);

  const carregar = useCallback(async () => {
    if (!session?.user.id) {
      setTenants([]);
      setSupportAccess(null);
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
      let resolvedTenants: Tenant[] = [];

      if (adminResult.data) {
        const { data, error } = await db
          .from("tenants")
          .select(tenantSelect)
          .order("name", { ascending: true });
        if (error) throw error;
        resolvedTenants = ((data ?? []) as TenantRow[]).map(mapTenant);
      } else {
        // Convites municipais continuam sendo aceitos pelo fluxo original.
        const { error: invitationError } = await db.rpc("accept_my_tenant_invitations");
        if (invitationError) throw invitationError;

        const { data, error } = await db
          .from("tenant_memberships")
          .select(`tenant:tenants(${tenantSelect})`)
          .eq("status", "active");
        if (error) throw error;

        const registros = (data ?? []) as unknown as { tenant: TenantRow | null }[];
        resolvedTenants = registros
          .map(({ tenant }) => (tenant ? mapTenant(tenant) : null))
          .filter((tenant): tenant is Tenant => tenant !== null);

        // Conta exclusivamente de suporte não recebe associação nem papel municipal.
        if (resolvedTenants.length === 0) {
          const { data: activated, error: activationError } = await supportRpc(
            "activate_my_platform_support_agent",
          );
          if (activationError) throw activationError;
          if (activated === true) {
            const { data: assigned, error: supportTenantsError } = await supportRpc(
              "list_my_platform_support_tenants_safe",
            );
            if (supportTenantsError) throw supportTenantsError;
            resolvedTenants = ((assigned ?? []) as PlatformSupportTenantRow[]).map((row) => ({
              id: row.id,
              nome: row.name,
              slug: row.slug,
              status: row.status,
              commercial_status: "active",
              plan_tier: "profissional",
              monthly_fee: 0,
              trial_starts_at: null,
              trial_ends_at: null,
              enabled_modules: { fornecedores: true },
            }));
          }
        }
      }

      const { data: supportStatus, error: supportStatusError } = await supportRpc(
        "get_my_platform_support_status",
      );
      if (supportStatusError) throw supportStatusError;
      setSupportAccess(supportStatus?.[0] ?? null);
      setTenants(resolvedTenants);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTenants([]);
      setSupportAccess(null);
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

  const selectedForSupportSession = supportAccess?.session_id
    ? tenants.find((tenant) => tenant.id === supportAccess.tenant_id)
    : undefined;
  const selecionado =
    selectedForSupportSession ??
    tenants.find((tenant) => tenant.id === selecionadoId) ??
    tenants[0] ??
    null;

  const recarregar = useCallback(() => {
    void carregar();
  }, [carregar]);

  return (
    <TenantContext.Provider
      value={{
        tenants,
        selecionado,
        selecionar,
        loading,
        erro,
        bancoPendente,
        supportAccess,
        recarregar,
      }}
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
