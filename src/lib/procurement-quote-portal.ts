import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData, formatarMoeda } from "@/lib/contratacao";

export type ProcurementQuoteRequestRow = Tables<"procurement_quote_requests">;

export type QuotePortalSubmittedItem = {
  item_id: string;
  line_number: number;
  description: string;
  unit: string;
  quantity: number;
  quoted: boolean;
  unit_price: number | null;
  delivery_cost: number;
  total_price: number;
  brand_model: string | null;
};

export type QuotePortalSubmittedPayload = {
  request_id: string;
  process_id: string;
  supplier_id: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  delivery_term: string;
  payment_terms: string;
  warranty_terms: string | null;
  notes: string | null;
  items: QuotePortalSubmittedItem[];
};

export type QuotePortalItemInput = {
  item_id: string;
  quoted: boolean;
  unit_price?: number | null;
  delivery_cost?: number;
  brand_model?: string | null;
};

export type QuotePortalSubmitInput = {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  delivery_term: string;
  payment_terms: string;
  warranty_terms?: string | null;
  notes?: string | null;
  items: QuotePortalItemInput[];
};

export type QuotePortalData = {
  success: boolean;
  error?: string;
  request?: {
    id: string;
    status: string;
    sent_at: string;
    response_deadline: string;
    expires_at: string;
    notes: string | null;
    submitted_at: string | null;
    submission_protocol: string | null;
    submission_sha256: string | null;
    submitted_payload: QuotePortalSubmittedPayload | null;
  };
  tenant?: {
    id: string;
    name: string;
  };
  process?: {
    id: string;
    number: string;
    title: string;
    description: string | null;
    modality: string;
  };
  supplier?: {
    id: string;
    legal_name: string;
    trade_name: string | null;
    cnpj: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    street: string | null;
    street_number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  };
  items?: Array<{
    id: string;
    line_number: number;
    description: string;
    technical_specification: string | null;
    unit: string;
    quantity: number;
  }>;
};

export type QuotePortalSubmitResponse = {
  success: boolean;
  error?: string;
  protocol?: string;
  sha256?: string;
  submitted_at?: string;
  quoted_items?: number;
};

export function buildQuotePortalUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/portal-fornecedor?cotacao=${encodeURIComponent(token)}`;
}

export function rotuloStatusSolicitacaoCotacao(status: string): {
  label: string;
  variante: "default" | "secondary" | "destructive" | "outline";
} {
  const map: Record<
    string,
    { label: string; variante: "default" | "secondary" | "destructive" | "outline" }
  > = {
    pending: { label: "Aguardando resposta", variante: "outline" },
    submitted: { label: "Proposta recebida", variante: "secondary" },
    imported: { label: "Importada para matriz", variante: "default" },
    cancelled: { label: "Cancelada", variante: "destructive" },
  };
  return map[status] ?? { label: status, variante: "outline" };
}

export function montarEnderecoFornecedorPortal(
  supplier: NonNullable<QuotePortalData["supplier"]>,
): string {
  return [
    supplier.street,
    supplier.street_number,
    supplier.complement,
    supplier.neighborhood,
    supplier.city,
    supplier.state,
    supplier.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Gera o texto formal estruturado da proposta eletrônica submetida pelo fornecedor,
 * utilizado tanto para conferência quanto para geração automática do comprovante PDF
 * exigido pela Lei nº 14.133/2021 ao importar para a matriz de preços.
 */
export function buildFormalQuotePdfText(params: {
  tenantName: string;
  processNumber: string;
  processTitle: string;
  supplierName: string;
  supplierCnpj: string;
  protocol: string;
  sha256: string;
  sentAt: string;
  responseDeadline: string;
  submittedAt: string;
  payload: QuotePortalSubmittedPayload;
}): string {
  const quotedItems = params.payload.items.filter(
    (item) => item.quoted && item.unit_price !== null,
  );
  const totalGeral = quotedItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);

  const lines: string[] = [
    "PROPOSTA COMERCIAL ELETRÔNICA — COTAÇÃO DE PREÇOS (LEI Nº 14.133/2021)",
    "",
    `Órgão / Secretaria Solicitante: ${params.tenantName}`,
    `Processo Administrativo nº: ${params.processNumber} — ${params.processTitle}`,
    `Protocolo Eletrônico: ${params.protocol}`,
    `Data/Hora de Submissão: ${new Date(params.submittedAt).toLocaleString("pt-BR")}`,
    `Solicitação Enviada em: ${formatarData(params.sentAt)} | Prazo Limite: ${formatarData(params.responseDeadline)}`,
    "",
    "1. IDENTIFICAÇÃO DA EMPRESA PROPONENTE",
    `Razão Social / Nome: ${params.supplierName}`,
    `CNPJ: ${formatarCnpj(params.supplierCnpj)}`,
    `Responsável pela Proposta: ${params.payload.contact_name}`,
    `E-mail: ${params.payload.contact_email} | Telefone: ${params.payload.contact_phone}`,
    `Endereço: ${params.payload.address}`,
    "",
    "2. CONDIÇÕES COMERCIAIS DECLARADAS",
    `Prazo de Entrega: ${params.payload.delivery_term}`,
    `Condições de Pagamento: ${params.payload.payment_terms}`,
    `Garantia / Validade: ${params.payload.warranty_terms || "Conforme edital / legislação vigente"}`,
    ...(params.payload.notes ? [`Observações do Fornecedor: ${params.payload.notes}`] : []),
    "",
    "3. ITENS COTADOS",
  ];

  for (const item of quotedItems) {
    lines.push(
      `Item ${item.line_number}: ${item.description} (${item.quantity} ${item.unit})` +
        ` | Unitário: ${formatarMoeda(Number(item.unit_price))}` +
        ` | Frete: ${formatarMoeda(Number(item.delivery_cost))}` +
        ` | Subtotal: ${formatarMoeda(Number(item.total_price))}` +
        (item.brand_model ? ` | Marca/Modelo: ${item.brand_model}` : ""),
    );
  }

  lines.push(
    "",
    `Valor Global dos Itens Cotados: ${formatarMoeda(totalGeral)}`,
    "",
    "4. INTEGRIDADE E RASTREABILIDADE",
    `Hash SHA-256 Canônico: ${params.sha256}`,
    "Documento gerado eletronicamente a partir da proposta protocolada pelo fornecedor no Portal de Autoatendimento Primus Gestão.",
  );

  return lines.join("\n");
}

export async function criarSolicitacaoCotacaoPortal(params: {
  tenantId: string;
  processId: string;
  supplierId: string;
  selectionJustification: string;
  responseDeadline: string;
  notes?: string;
}): Promise<{
  id: string;
  token: string;
  url: string;
  sent_at: string;
  response_deadline: string;
  expires_at: string;
}> {
  const { data, error } = await supabase.rpc("create_procurement_quote_request", {
    p_tenant_id: params.tenantId,
    p_process_id: params.processId,
    p_supplier_id: params.supplierId,
    p_selection_justification: params.selectionJustification,
    p_response_deadline: params.responseDeadline,
    ...(params.notes?.trim() ? { p_notes: params.notes.trim() } : {}),
  });

  if (error) throw error;
  const parsed = data as {
    id: string;
    token: string;
    sent_at: string;
    response_deadline: string;
    expires_at: string;
  };
  return {
    ...parsed,
    url: buildQuotePortalUrl(parsed.token),
  };
}

export async function cancelarSolicitacaoCotacaoPortal(
  tenantId: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc("cancel_procurement_quote_request", {
    p_tenant_id: tenantId,
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function marcarSolicitacaoCotacaoImportada(
  tenantId: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc("mark_procurement_quote_request_imported", {
    p_tenant_id: tenantId,
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function obterDadosPortalCotacao(token: string): Promise<QuotePortalData> {
  const { data, error } = await supabase.rpc("get_procurement_quote_portal_data", {
    p_token: token,
  });
  if (error) throw error;
  return data as unknown as QuotePortalData;
}

export async function enviarPropostaPortalCotacao(
  token: string,
  payload: QuotePortalSubmitInput,
): Promise<QuotePortalSubmitResponse> {
  const { data, error } = await supabase.rpc("submit_procurement_quote_portal", {
    p_token: token,
    p_payload: payload,
  });
  if (error) throw error;
  return data as unknown as QuotePortalSubmitResponse;
}
