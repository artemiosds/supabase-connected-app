import { supabase } from "@/integrations/supabase/client";
import type { RegularitySource, RegularityStatus } from "./supplier-regularity";

export type AutomatedRegularityItem = {
  source: RegularitySource;
  sourceLabel: string;
  status: RegularityStatus;
  certificateNumber: string | null;
  evidenceUrl: string | null;
  notes: string;
  requiresAction: boolean;
  rawSituation: string;
};

export type AutomatedRegularityResult = {
  checkedAt: string;
  cnpj: string;
  razaoSocial: string | null;
  checks: AutomatedRegularityItem[];
  warnings: string[];
};

export function mapearSituacaoTcuParaStatus(situacao: string): {
  status: RegularityStatus;
  requiresAction: boolean;
} {
  const norm = situacao.trim().toUpperCase();
  if (norm === "NADA_CONSTA") return { status: "regular", requiresAction: false };
  if (norm === "CONSTA") return { status: "irregular", requiresAction: true };
  return { status: "pending_review", requiresAction: true };
}

export function mapearSituacaoRfbParaStatus(situacao: string): {
  status: RegularityStatus;
  requiresAction: boolean;
} {
  const norm = situacao.trim().toUpperCase();
  if (norm === "ATIVA") return { status: "regular", requiresAction: false };
  if (
    norm.includes("BAIXAD") ||
    norm.includes("INAPT") ||
    norm.includes("SUSPENS") ||
    norm.includes("NUL")
  ) {
    return { status: "irregular", requiresAction: true };
  }
  return { status: "pending_review", requiresAction: true };
}

export async function consultarRegularidadeAutomatica(params: {
  tenantId: string;
  cnpj: string;
}): Promise<AutomatedRegularityResult> {
  const { data, error } = await supabase.functions.invoke<
    AutomatedRegularityResult & { error?: string }
  >("check-supplier-regularity", {
    body: {
      tenant_id: params.tenantId,
      cnpj: params.cnpj.replace(/\D/g, ""),
    },
  });

  if (error) {
    let message = error.message || "Falha ao consultar regularidade nos portais públicos.";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const errBody = (await ctx.json().catch(() => null)) as Record<string, unknown> | null;
      if (errBody && typeof errBody["error"] === "string") {
        message = errBody["error"];
      }
    }
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida do serviço de regularidade.");
  }
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
