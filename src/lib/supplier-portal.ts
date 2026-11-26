// =============================================================================
// supplier-portal.ts — Client e Helpers do Portal do Fornecedor
// Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores (Entrega 7)
// =============================================================================

import { supabase } from "@/integrations/supabase/client";

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
    verified: { label: "Aprovado / Regular", variante: "default" },
    pending_issue: { label: "Inconsistência / Reenviar", variante: "destructive" },
    expired: { label: "Expirado / Renovar", variante: "destructive" },
  };
  return map[status] ?? { label: status, variante: "outline" };
}
