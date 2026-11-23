import { db } from "@/lib/db";

export type HomologationStatus =
  | "draft"
  | "in_review"
  | "awaiting_completion"
  | "completed"
  | "cancelled";

export type ConclusionStatus = "regular" | "pending" | "rejected";

export type ChecklistVerificationStatus =
  | "not_submitted"
  | "received"
  | "awaiting_review"
  | "verified"
  | "pending_issue"
  | "expired"
  | "replaced";

export type SupplierHomologation = {
  id: string;
  tenant_id: string;
  supplier_id: string;
  process_id: string | null;
  status: HomologationStatus;
  category: string;
  scope_description: string | null;
  assigned_to: string | null;
  opened_at: string;
  conclusion_status: ConclusionStatus | null;
  conclusion_notes: string | null;
  concluded_at: string | null;
  concluded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type HomologationChecklistItem = {
  id: string;
  tenant_id: string;
  homologation_id: string;
  document_type: string;
  title: string;
  is_mandatory: boolean;
  is_sanitary: boolean;
  verification_status: ChecklistVerificationStatus;
  document_id: string | null;
  notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

export type HomologationEvent = {
  id: string;
  tenant_id: string;
  homologation_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  description: string;
  evidence_url: string | null;
  created_by: string;
  created_at: string;
};

export function rotuloStatusHomologacao(status: HomologationStatus): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
} {
  switch (status) {
    case "draft":
      return { label: "Rascunho", variant: "secondary" };
    case "in_review":
      return { label: "Em Análise", variant: "default" };
    case "awaiting_completion":
      return { label: "Aguardando Complementação", variant: "outline" };
    case "completed":
      return { label: "Concluída", variant: "default" };
    case "cancelled":
      return { label: "Cancelada", variant: "destructive" };
    default:
      return { label: status, variant: "secondary" };
  }
}

export function rotuloConclusao(status: ConclusionStatus | null): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case "regular":
      return {
        label: "Regular para a Finalidade",
        colorClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300",
      };
    case "pending":
      return {
        label: "Com Pendências",
        colorClass: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300",
      };
    case "rejected":
      return {
        label: "Não Atende às Exigências",
        colorClass: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300",
      };
    default:
      return { label: "Não Concluída", colorClass: "bg-muted text-muted-foreground border-border" };
  }
}

export function rotuloStatusChecklist(status: ChecklistVerificationStatus): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case "verified":
      return { label: "Conferido e Válido", colorClass: "text-emerald-600 dark:text-emerald-400" };
    case "received":
      return { label: "Recebido", colorClass: "text-sky-600 dark:text-sky-400" };
    case "awaiting_review":
      return { label: "Aguardando Conferência", colorClass: "text-amber-600 dark:text-amber-400" };
    case "pending_issue":
      return { label: "Com Pendência", colorClass: "text-rose-600 dark:text-rose-400 font-semibold" };
    case "expired":
      return { label: "Vencido", colorClass: "text-destructive font-semibold" };
    case "replaced":
      return { label: "Substituído", colorClass: "text-muted-foreground" };
    case "not_submitted":
      return { label: "Não Enviado", colorClass: "text-muted-foreground" };
    default:
      return { label: status, colorClass: "text-muted-foreground" };
  }
}

export async function listarHomologacoesFornecedor(
  tenantId: string,
  supplierId: string,
): Promise<SupplierHomologation[]> {
  const { data, error } = await db
    .from("supplier_homologations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("supplier_id", supplierId)
    .order("opened_at", { ascending: false });

  if (error) throw error;
  return (data as unknown as SupplierHomologation[]) ?? [];
}

export async function carregarItensChecklist(
  tenantId: string,
  homologationId: string,
): Promise<HomologationChecklistItem[]> {
  const { data, error } = await db
    .from("supplier_homologation_checklist_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("homologation_id", homologationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as unknown as HomologationChecklistItem[]) ?? [];
}

export async function carregarEventosHomologacao(
  tenantId: string,
  homologationId: string,
): Promise<HomologationEvent[]> {
  const { data, error } = await db
    .from("supplier_homologation_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("homologation_id", homologationId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as unknown as HomologationEvent[]) ?? [];
}

export async function iniciarAnaliseHomologacao(params: {
  tenantId: string;
  supplierId: string;
  category: string;
  scopeDescription: string;
  assignedTo?: string | null;
  processId?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("start_supplier_homologation", {
    p_tenant_id: params.tenantId,
    p_supplier_id: params.supplierId,
    p_category: params.category,
    p_scope_description: params.scopeDescription,
    p_assigned_to: params.assignedTo ?? null,
    p_process_id: params.processId ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function atualizarItemChecklist(params: {
  tenantId: string;
  homologationId: string;
  itemId: string;
  verificationStatus: ChecklistVerificationStatus;
  notes?: string;
  documentId?: string | null;
  verifiedBy?: string | null;
}): Promise<void> {
  const { error } = await db
    .from("supplier_homologation_checklist_items")
    .update({
      verification_status: params.verificationStatus,
      notes: params.notes ?? null,
      document_id: params.documentId ?? null,
      verified_at: new Date().toISOString(),
      verified_by: params.verifiedBy ?? null,
    })
    .eq("id", params.itemId)
    .eq("tenant_id", params.tenantId);

  if (error) throw error;

  // Registrar evento auditável
  await db.from("supplier_homologation_events").insert({
    tenant_id: params.tenantId,
    homologation_id: params.homologationId,
    event_type: "checklist_verified",
    description: `Item do checklist atualizado para "${params.verificationStatus}". ${params.notes ? `Observações: ${params.notes}` : ""}`,
  });
}

export async function solicitarComplementacao(params: {
  tenantId: string;
  homologationId: string;
  exigencias: string;
}): Promise<void> {
  const { error } = await db
    .from("supplier_homologations")
    .update({
      status: "awaiting_completion",
    })
    .eq("id", params.homologationId)
    .eq("tenant_id", params.tenantId);

  if (error) throw error;

  await db.from("supplier_homologation_events").insert({
    tenant_id: params.tenantId,
    homologation_id: params.homologationId,
    event_type: "completion_requested",
    from_status: "in_review",
    to_status: "awaiting_completion",
    description: `Solicitação de complementação documental registrada: ${params.exigencias}`,
  });
}

export async function concluirAnaliseHomologacao(params: {
  tenantId: string;
  homologationId: string;
  conclusionStatus: ConclusionStatus;
  conclusionNotes: string;
}): Promise<boolean> {
  const { data, error } = await db.rpc("conclude_supplier_homologation", {
    p_tenant_id: params.tenantId,
    p_homologation_id: params.homologationId,
    p_conclusion_status: params.conclusionStatus,
    p_conclusion_notes: params.conclusionNotes,
  });

  if (error) throw error;
  return Boolean(data);
}
