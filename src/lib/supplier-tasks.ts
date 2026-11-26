// =============================================================================
// supplier-tasks.ts — Lib de Fila de Tarefas e Pendências de Fornecedores
// Primus Gestão — Fase 2.1 — Entrega 4
// =============================================================================

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskType =
  | "document_expired"
  | "document_expiring"
  | "regularity_expired"
  | "regularity_irregular"
  | "homologation_pending"
  | "complementation_requested"
  | "sanction_recorded"
  | "manual";

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskStatus = "open" | "in_progress" | "resolved" | "dismissed";

export interface SupplierPendingTask {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  title: string;
  description?: string;
  due_date?: string;
  assigned_to?: string;
  assigned_name?: string;
  auto_generated: boolean;
  created_at: string;
  resolved_at?: string;
}

export interface TasksSummary {
  open_count: number;
  critical_count: number;
  overdue_count: number;
  high_count: number;
}

export interface CreateTaskParams {
  tenant_id: string;
  supplier_id: string;
  task_type: TaskType;
  title: string;
  description?: string | undefined;
  priority?: TaskPriority | undefined;
  due_date?: string | undefined;
  assigned_to?: string | undefined;
  reference_table?: string | undefined;
  reference_id?: string | undefined;
}

export interface ResolveTaskParams {
  tenant_id: string;
  task_id: string;
  resolution_notes?: string | undefined;
  action?: "resolved" | "dismissed" | undefined;
}

export interface ListTasksParams {
  tenant_id: string;
  supplier_id?: string | undefined;
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  task_type?: TaskType | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers de rótulo e cor
// ---------------------------------------------------------------------------

export function rotuloTipoTarefa(type: TaskType): string {
  const map: Record<TaskType, string> = {
    document_expired: "Documento Vencido",
    document_expiring: "Documento a Vencer",
    regularity_expired: "Regularidade Expirada",
    regularity_irregular: "Irregularidade Detectada",
    homologation_pending: "Homologação Pendente",
    complementation_requested: "Complementação Solicitada",
    sanction_recorded: "Sanção Registrada",
    manual: "Tarefa Manual",
  };
  return map[type] ?? type;
}

export function rotuloStatusTarefa(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    open: "Aberta",
    in_progress: "Em Andamento",
    resolved: "Resolvida",
    dismissed: "Dispensada",
  };
  return map[status] ?? status;
}

export function rotuloPrioridade(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    critical: "Crítica",
    high: "Alta",
    medium: "Média",
    low: "Baixa",
  };
  return map[priority] ?? priority;
}

/** Retorna a variante do Badge shadcn/ui correspondente à prioridade */
export function variantePrioridade(
  priority: TaskPriority,
): "destructive" | "default" | "outline" | "secondary" {
  const map: Record<TaskPriority, "destructive" | "default" | "outline" | "secondary"> = {
    critical: "destructive",
    high: "default",
    medium: "outline",
    low: "secondary",
  };
  return map[priority] ?? "outline";
}

/** Retorna classe CSS Tailwind para a cor da prioridade */
export function corPrioridade(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    critical: "text-red-600 dark:text-red-400",
    high: "text-amber-600 dark:text-amber-400",
    medium: "text-blue-600 dark:text-blue-400",
    low: "text-gray-500 dark:text-gray-400",
  };
  return map[priority] ?? "text-gray-500";
}

export function estaVencida(task: SupplierPendingTask): boolean {
  if (!task.due_date) return false;
  if (task.status !== "open" && task.status !== "in_progress") return false;
  return new Date(task.due_date) < new Date();
}

// ---------------------------------------------------------------------------
// Funções de banco de dados
// ---------------------------------------------------------------------------

export async function listarTarefasFornecedor(
  tenantId: string,
  supplierId: string,
  filtros?: {
    status?: TaskStatus | undefined;
    priority?: TaskPriority | undefined;
    task_type?: TaskType | undefined;
  },
): Promise<SupplierPendingTask[]> {
  const { data, error } = await supabase.rpc("list_supplier_pending_tasks", {
    p_tenant_id: tenantId,
    p_supplier_id: supplierId,
    ...(filtros?.status ? { p_status: filtros.status } : {}),
    ...(filtros?.priority ? { p_priority: filtros.priority } : {}),
    ...(filtros?.task_type ? { p_task_type: filtros.task_type } : {}),
    p_limit: 100,
    p_offset: 0,
  });

  if (error) throw error;
  return (data as SupplierPendingTask[]) ?? [];
}

export async function listarTarefasAbertas(
  tenantId: string,
  filtros?: { priority?: TaskPriority | undefined; task_type?: TaskType | undefined },
): Promise<SupplierPendingTask[]> {
  const { data, error } = await supabase.rpc("list_supplier_pending_tasks", {
    p_tenant_id: tenantId,
    p_status: "open",
    ...(filtros?.priority ? { p_priority: filtros.priority } : {}),
    ...(filtros?.task_type ? { p_task_type: filtros.task_type } : {}),
    p_limit: 200,
    p_offset: 0,
  });

  if (error) throw error;
  return (data as SupplierPendingTask[]) ?? [];
}

export async function resumoTarefas(tenantId: string): Promise<TasksSummary> {
  const { data, error } = await supabase.rpc("get_supplier_pending_tasks_summary", {
    p_tenant_id: tenantId,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    open_count: Number(row?.open_count ?? 0),
    critical_count: Number(row?.critical_count ?? 0),
    overdue_count: Number(row?.overdue_count ?? 0),
    high_count: Number(row?.high_count ?? 0),
  };
}

export async function criarTarefa(params: CreateTaskParams): Promise<string> {
  const { data, error } = await supabase.rpc("create_supplier_task", {
    p_tenant_id: params.tenant_id,
    p_supplier_id: params.supplier_id,
    p_task_type: params.task_type,
    p_title: params.title,
    ...(params.description ? { p_description: params.description } : {}),
    p_priority: params.priority ?? "medium",
    ...(params.due_date ? { p_due_date: params.due_date } : {}),
    ...(params.assigned_to ? { p_assigned_to: params.assigned_to } : {}),
    ...(params.reference_table ? { p_reference_table: params.reference_table } : {}),
    ...(params.reference_id ? { p_reference_id: params.reference_id } : {}),
  });

  if (error) throw error;
  return data as string;
}

export async function resolverTarefa(params: ResolveTaskParams): Promise<boolean> {
  const { data, error } = await supabase.rpc("resolve_supplier_task", {
    p_tenant_id: params.tenant_id,
    p_task_id: params.task_id,
    ...(params.resolution_notes ? { p_resolution_notes: params.resolution_notes } : {}),
    p_action: params.action ?? "resolved",
  });

  if (error) throw error;
  return Boolean(data);
}
