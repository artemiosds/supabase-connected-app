import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  FileText,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { AnimatedList, FlowingMenu, type FlowingMenuItem } from "@/components/ui/primus-motion";
import {
  criticidadeTarefa,
  montarMinhasTarefas,
  type ContratoMinhaTarefa,
  type DocumentoMinhaTarefa,
  type EtapaMinhaTarefa,
  type MinhaTarefa,
  type ProcessoMinhaTarefa,
} from "@/lib/my-tasks";

type TaskState = {
  tenantId: string;
  userId: string;
  pending: boolean;
  partial: boolean;
  items: MinhaTarefa[];
  canCreateDocuments: boolean;
  canViewSuppliers: boolean;
  canCreateSuppliers: boolean;
};

const EMPTY: TaskState = {
  tenantId: "",
  userId: "",
  pending: true,
  partial: false,
  items: [],
  canCreateDocuments: false,
  canViewSuppliers: false,
  canCreateSuppliers: false,
};

function prazo(dias: number | null): string {
  if (dias === null) return "Ação pendente";
  if (dias < 0) return `Vencido há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return "Vence hoje";
  return `Vence em ${dias} dia(s)`;
}

function classePrazo(dias: number | null): string {
  const level = criticidadeTarefa(dias);
  if (level === "critical") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (level === "attention") return "border-warning/35 bg-warning/15 text-foreground";
  if (level === "info") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

export function MyTasks({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [state, setState] = useState<TaskState>(EMPTY);
  const [filtro, setFiltro] = useState<"todas" | "urgentes" | MinhaTarefa["tipo"]>("todas");

  useEffect(() => {
    let active = true;
    setState({ ...EMPTY, tenantId, userId });
    if (!tenantId || !userId)
      return () => {
        active = false;
      };

    async function load() {
      const [
        processesResult,
        stagesResult,
        contractsResult,
        profileResult,
        documentCap,
        supplierCap,
      ] = await Promise.allSettled([
        carregarTodasAsPaginas<ProcessoMinhaTarefa>((start, end) =>
          db
            .from("procurement_processes")
            .select("id,number,title,stage,status,responsible_user_id,responsible_name,due_date")
            .eq("tenant_id", tenantId)
            .neq("status", "arquivado")
            .neq("status", "concluido")
            .order("id")
            .range(start, end),
        ),
        carregarTodasAsPaginas<EtapaMinhaTarefa>((start, end) =>
          db
            .from("process_items")
            .select("process_id,stage,title,is_done,responsible_user_id,responsible_name")
            .eq("tenant_id", tenantId)
            .eq("is_done", false)
            .order("id")
            .range(start, end),
        ),
        carregarTodasAsPaginas<ContratoMinhaTarefa>((start, end) =>
          db
            .from("contracts")
            .select("id,number,supplier_id,end_date,status,manager_user_id,inspector_user_id")
            .eq("tenant_id", tenantId)
            .eq("status", "vigente")
            .order("id")
            .range(start, end),
        ),
        db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
        db.rpc("get_document_capabilities", { p_tenant_id: tenantId }),
        db.rpc("get_supplier_capabilities", { p_tenant_id: tenantId }),
      ]);

      const processes = processesResult.status === "fulfilled" ? processesResult.value : [];
      const stages = stagesResult.status === "fulfilled" ? stagesResult.value : [];
      const contracts = contractsResult.status === "fulfilled" ? contractsResult.value : [];
      const fullName =
        profileResult.status === "fulfilled" && !profileResult.value.error
          ? (profileResult.value.data?.full_name ?? null)
          : null;
      const suppliers = Array.from(
        new Set(
          contracts
            .filter((c) => c.manager_user_id === userId || c.inspector_user_id === userId)
            .map((c) => c.supplier_id)
            .filter((id): id is string => !!id),
        ),
      );

      let documents: DocumentoMinhaTarefa[] = [];
      let documentsFailed = false;
      if (suppliers.length > 0) {
        try {
          documents = await carregarTodasAsPaginas<DocumentoMinhaTarefa>((start, end) =>
            db
              .from("supplier_documents")
              .select("id,supplier_id,title,document_type,expires_at,status")
              .eq("tenant_id", tenantId)
              .eq("status", "active")
              .in("supplier_id", suppliers)
              .not("expires_at", "is", null)
              .order("id")
              .range(start, end),
          );
        } catch {
          documentsFailed = true;
        }
      }

      if (!active) return;
      const canCreateDocuments =
        documentCap.status === "fulfilled" &&
        !documentCap.value.error &&
        documentCap.value.data?.[0]?.can_create === true;
      const canViewSuppliers =
        supplierCap.status === "fulfilled" &&
        !supplierCap.value.error &&
        supplierCap.value.data?.[0]?.can_view === true;
      const canCreateSuppliers =
        supplierCap.status === "fulfilled" &&
        !supplierCap.value.error &&
        supplierCap.value.data?.[0]?.can_create === true;
      setState({
        tenantId,
        userId,
        pending: false,
        partial:
          processesResult.status === "rejected" ||
          stagesResult.status === "rejected" ||
          contractsResult.status === "rejected" ||
          documentsFailed,
        items: montarMinhasTarefas(userId, fullName, processes, stages, contracts, documents),
        canCreateDocuments,
        canViewSuppliers,
        canCreateSuppliers,
      });
    }

    void load();
    return () => {
      active = false;
    };
  }, [tenantId, userId]);

  const current = state.tenantId === tenantId && state.userId === userId ? state : EMPTY;
  const urgentes = current.items.filter(
    (task) => criticidadeTarefa(task.dias) === "critical",
  ).length;
  const processos = current.items.filter((task) => task.tipo === "processo").length;
  const contratos = current.items.filter((task) => task.tipo === "contrato").length;
  const certidoes = current.items.filter((task) => task.tipo === "certidao").length;
  const filtros = [
    { value: "todas", label: "Todas", count: current.items.length },
    { value: "urgentes", label: "Urgentes", count: urgentes },
    { value: "processo", label: "Processos", count: processos },
    { value: "contrato", label: "Contratos", count: contratos },
    { value: "certidao", label: "Certidões", count: certidoes },
  ] as const;
  const tarefasVisiveis = current.items.filter((task) =>
    filtro === "todas"
      ? true
      : filtro === "urgentes"
        ? criticidadeTarefa(task.dias) === "critical"
        : task.tipo === filtro,
  );

  // O menu mostra somente ações autorizadas pelas RPCs do tenant ativo.
  const quickActions: FlowingMenuItem[] = [
    ...(current.canCreateDocuments
      ? [
          {
            id: "dfd",
            text: "Nova demanda (DFD)",
            description: "Iniciar solicitação",
            href: "/processos?novo=dfd",
            icon: Plus,
            featured: true,
          },
          {
            id: "contract",
            text: "Novo contrato",
            description: "Registrar contratação",
            href: "/contratos?novo=1",
            icon: FilePlus2,
          },
        ]
      : []),
    ...(current.canViewSuppliers
      ? [
          {
            id: "supplier",
            text: "Consultar fornecedor",
            description: "Buscar por CNPJ",
            href: current.canCreateSuppliers
              ? "/fornecedores?consulta=cnpj"
              : "/fornecedores",
            icon: Search,
          },
        ]
      : []),
  ];

  return (
    <section className="space-y-4" aria-labelledby="minhas-tarefas-titulo">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-primary">
            Sua mesa de trabalho
          </p>
          <h2
            id="minhas-tarefas-titulo"
            className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Minhas Tarefas e Obrigações
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O que está sob sua responsabilidade, organizado por prioridade.
          </p>
        </div>
        <Badge variant="outline" className="rounded-full bg-card px-3 py-1.5 text-xs font-medium">
          <span
            className="mr-1.5 inline-block size-1.5 rounded-full bg-primary"
            aria-hidden="true"
          />
          {current.pending
            ? "Consultando suas tarefas"
            : `${current.items.length} pendência(s) identificada(s)`}
        </Badge>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(275px,0.85fr)]">
        <div className="order-2 min-w-0 overflow-hidden rounded-2xl border border-border/75 bg-card shadow-sm lg:order-1">
          <div className="border-b border-border/70 px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Visão pessoal
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Secretaria ativa
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 divide-x divide-border/70">
              <div className="pr-3 sm:pr-5">
                <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">
                  Total de tarefas
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                  {current.pending ? "—" : current.items.length}
                </p>
              </div>
              <div className="px-3 sm:px-5">
                <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">Urgentes</p>
                <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-destructive">
                  {current.pending ? "—" : urgentes}
                </p>
              </div>
              <div className="pl-3 sm:pl-5">
                <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">
                  Contratos
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                  {current.pending ? "—" : contratos}
                </p>
              </div>
            </div>
          </div>

          <div className="border-b border-border/70 px-4 py-3 sm:px-6">
            <div
              className="flex gap-1.5 overflow-x-auto pb-1"
              role="group"
              aria-label="Filtrar tarefas por categoria"
            >
              {filtros.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filtro === item.value}
                  onClick={() => setFiltro(item.value)}
                  className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    filtro === item.value
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-transparent bg-muted/60 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${filtro === item.value ? "bg-primary-foreground/15" : "bg-background/80"}`}
                  >
                    {current.pending ? "—" : item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {current.partial && (
            <div
              role="status"
              className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-foreground sm:mx-6"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Algumas fontes não puderam ser consultadas. A lista pode estar incompleta.
            </div>
          )}

          {current.pending ? (
            <div
              className="flex min-h-52 items-center justify-center gap-3 px-5 py-10 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
              Consultando suas responsabilidades…
            </div>
          ) : current.items.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-[20px] border border-success/15 bg-success/10 text-success">
                <CheckCircle2 className="size-8" aria-hidden="true" />
              </div>
              <p className="mt-5 text-lg font-semibold tracking-tight">
                {current.partial
                  ? "Nenhuma pendência disponível"
                  : "Tudo em dia com seus processos e contratos!"}
              </p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {current.partial
                  ? "Não foi possível verificar todas as fontes de informação neste momento."
                  : "Quando houver processos, contratos ou certidões sob sua responsabilidade, eles aparecerão aqui com os próximos passos."}
              </p>
              {!current.partial && (
                <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Sem pendências identificadas
                </span>
              )}
            </div>
          ) : tarefasVisiveis.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
              <CheckCircle2 className="size-7 text-primary" aria-hidden="true" />
              <p className="mt-3 font-semibold">Nenhuma tarefa nesta categoria</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Selecione outro filtro para consultar suas responsabilidades.
              </p>
            </div>
          ) : (
            <AnimatedList
              items={tarefasVisiveis}
              ariaLabel="Pendências sob sua responsabilidade"
              maxHeight={540}
              renderItem={(task) => {
                const Icon =
                  task.tipo === "processo"
                    ? FolderKanban
                    : task.tipo === "contrato"
                      ? ClipboardList
                      : FileText;
                const critical = criticidadeTarefa(task.dias) === "critical";
                const attention = criticidadeTarefa(task.dias) === "attention";
                const detalhe = `${task.destino}?${task.tipo === "processo" ? "processo" : task.tipo === "contrato" ? "contrato" : "documento"}=${encodeURIComponent(task.entityId)}`;
                return (
                  <div className="group relative bg-card transition-colors hover:bg-muted/25">
                    <div
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 w-[3px] ${critical ? "bg-destructive" : attention ? "bg-warning" : "bg-primary/60"}`}
                    />
                    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
                      <div
                        className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${critical ? "border-destructive/15 bg-destructive/10 text-destructive" : "border-primary/10 bg-primary/10 text-primary"}`}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold leading-relaxed sm:text-base">
                            {task.titulo}
                          </p>
                          <Badge variant="outline" className={classePrazo(task.dias)}>
                            {prazo(task.dias)}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                          {task.descricao}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                          {task.tipo === "processo"
                            ? "Processo administrativo"
                            : task.tipo === "contrato"
                              ? "Gestão e fiscalização"
                              : "Regularidade documental"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="w-full shrink-0 rounded-lg sm:w-auto"
                      >
                        <a href={detalhe} aria-label={`Ver detalhes: ${task.titulo}`}>
                          Ver detalhes
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        </a>
                      </Button>
                    </div>
                  </div>
                );
              }}
            />
          )}

          <div className="flex items-start gap-2 border-t border-border/70 bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground sm:px-6">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Pendências visíveis somente conforme seu vínculo e suas permissões na Secretaria
            selecionada.
          </div>
        </div>

        <aside className="order-1 space-y-4 lg:order-2" aria-label="Atalhos operacionais">
          <div className="overflow-hidden rounded-2xl border border-border/75 bg-card shadow-sm">
            <div className="border-b border-border/65 bg-muted/20 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
                Acesso imediato
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight">Ações rápidas</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Comece as rotinas mais frequentes sem percorrer o menu.
              </p>
            </div>
            <div className="p-3 sm:p-4">
              {quickActions.length > 0 && (
                <FlowingMenu items={quickActions} ariaLabel="Ações rápidas da Secretaria" />
              )}
              {!current.pending && quickActions.length === 0 && (
                <p className="rounded-lg bg-muted/40 px-3 py-4 text-sm leading-relaxed text-muted-foreground">
                  Seus atalhos serão apresentados conforme as permissões atribuídas à sua conta.
                </p>
              )}
              {current.pending && (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Verificando permissões…
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border/75 bg-muted/25 p-5">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Prioridades por prazo
              </p>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-xs font-medium">
                  <span className="size-2.5 rounded-full bg-destructive" aria-hidden="true" />
                  Crítico · menos de 30 dias
                </span>
                <span className="text-xs font-bold tabular-nums">
                  {current.pending ? "—" : urgentes}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-xs font-medium">
                  <span className="size-2.5 rounded-full bg-warning" aria-hidden="true" />
                  Atenção · 30 a 60 dias
                </span>
                <span className="text-xs font-bold tabular-nums">
                  {current.pending
                    ? "—"
                    : current.items.filter((task) => criticidadeTarefa(task.dias) === "attention")
                        .length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-xs font-medium">
                  <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
                  Planejamento · 61 a 120 dias
                </span>
                <span className="text-xs font-bold tabular-nums">
                  {current.pending
                    ? "—"
                    : current.items.filter((task) => criticidadeTarefa(task.dias) === "info")
                        .length}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
