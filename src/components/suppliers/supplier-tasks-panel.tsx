import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  PlusCircle,
  RefreshCw,
  XCircle,
  Filter,
  Check,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  listarTarefasFornecedor,
  criarTarefa,
  resolverTarefa,
  rotuloTipoTarefa,
  rotuloStatusTarefa,
  rotuloPrioridade,
  variantePrioridade,
  estaVencida,
  type SupplierPendingTask,
  type TaskType,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/supplier-tasks";

interface SupplierTasksPanelProps {
  tenantId: string;
  supplierId: string;
  canEdit: boolean;
}

export function SupplierTasksPanel({
  tenantId,
  supplierId,
  canEdit,
}: SupplierTasksPanelProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<SupplierPendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all">("all");
  const [filterPriority, setFilterPriority] = useState<TaskPriority | "all">("all");

  // Modal de Nova Tarefa
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTaskType, setNewTaskType] = useState<TaskType>("manual");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  // Modal de Resolução
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [taskToResolve, setTaskToResolve] = useState<SupplierPendingTask | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolvingAction, setResolvingAction] = useState<"resolved" | "dismissed">("resolved");
  const [savingResolution, setSavingResolution] = useState(false);

  const carregarTarefas = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listarTarefasFornecedor(tenantId, supplierId, {
        status: filterStatus === "all" ? undefined : filterStatus,
        priority: filterPriority === "all" ? undefined : filterPriority,
      });
      setTasks(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast({
        title: "Erro ao carregar pendências",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [tenantId, supplierId, filterStatus, filterPriority, toast]);

  useEffect(() => {
    carregarTarefas();
  }, [carregarTarefas]);

  const handleCriarTarefa = async () => {
    if (!newTitle.trim()) {
      toast({
        title: "Título obrigatório",
        description: "Por favor informe o título da tarefa.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingTask(true);
      await criarTarefa({
        tenant_id: tenantId,
        supplier_id: supplierId,
        task_type: newTaskType,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        priority: newPriority,
        due_date: newDueDate || undefined,
      });

      toast({
        title: "Tarefa registrada",
        description: "A pendência foi adicionada à fila com sucesso.",
      });

      setNewModalOpen(false);
      setNewTitle("");
      setNewDescription("");
      setNewDueDate("");
      setNewPriority("medium");
      setNewTaskType("manual");
      await carregarTarefas();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao criar tarefa";
      toast({
        title: "Falha ao registrar",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSavingTask(false);
    }
  };

  const handleResolverTarefa = async () => {
    if (!taskToResolve) return;

    try {
      setSavingResolution(true);
      await resolverTarefa({
        tenant_id: tenantId,
        task_id: taskToResolve.id,
        resolution_notes: resolutionNotes.trim() || undefined,
        action: resolvingAction,
      });

      toast({
        title: resolvingAction === "resolved" ? "Tarefa resolvida" : "Tarefa dispensada",
        description: "Status atualizado com sucesso.",
      });

      setResolveModalOpen(false);
      setTaskToResolve(null);
      setResolutionNotes("");
      await carregarTarefas();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao resolver tarefa";
      toast({
        title: "Falha ao atualizar",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSavingResolution(false);
    }
  };

  // KPIs
  const openCount = tasks.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const criticalCount = tasks.filter(
    (t) => (t.status === "open" || t.status === "in_progress") && t.priority === "critical"
  ).length;
  const overdueCount = tasks.filter(estaVencida).length;

  return (
    <div className="space-y-6">
      {/* Header com KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Abertas / Em Curso
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold">{openCount}</div>
            <p className="text-xs text-muted-foreground mt-1">pendências ativas</p>
          </CardContent>
        </Card>

        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs font-medium text-destructive uppercase tracking-wider flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Prioridade Crítica
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold text-destructive">{criticalCount}</div>
            <p className="text-xs text-destructive/80 mt-1">ação imediata</p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Prazos Vencidos
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {overdueCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">data limite expirada</p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Registradas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold">{tasks.length}</div>
            <p className="text-xs text-muted-foreground mt-1">histórico completo</p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Ações e Filtros */}
      <Card className="border-border">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-primary" />
                Fila de Tarefas e Pendências Operacionais
              </CardTitle>
              <CardDescription>
                Alertas automáticos por vencimento de certidões, inconsistências cadastrais e tarefas da equipe.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => carregarTarefas()}
                disabled={loading}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
              {canEdit && (
                <Button size="sm" onClick={() => setNewModalOpen(true)}>
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
                  Nova Tarefa
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Filter className="w-3.5 h-3.5" />
              Filtros:
            </div>

            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as TaskStatus | "all")}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Status</SelectItem>
                <SelectItem value="open">Abertas</SelectItem>
                <SelectItem value="in_progress">Em Andamento</SelectItem>
                <SelectItem value="resolved">Resolvidas</SelectItem>
                <SelectItem value="dismissed">Dispensadas</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterPriority}
              onValueChange={(v) => setFilterPriority(v as TaskPriority | "all")}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Prioridades</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tabela de Tarefas */}
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
              Carregando pendências...
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
              Nenhuma pendência encontrada para este fornecedor com os filtros selecionados.
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[100px]">Prioridade</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                    <TableHead>Título e Descrição</TableHead>
                    <TableHead className="w-[140px]">Tipo</TableHead>
                    <TableHead className="w-[120px]">Prazo Limite</TableHead>
                    <TableHead className="w-[100px]">Origem</TableHead>
                    {canEdit && <TableHead className="w-[110px] text-right">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => {
                    const vencida = estaVencida(task);
                    const ativa = task.status === "open" || task.status === "in_progress";

                    return (
                      <TableRow key={task.id} className="hover:bg-muted/40 transition-colors">
                        <TableCell>
                          <Badge variant={variantePrioridade(task.priority)} className="text-xs">
                            {rotuloPrioridade(task.priority)}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant={
                              task.status === "resolved"
                                ? "outline"
                                : task.status === "dismissed"
                                ? "secondary"
                                : "default"
                            }
                            className="text-xs"
                          >
                            {rotuloStatusTarefa(task.status)}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="font-medium text-sm text-foreground">
                              {task.title}
                            </div>
                            {task.description && (
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {task.description}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {rotuloTipoTarefa(task.task_type)}
                          </span>
                        </TableCell>

                        <TableCell>
                          {task.due_date ? (
                            <span
                              className={`text-xs flex items-center gap-1 ${
                                vencida
                                  ? "text-destructive font-semibold"
                                  : "text-muted-foreground"
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                              {new Date(task.due_date).toLocaleDateString("pt-BR")}
                              {vencida && " (Vencido)"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {task.auto_generated ? "Automática" : "Manual"}
                          </Badge>
                        </TableCell>

                        {canEdit && (
                          <TableCell className="text-right">
                            {ativa ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                  onClick={() => {
                                    setTaskToResolve(task);
                                    setResolvingAction("resolved");
                                    setResolutionNotes("");
                                    setResolveModalOpen(true);
                                  }}
                                  title="Resolver Tarefa"
                                >
                                  <Check className="w-3.5 h-3.5 mr-1" />
                                  Resolver
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setTaskToResolve(task);
                                    setResolvingAction("dismissed");
                                    setResolutionNotes("");
                                    setResolveModalOpen(true);
                                  }}
                                  title="Dispensar Tarefa"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Concluída</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal: Nova Tarefa */}
      <Dialog open={newModalOpen} onOpenChange={setNewModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Registrar Nova Pendência</DialogTitle>
            <DialogDescription>
              Adicione uma tarefa à fila de regularidade e acompanhamento deste fornecedor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-type" className="text-xs">
                  Tipo da Pendência
                </Label>
                <Select
                  value={newTaskType}
                  onValueChange={(v) => setNewTaskType(v as TaskType)}
                >
                  <SelectTrigger id="task-type" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Tarefa Manual</SelectItem>
                    <SelectItem value="document_expired">Documento Vencido</SelectItem>
                    <SelectItem value="document_expiring">Documento a Vencer</SelectItem>
                    <SelectItem value="regularity_irregular">Irregularidade Detectada</SelectItem>
                    <SelectItem value="homologation_pending">Homologação Pendente</SelectItem>
                    <SelectItem value="complementation_requested">
                      Complementação Solicitada
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-priority" className="text-xs">
                  Prioridade
                </Label>
                <Select
                  value={newPriority}
                  onValueChange={(v) => setNewPriority(v as TaskPriority)}
                >
                  <SelectTrigger id="task-priority" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Crítica (Imediata)</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="low">Baixa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-title" className="text-xs">
                Título da Pendência *
              </Label>
              <Input
                id="task-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Solicitar Certidão Negativa Estadual atualizada"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-description" className="text-xs">
                Descrição e Instruções
              </Label>
              <Textarea
                id="task-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Detalhes adicionais, orientações para a equipe ou prazos legais..."
                rows={3}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-due-date" className="text-xs">
                Data Limite para Solução (Opcional)
              </Label>
              <Input
                id="task-due-date"
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewModalOpen(false)}
              disabled={savingTask}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCriarTarefa} disabled={savingTask}>
              {savingTask ? "Salvando..." : "Registrar Tarefa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Resolver / Dispensar Tarefa */}
      <Dialog open={resolveModalOpen} onOpenChange={setResolveModalOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {resolvingAction === "resolved" ? "Resolver Pendência" : "Dispensar Pendência"}
            </DialogTitle>
            <DialogDescription>
              {resolvingAction === "resolved"
                ? "Confirme a regularização desta pendência para retirá-la da fila ativa."
                : "Dispensar esta pendência caso não seja mais aplicável ou duplicada."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="p-3 bg-muted rounded-md text-xs space-y-1">
              <div className="font-semibold">{taskToResolve?.title}</div>
              {taskToResolve?.description && (
                <div className="text-muted-foreground">{taskToResolve.description}</div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="resolution-notes" className="text-xs">
                Justificativa / Notas de Conclusão (Opcional)
              </Label>
              <Textarea
                id="resolution-notes"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Ex: Certidão atualizada anexada e verificada com validade até 2026..."
                rows={3}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResolveModalOpen(false)}
              disabled={savingResolution}
            >
              Cancelar
            </Button>
            <Button
              variant={resolvingAction === "resolved" ? "default" : "secondary"}
              size="sm"
              onClick={handleResolverTarefa}
              disabled={savingResolution}
            >
              {savingResolution
                ? "Gravando..."
                : resolvingAction === "resolved"
                ? "Confirmar Resolução"
                : "Dispensar Tarefa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
