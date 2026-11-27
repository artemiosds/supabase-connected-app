export type AuditEventRowLike = {
  id: string;
  action: string;
  actor_id: string | null;
  created_at: string;
  details: unknown;
  entity: string;
  entity_id: string | null;
};

const ENTITY_LABELS: Record<string, string> = {
  suppliers: "Fornecedor",
  supplier_documents: "Documento de fornecedor",
  supplier_portal_tokens: "Link do portal do fornecedor",
  document_templates: "Modelo de documento",
  document_template_versions: "Versão de modelo",
  generated_documents: "Documento gerado",
  generated_document_workflows: "Tramitação de documento",
  tenant_memberships: "Vínculo de usuário",
  tenant_invitations: "Convite de usuário",
  tenant_roles: "Perfil de acesso",
  tenants: "Organização / Secretaria",
  procurement_processes: "Processo licitatório",
  process_items: "Item do checklist do processo",
  procurement_items: "Item do processo",
  procurement_price_quotes: "Cotação / Pesquisa de preços",
  procurement_price_approvals: "Aprovação de preço estimado",
  procurement_process_compliance: "Enquadramento normativo",
  procurement_quote_requests: "Solicitação de cotação (Portal)",
  procurement_budget_allocations: "Dotação orçamentária",
  annual_procurement_demands: "Demanda anual (PCA / DFD)",
  contracts: "Contrato / Ata",
  contract_items: "Item de contrato",
  contract_movements: "Movimentação de saldo (OF)",
  contract_amendments: "Termo aditivo",
  contract_renewals: "Prorrogação contratual",
  contract_inspection_records: "Livro de fiscalização (art. 117)",
  ai_extraction_jobs: "Extração inteligente de documento",
  invoices: "Fatura / Cobrança",
  platform_support_sessions: "Sessão de suporte técnico",
};

const ACTION_LABELS: Record<string, string> = {
  INSERT: "Criado",
  UPDATE: "Alterado",
  DELETE: "Excluído",
  "tenant_role.permissions_saved": "Permissões do perfil atualizadas",
  "tenant_role.deleted": "Perfil de acesso removido",
  "document.workflow.submit": "Enviado para aprovação",
  "document.workflow.approve": "Aprovado",
  "document.workflow.reject": "Devolvido para revisão",
  "document.workflow.sign": "Assinado",
  "document.workflow.cancel": "Cancelado",
  "procurement.price_estimated.approved": "Preço estimado aprovado",
  "procurement.quote_request.created": "Solicitação de cotação criada",
  "procurement.quote_request.submitted": "Proposta enviada pelo fornecedor",
  "procurement.quote_request.imported": "Proposta importada para pesquisa de preços",
  "supplier_portal.document_submitted": "Documento enviado pelo portal do fornecedor",
  "supplier.created_by_support": "Fornecedor cadastrado pelo suporte",
  "supplier.updated_by_support": "Fornecedor atualizado pelo suporte",
  "annual_demand.submitted": "Demanda PCA registrada",
  "annual_demand.updated": "Demanda PCA atualizada",
  "annual_demand.approved": "Demanda PCA aprovada",
  "annual_demand.rejected": "Demanda PCA devolvida para ajuste",
  "annual_demand.cancelled": "Demanda PCA cancelada",
  "annual_demand.converted": "Demanda PCA convertida em processo",
  "contract_inspection.created": "Registro no livro de fiscalização",
  "contract_inspection.updated": "Atualização no livro de fiscalização",
  "pncp.published": "Publicado diretamente no PNCP",
  "platform_support.session_started": "Sessão de suporte iniciada",
  "platform_support.session_ended": "Sessão de suporte encerrada",
};

const DETAIL_FIELD_LABELS: Record<string, string> = {
  from_status: "De",
  to_status: "Para",
  reason: "Motivo",
  comment: "Observação",
  process_number: "Processo",
  plan_year: "Exercício PCA",
  title: "Título",
  method: "Método",
  approved_unit_price: "Preço unitário aprovado",
  approved_total_price: "Total aprovado",
  sample_count: "Amostras",
  distinct_source_count: "Fontes distintas",
  document_type: "Tipo documental",
  version: "Versão",
};

export function rotuloEntidadeAuditoria(value: string): string {
  return ENTITY_LABELS[value] ?? value.replace(/_/g, " ");
}

export function rotuloAcaoAuditoria(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action.startsWith("document.workflow.")) {
    const suffix = action.slice("document.workflow.".length);
    return `Tramitação: ${suffix}`;
  }
  return action.replace(/[._]+/g, " ").toLowerCase();
}

export function resumirDetalhesAuditoria(details: unknown): {
  camposAlterados: string[];
  destaques: string[];
} {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return { camposAlterados: [], destaques: [] };
  }
  const obj = details as Record<string, unknown>;
  const rawFields = obj["changed_fields"];
  const camposAlterados = Array.isArray(rawFields) ? rawFields.map(String) : [];
  const destaques: string[] = [];

  for (const [key, label] of Object.entries(DETAIL_FIELD_LABELS)) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") continue;
    destaques.push(`${label}: ${String(value)}`);
  }

  return { camposAlterados, destaques };
}
