import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { db, bancoNaoConfigurado } from "@/lib/db";

export type Tenant = {
  id: string;
  nome: string;
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
  recarregar: () => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);

const CHAVE_ORG = "gfs:organizacao-id";

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [bancoPendente, setBancoPendente] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await db
        .from("tenant_memberships")
        .select("tenant:tenants(id, name, slug, status)")
        .eq("status", "ativo");
      if (error) throw error;
      const lista = ((data ?? []) as unknown as { tenant: Tenant | null }[])
        .map((linha) => linha.tenant)
        .filter((t): t is Tenant => t !== null);
      setTenants(lista);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (bancoNaoConfigurado(msg)) {
        setBancoPendente(true);
      } else {
        setErro(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // O histórico do navegador é lido depois da hidratação para evitar
  // divergência entre servidor e cliente.
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
      // sem storage disponível: seleção vale só para a sessão atual
    }
  }, []);

  const selecionado =
    tenants.find((t) => t.id === selecionadoId) ?? tenants[0] ?? null;

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
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant deve ser usado dentro de TenantProvider");
  return ctx;
}
