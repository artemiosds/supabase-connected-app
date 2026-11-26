// =============================================================================
// supplier-portal.ts — Client e Helpers do Portal do Fornecedor
// Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores (Entrega 7)
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import { normalizeExternalDocumentUrl } from "@/lib/external-document-url";

export interface PortalSupplierData {
  id: string;
  legal_name: string;
  trade_name?: string | null;
  cnpj: string;
  category?: string | null;
  status: string;
}

export interface PortalTenantData {
  id: string;
  name: string;
}

export interface PortalHomologationData {
  id: string;
  status: string;
  category?: string | null;
  conclusion_status?: string | null;
  conclusion_notes?: string | null;
  created_at: string;
}

export interface PortalChecklistItem {
  id: string;
  title: string;
  description?: string | null;
  document_type: string;
  is_mandatory: boolean;
  verification_status: string;
  notes?: string | null;
}

export interface PortalDocumentItem {
  id: string;
  title: string;
  document_type: string;
  expires_at?: string | null;
  status: string;
}

export interface PortalResponseData {
  success: boolean;
  error?: string;
  supplier?: PortalSupplierData;
  tenant?: PortalTenantData;
  homologation?: PortalHomologationData | null;
  checklist_items?: PortalChecklistItem[];
  documents?: PortalDocumentItem[];
  expires_at?: string;
}

export interface SubmitDocumentParams {
  token: string;
  checklist_item_id?: string;
  title?: string;
  document_type?: string;
  file_name?: string;
  storage_path?: string;
  external_url?: string;
  expires_at?: string;
}

export interface SubmitDocumentResponse {
  success: boolean;
  error?: string;
  document_id?: string;
  protocol?: string;
}

/**
 * Gera um link de autoatendimento para o fornecedor.
 */
export async function gerarLinkPortalFornecedor(
  tenantId: string,
  supplierId: string,
  homologationId?: string,
  daysValid = 30,
): Promise<{ token: string; url: string }> {
  const { data, error } = await supabase.rpc("generate_supplier_portal_token", {
    p_tenant_id: tenantId,
    p_supplier_id: supplierId,
    ...(homologationId ? { p_homologation_id: homologationId } : {}),
    p_days_valid: daysValid,
  });

  if (error) throw error;
  const token = data as string;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/portal-fornecedor?token=${encodeURIComponent(token)}`;

  return { token, url };
}

/**
 * Consulta os dados do fornecedor e homologação usando o token seguro.
 */
export async function obterDadosPortalFornecedor(token: string): Promise<PortalResponseData> {
  const { data, error } = await supabase.rpc("get_supplier_portal_data", {
    p_token: token,
  });

  if (error) throw error;
  return data as unknown as PortalResponseData;
}

/**
 * Envia um documento pelo Portal do Fornecedor.
 */
export async function enviarDocumentoPortal(
  params: SubmitDocumentParams,
): Promise<SubmitDocumentResponse> {
  const { data, error } = await supabase.rpc("submit_supplier_portal_document", {
    p_token: params.token,
    ...(params.checklist_item_id ? { p_checklist_item_id: params.checklist_item_id } : {}),
    ...(params.title ? { p_title: params.title } : {}),
    p_document_type: params.document_type ?? "outros",
    ...(params.file_name ? { p_file_name: params.file_name } : {}),
    ...(params.storage_path ? { p_storage_path: params.storage_path } : {}),
    ...(params.external_url ? { p_external_url: params.external_url } : {}),
    ...(params.expires_at ? { p_expires_at: params.expires_at } : {}),
  });

  if (error) throw error;
  return data as unknown as SubmitDocumentResponse;
}

export type PortalTokenSummary = {
  id: string;
  homologation_id: string | null;
  token: string;
  expires_at: string;
  is_revoked: boolean;
  created_at: string;
};

/** Valida URL externa para envio no portal de autoatendimento do fornecedor. */
export function validarLinkDocumentoPortal(
  rawUrl: string,
): { valid: true; url: string } | { valid: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: "Informe o link HTTP/HTTPS do documento ou certidão." };
  }
  const normalized = normalizeExternalDocumentUrl(trimmed);
  if (!normalized) {
    return {
      valid: false,
      error: "Informe uma URL http:// ou https:// válida, sem espaços ou credenciais.",
    };
  }
  return { valid: true, url: normalized };
}

/** Resume o andamento dos itens de checklist exibidos ao fornecedor no portal. */
export function resumirChecklistPortal(items: ReadonlyArray<PortalChecklistItem>): {
  total: number;
  pendentes: number;
  recebidos: number;
  aprovados: number;
  obrigatoriosPendentes: number;
} {
  let pendentes = 0;
  let recebidos = 0;
  let aprovados = 0;
  let obrigatoriosPendentes = 0;

  for (const item of items) {
    if (item.verification_status === "verified") {
      aprovados += 1;
    } else if (
      item.verification_status === "received" ||
      item.verification_status === "awaiting_review"
    ) {
      recebidos += 1;
    } else {
      pendentes += 1;
      if (item.is_mandatory) obrigatoriosPendentes += 1;
    }
  }

  return {
    total: items.length,
    pendentes,
    recebidos,
    aprovados,
    obrigatoriosPendentes,
  };
}

/** Classifica o estado atual de um link emitido para o portal do fornecedor. */
export function formatarStatusTokenPortal(
  row: { is_revoked: boolean; expires_at: string },
  nowMs = Date.now(),
): { label: string; active: boolean; variant: "secondary" | "destructive" | "outline" } {
  if (row.is_revoked) {
    return { label: "Revogado", active: false, variant: "outline" };
  }
  if (Date.parse(row.expires_at) <= nowMs) {
    return { label: "Expirado", active: false, variant: "destructive" };
  }
  return { label: "Ativo", active: true, variant: "secondary" };
}

/** Lista tokens recentes do portal do fornecedor para acompanhamento e revogação. */
export async function listarTokensPortalFornecedor(
  tenantId: string,
  supplierId: string,
): Promise<PortalTokenSummary[]> {
  const { data, error } = await supabase
    .from("supplier_portal_tokens")
    .select("id, homologation_id, token, expires_at, is_revoked, created_at")
    .eq("tenant_id", tenantId)
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data ?? []) as PortalTokenSummary[];
}

/** Revoga imediatamente um link emitido do portal do fornecedor. */
export async function revogarTokenPortalFornecedor(
  tenantId: string,
  tokenId: string,
): Promise<void> {
  const { error } = await supabase
    .from("supplier_portal_tokens")
    .update({ is_revoked: true })
    .eq("tenant_id", tenantId)
    .eq("id", tokenId);

  if (error) throw error;
}

export function rotuloChecklistPortal(status: string): {
  label: string;
  variante: "default" | "secondary" | "destructive" | "outline";
} {
  const map: Record<
    string,
    { label: string; variante: "default" | "secondary" | "destructive" | "outline" }
  > = {
    not_submitted: { label: "Pendente de Envio", variante: "outline" },
    received: { label: "Recebido / Em Análise", variante: "secondary" },
    awaiting_review: { label: "Aguardando Conferência", variante: "secondary" },
    verified: { label: "Aprovado / Regular", variante: "default" },
    pending_issue: { label: "Inconsistência / Reenviar", variante: "destructive" },
    expired: { label: "Expirado / Renovar", variante: "destructive" },
  };
  return map[status] ?? { label: status, variante: "outline" };
}
