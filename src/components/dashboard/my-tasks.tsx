import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, FilePlus2, FileSearch, Loader2, Plus, Search, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { carregarTodasAsPaginas, db } from "@/lib/db";
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
  if (level === "attention") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (level === "info") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

export function MyTasks({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [state, setState] = useState<TaskState>(EMPTY);

  useEffect(() => {
    let active = true;
    setState({ ...EMPTY, tenantId, userId });
    if (!tenantId || !userId) return () => { active = false; };

    async function load() {
      const [processesResult, stagesResult, contractsResult, profileResult, documentCap, supplierCap] =
        await Promise.allSettled([
          carregarTodasAsPaginas<ProcessoMinhaTarefa>((start, end) =>
            db.from("procurement_processes")
              .select("id,number,title,stage,status,responsible_user_id,responsible_name,due_date")
              .eq("tenant_id", tenantId).neq("status", "arquivado").neq("status", "concluido")
              .order("id").range(start, end),
          ),
          carregarTodasAsPaginas<EtapaMinhaTarefa>((start, end) =>
            db.from("process_items")
              .select("process_id,stage,title,is_done,responsible_user_id,responsible_name")
              .eq("tenant_id", tenantId).eq("is_done", false)
              .order("id").range(start, end),
          ),
          carregarTodasAsPaginas<ContratoMinhaTarefa>((start, end) =>
            db.from("contracts")
              .select("id,number,supplier_id,end_date,status,manager_user_id,inspector_user_id")
              .eq("tenant_id", tenantId).eq("status", "vigente")
              .order("id").range(start, end),
          ),
          db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
          db.rpc("get_document_capabilities", { p_tenant_id: tenantId }),
          db.rpc("get_supplier_capabilities", { p_tenant_id: tenantId }),
        ]);

      const processes = processesResult.status === "fulfilled" ? processesResult.value : [];
      const stages = stagesResult.status === "fulfilled" ? stagesResult.value : [];
      const contracts = contractsResult.status === "fulfilled" ? contractsResult.value : [];
      const fullName = profileResult.status === "fulfilled" && !profileResult.value.error
        ? profileResult.value.data?.full_name ?? null : null;
      const suppliers = Array.from(new Set(
        contracts
          .filter((c) => c.manager_user_id === userId || c.inspector_user_id === userId)
          .map((c) => c.supplier_id)
          .filter((id): id is string => !!id),
      ));

      let documents: DocumentoMinhaTarefa[] = [];
      let documentsFailed = false;
      if (suppliers.length > 0) {
        try {
          documents = await carregarTodasAsPaginas<DocumentoMinhaTarefa>((start, end) =>
            db.from("supplier_documents")
              .select("id,supplier_id,title,document_type,expires_at,status")
              .eq("tenant_id", tenantId).eq("status", "active")
              .in("supplier_id", suppliers).not("expires_at", "is", null)
              .order("id").range(start, end),
          );
        } catch {
          documentsFailed = true;
        }
      }

      if (!active) return;
      const canCreateDocuments = documentCap.status === "fulfilled" &&
        !documentCap.value.error && documentCap.value.data?.[0]?.can_create === true;
      const canViewSuppliers = supplierCap.status === "fulfilled" &&
        !supplierCap.value.error && supplierCap.value.data?.[0]?.can_view === true;
      const canCreateSuppliers = supplierCap.status === "fulfilled" &&
        !supplierCap.value.error && supplierCap.value.data?.[0]?.can_create === true;
      setState({
        tenantId,
        userId,
        pending: false,
        partial: processesResult.status === "rejected" || stagesResult.status === "rejected" ||
          contractsResult.status === "rejected" || documentsFailed,
        items: montarMinhasTarefas(userId, fullName, processes, stages, contracts, documents),
        canCreateDocuments,
        canViewSuppliers,
        canCreateSuppliers,
      });
    }

    void load();
    return () => { active = false; };
  }, [tenantId, userId]);

  const current = state.tenantId === tenantId && state.userId === userId ? state : EMPTY;

  return (
    <section className="space-y-4" aria-labelledby="minhas-tarefas-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="minhas-tarefas-titulo" className="text-lg font-semibold tracking-tight">
            Minhas Tarefas e Obrigações
          </h2>
          <p className="text-sm text-muted-foreground">
            Responsabilidades vinculadas à sua conta e à Secretaria selecionada.
          </p>
        </div>
        <Badge variant="outline">{current.pending ? "Consultando" : `${current.items.length} pendência(s)`}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {current.canCreateDocuments && (
          <Button size="sm" asChild>
            <a href="/processos?novo=dfd"><Plus className="h-4 w-4" /> Nova Demanda (DFD)</a>
          </Button>
        )}
        {current.canViewSuppliers && (
          <Button size="sm" variant="outline" asChild>
            <a href={current.canCreateSuppliers ? "/fornecedores?consulta=cnpj" : "/fornecedores"}>
              <Search className="h-4 w-4" /> Consultar Fornecedor (CNPJ)
            </a>
          </Button>
        )}
        {current.canCreateDocuments && (
          <Button size="sm" variant="outline" asChild>
            <a href="/contratos?novo=1"><FilePlus2 className="h-4 w-4" /> Novo Contrato</a>
          </Button>
        )}
      </div>

      {current.partial && (
        <div className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          Algumas pendências não puderam ser consultadas com suas permissões. Os resultados abaixo podem estar incompletos.
        </div>
      )}
      {current.pending ? (
        <Card><CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando suas responsabilidades…
        </CardContent></Card>
      ) : current.items.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-9 text-center">
          <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden />
          <p className="font-medium">{current.partial ? "Nenhuma pendência disponível" : "Tudo em dia com seus processos e contratos!"}</p>
          <p className="max-w-lg text-sm text-muted-foreground">
            {current.partial
              ? "Não foi possível verificar todas as fontes de informação."
              : "Nenhuma tarefa atribuída ou certidão sob sua fiscalização exige atenção no período consultado."}
          </p>
        </CardContent></Card>
      ) : (
        <div className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {current.items.map((task) => (
            <Card key={task.id} className="h-full">
              <CardHeader className="space-y-2 pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">
                    {task.tipo === "processo" ? "Processo" : task.tipo === "contrato" ? "Contrato" : "Certidão"}
                  </Badge>
                  <Badge variant="outline" className={classePrazo(task.dias)}>{prazo(task.dias)}</Badge>
                </div>
                <CardTitle className="text-base leading-snug">{task.titulo}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-3 min-h-10 text-sm text-muted-foreground">{task.descricao}</p>
                <Button size="sm" variant="outline" asChild>
                  <a href={`${task.destino}?${task.tipo === "processo" ? "processo" : task.tipo === "contrato" ? "contrato" : "documento"}=${encodeURIComponent(task.entityId)}`}>
                    <FileSearch className="h-4 w-4" /> Ver detalhes
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Exibição limitada aos registros autorizados da Secretaria ativa. A consulta não modifica processos ou contratos.
      </p>
    </section>
  );
}
