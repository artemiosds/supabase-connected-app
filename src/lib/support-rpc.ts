import type { PostgrestError } from "@supabase/supabase-js";
import { db } from "@/lib/db";

/**
 * Contrato tipado das funções de suporte da plataforma definidas em
 * supabase/migrations/20261109160000..20261109164000. Enquanto os tipos gerados
 * não incluírem essas funções, este módulo é o único ponto de chamada.
 */
export type SupportRpcMap = {
  activate_my_platform_support_agent: { args: undefined; returns: boolean };
  end_platform_support_session: { args: { p_session_id: string }; returns: null };
  get_my_platform_support_status: {
    args: undefined;
    returns: {
      is_agent: boolean;
      agent_status: string | null;
      is_platform_admin: boolean;
      session_id: string | null;
      tenant_id: string | null;
      tenant_name: string | null;
      reason: string | null;
      expires_at: string | null;
      allowed_actions: string[] | null;
    }[];
  };
  list_my_platform_support_tenants_safe: {
    args: undefined;
    returns: { id: string; name: string; slug: string; status: string }[];
  };
  list_platform_support_assignments: {
    args: { p_agent_user_id: string };
    returns: {
      tenant_id: string;
      tenant_name: string;
      is_active: boolean;
      can_view_suppliers: boolean;
      can_create_suppliers: boolean;
      can_update_suppliers: boolean;
    }[];
  };
  list_platform_support_team: {
    args: undefined;
    returns: {
      user_id: string;
      email: string;
      display_name: string;
      status: string;
      assignment_count: number;
    }[];
  };
  set_platform_support_agent_status: {
    args: { p_user_id: string; p_status: string };
    returns: null;
  };
  set_platform_support_assignment: {
    args: {
      p_agent_user_id: string;
      p_tenant_id: string;
      p_is_active: boolean;
      p_can_view_suppliers?: boolean;
      p_can_create_suppliers?: boolean;
      p_can_update_suppliers?: boolean;
    };
    returns: null;
  };
  start_platform_support_session: {
    args: { p_tenant_id: string; p_reason: string };
    returns: { session_id: string; expires_at: string }[];
  };
};

type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

export async function supportRpc<K extends keyof SupportRpcMap>(
  fn: K,
  ...args: SupportRpcMap[K]["args"] extends undefined ? [] : [SupportRpcMap[K]["args"]]
): Promise<{ data: SupportRpcMap[K]["returns"] | null; error: PostgrestError | null }> {
  const rpc = db.rpc.bind(db) as unknown as UntypedRpc;
  const { data, error } = await rpc(fn, args[0] as Record<string, unknown> | undefined);
  return { data: data as SupportRpcMap[K]["returns"] | null, error };
}
