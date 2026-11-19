import { AssigneeSelect, useAssignees } from "@/components/assignee-select";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
  Loader2,
  Plus,
  Archive,
  ClipboardList,
  Coins,
  Search,
  FileText,
  ExternalLink,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import type { CsvColumn } from "@/lib/csv-export";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  ETAPAS,
  etapaAnterior,
  formatarData,
  formatarMoeda,
  MODALIDADES,
  numeroDecimal,
  proximaEtapa,
  type EtapaId,
} from "@/lib/contratacao";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  calcularResumoDePrecos,
  calcularPrecoHomologado,
  analisarDispersaoPrecos,
  expurgarAmostrasInconsistentes,
  gerarCsvMapaDePrecos,
  precoUnitarioComFrete,
  type CotacaoMapa,
  type ItemMapa,
} from "@/lib/pesquisa-precos";

export const Route = createFileRoute("/_authenticated/processos")({
  head: () => ({
    meta: [
      { title: "Processos de contratação — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Esteira de processos: DFD, ETP, riscos, Termo de Referência, pesquisa e parecer.",
      },
    ],
  }),
  component: Processos,
});

type Processo = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  modality: string;
  stage: EtapaId;
  status: string;
  priority: string;
  requesting_unit: string | null;
  responsible_name: string | null;
  responsible_user_id: string | null;
  estimated_value: number | null;
  due_date: string | null;
};
type Item = {
  id: string;
  process_id: string;
  stage: EtapaId;
  title: string;
  is_done: boolean;
  sort_order: number;
  responsible_name: string | null;
  responsible_user_id: string | null;
  due_date: string | null;
};

function ehEtapa(valor: string): valor is EtapaId {
  return ETAPAS.some((e) => e.id === valor);
}

// O banco tipa `stage` como texto; mantém somente linhas com etapa conhecida.
function comEtapaValida<T extends { stage: string }>(
  linhas: T[],
): (Omit<T, "stage"> & { stage: EtapaId })[] {
  return linhas.flatMap((l) => {
    const { stage } = l;
    return ehEtapa(stage) ? [{ ...l, stage }] : [];
  });
}

const corPrioridade: Record<string, string> = {
  urgente: "bg-destructive/15 text-destructive",
  alta: "bg-accent text-accent-foreground",
  normal: "bg-muted text-muted-foreground",
  baixa: "bg-muted text-muted-foreground",
};

function Processos() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [salvandoEtapaId, setSalvandoEtapaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<"kanban" | "lista">("kanban");
  const [novo, setNovo] = useState(false);
  const [novoViaDfd, setNovoViaDfd] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const members = useAssignees(abertoId ? selecionado?.id : undefined);
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("processo");
    if (id) setAbertoId(id);
    if (url.searchParams.get("novo") === "dfd") {
      setNovoViaDfd(true);
      setNovo(true);
      url.searchParams.delete("novo");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const [dadosAbertos, setDadosAbertos] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "em_andamento" | "concluido">("todos");
  const [filtroEtapa, setFiltroEtapa] = useState<"todas" | EtapaId>("todas");
  const [filtroModalidade, setFiltroModalidade] = useState("todas");
  const [tenantCarregadoId, setTenantCarregadoId] = useState<string | null>(null);
  const requisicaoRef = useRef(0);

  const carregar = useCallback(async () => {
    const requisicaoAtual = ++requisicaoRef.current;
    const tenantId = selecionado?.id;

    // Não exibe dados da Secretaria anterior enquanto a nova consulta carrega.
    setTenantCarregadoId(null);
    setProcessos([]);
    setItens([]);
    setErro(null);
    setPendente(false);

    if (!tenantId) {
      setTenantCarregadoId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [processosRows, checklistRows] = await Promise.all([
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("procurement_processes")
            .select("*")
            .eq("tenant_id", tenantId)
            .neq("status", "arquivado")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("process_items")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("sort_order")
            .order("id")
            .range(inicio, fim),
        ),
      ]);
      if (requisicaoAtual !== requisicaoRef.current) return;
      setProcessos(comEtapaValida(processosRows));
      setItens(comEtapaValida(checklistRows));
      setTenantCarregadoId(tenantId);
    } catch (error) {
      if (requisicaoAtual !== requisicaoRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      if (bancoNaoConfigurado(message)) setPendente(true);
      else setErro(message);
      setTenantCarregadoId(tenantId);
    } finally {
      if (requisicaoAtual === requisicaoRef.current) setLoading(false);
    }
  }, [selecionado?.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const progresso = (id: string) => {
    const lista = itens.filter((x) => x.process_id === id);
    return lista.length
      ? Math.round((lista.filter((x) => x.is_done).length / lista.length) * 100)
      : 0;
  };

  const termoBusca = busca.trim().toLocaleLowerCase("pt-BR");
  const processosFiltrados = processos.filter((processo) => {
    const correspondeBusca =
      !termoBusca ||
      [
        processo.number,
        processo.title,
        processo.description,
        processo.requesting_unit,
        processo.responsible_name,
      ]
        .filter(Boolean)
        .some((valor) => String(valor).toLocaleLowerCase("pt-BR").includes(termoBusca));
    const correspondeStatus =
      filtroStatus === "todos" ||
      (filtroStatus === "concluido"
        ? processo.status === "concluido"
        : processo.status !== "concluido");
    const correspondeEtapa = filtroEtapa === "todas" || processo.stage === filtroEtapa;
    const correspondeModalidade =
      filtroModalidade === "todas" || processo.modality === filtroModalidade;
    return correspondeBusca && correspondeStatus && correspondeEtapa && correspondeModalidade;
  });
  const etapasVisiveis =
    filtroEtapa === "todas" ? ETAPAS : ETAPAS.filter((etapa) => etapa.id === filtroEtapa);
  const filtrosAtivos =
    !!busca.trim() ||
    filtroStatus !== "todos" ||
    filtroEtapa !== "todas" ||
    filtroModalidade !== "todas";

  const colunasRelatorio: CsvColumn<Processo>[] = [
    { header: "Número", value: (processo) => processo.number },
    { header: "Objeto", value: (processo) => processo.title },
    {
      header: "Modalidade",
      value: (processo) => MODALIDADES[processo.modality] ?? processo.modality,
    },
    {
      header: "Etapa",
      value: (processo) =>
        ETAPAS.find((etapa) => etapa.id === processo.stage)?.nome ?? processo.stage,
    },
    { header: "Status", value: (processo) => processo.status },
    { header: "Responsável", value: (processo) => processo.responsible_name },
    { header: "Unidade solicitante", value: (processo) => processo.requesting_unit },
    { header: "Valor estimado", value: (processo) => processo.estimated_value },
    { header: "Prazo", value: (processo) => processo.due_date },
    { header: "Prioridade", value: (processo) => processo.priority },
    { header: "Progresso (%)", value: (processo) => progresso(processo.id) },
  ];

  async function moverEtapa(p: Processo, destino: EtapaId | null) {
    if (!destino) return;

    const pendentes = itens.filter(
      (item) => item.process_id === p.id && item.stage === p.stage && !item.is_done,
    );
    if (destino !== etapaAnterior(p.stage) && pendentes.length > 0) {
      toast.error(
        `Conclua os ${pendentes.length} item(ns) pendente(s) de "${ETAPAS.find((e) => e.id === p.stage)?.nome}" antes de avançar.`,
      );
      return;
    }

    const { error } = await db
      .from("procurement_processes")
      .update({ stage: destino, updated_by: userId })
      .eq("id", p.id)
      .eq("tenant_id", selecionado?.id ?? "");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Processo movido para ${ETAPAS.find((e) => e.id === destino)?.nome}.`);
    void carregar();
  }

  async function alternarItem(item: Item) {
    const { error } = await db
      .from("process_items")
      .update({ is_done: !item.is_done, updated_by: userId })
      .eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItens((s) => s.map((x) => (x.id === item.id ? { ...x, is_done: !x.is_done } : x)));
  }

  async function salvarResponsavelPrazoEtapa(item: Item) {
    setSalvandoEtapaId(item.id);
    const { error } = await db
      .from("process_items")
      .update({
        responsible_name: item.responsible_name?.trim() || null,
        due_date: item.due_date || null,
        updated_by: userId,
      })
      .eq("id", item.id)
      .eq("tenant_id", selecionado?.id ?? "");
    setSalvandoEtapaId(null);
    if (error) {
      toast.error("Não foi possível salvar o responsável e o prazo da etapa.");
      void carregar();
      return;
    }
    toast.success("Responsável e prazo da etapa salvos.");
  }

  async function concluir(p: Processo) {
    const pendentes = itens.filter((item) => item.process_id === p.id && !item.is_done);
    if (pendentes.length > 0) {
      toast.error(
        `Não é possível concluir: ainda existem ${pendentes.length} item(ns) pendente(s) no checklist.`,
      );
      return;
    }

    const { error } = await db
      .from("procurement_processes")
      .update({ status: "concluido", updated_by: userId })
      .eq("id", p.id)
      .eq("tenant_id", selecionado?.id ?? "");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Processo concluído.");
    setAbertoId(null);
    void carregar();
  }

  if (!selecionado) {
    return <p className="text-muted-foreground">Selecione uma organização no topo da tela.</p>;
  }

  if (loading || tenantCarregadoId !== selecionado.id) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando processos da Secretaria selecionada…
      </div>
    );
  }

  const aberto = processos.find((p) => p.id === abertoId) ?? null;

  const CartaoProcesso = ({ p }: { p: Processo }) => (
    <button
      type="button"
      onClick={() => setAbertoId(p.id)}
      className="w-full rounded-md border bg-card p-3 text-left text-sm shadow-sm transition-colors hover:border-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{p.number}</span>
        <Badge variant="outline" className={corPrioridade[p.priority]}>
          {p.priority}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-muted-foreground">{p.title}</p>
      <Progress value={progresso(p.id)} className="mt-2 h-1.5" />
      <p className="mt-1 text-xs text-muted-foreground">
        {progresso(p.id)}% dos documentos{p.status === "concluido" ? " · Concluído" : ""}
      </p>
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Processos de contratação</h1>
          <p className="text-sm text-muted-foreground">
            Do DFD à entrega para licitação, etapa por etapa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportExportActions
            title="Processos de contratação"
            filename={`processos-${new Date().toISOString().slice(0, 10)}.csv`}
            columns={colunasRelatorio}
            rows={processosFiltrados}
            disabled={loading}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisao(visao === "kanban" ? "lista" : "kanban")}
          >
            {visao === "kanban" ? <List className="h-4 w-4" /> : <Columns3 className="h-4 w-4" />}
            {visao === "kanban" ? "Ver em lista" : "Ver em quadro"}
          </Button>
          <Button onClick={() => setNovo(true)} disabled={pendente}>
            <Plus className="h-4 w-4" /> Novo processo
          </Button>
        </div>
      </div>

      {pendente && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Dados de processos indisponíveis</AlertTitle>
          <AlertDescription>
            Não foi possível acessar os dados de processos no momento. A estrutura do módulo já está
            preparada; verifique a conexão e as permissões de acesso ao banco antes de tentar
            novamente.
          </AlertDescription>
        </Alert>
      )}
      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(14rem,1fr)_auto_auto_auto_auto]">
          <div className="relative min-w-0">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar número, objeto, setor ou responsável"
              aria-label="Buscar processos de contratação"
              className="pl-9"
            />
          </div>
          <select
            value={filtroStatus}
            onChange={(event) => setFiltroStatus(event.target.value as typeof filtroStatus)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Filtrar processos por situação"
          >
            <option value="todos">Todas as situações</option>
            <option value="em_andamento">Em andamento</option>
            <option value="concluido">Concluídos</option>
          </select>
          <select
            value={filtroEtapa}
            onChange={(event) => setFiltroEtapa(event.target.value as typeof filtroEtapa)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Filtrar processos por etapa"
          >
            <option value="todas">Todas as etapas</option>
            {ETAPAS.map((etapa) => (
              <option key={etapa.id} value={etapa.id}>
                {etapa.nome}
              </option>
            ))}
          </select>
          <select
            value={filtroModalidade}
            onChange={(event) => setFiltroModalidade(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Filtrar processos por modalidade"
          >
            <option value="todas">Todas as modalidades</option>
            {Object.entries(MODALIDADES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!filtrosAtivos}
            onClick={() => {
              setBusca("");
              setFiltroStatus("todos");
              setFiltroEtapa("todas");
              setFiltroModalidade("todas");
            }}
          >
            Limpar filtros
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Exibindo {processosFiltrados.length} de {processos.length} processo(s).
        </p>
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : processosFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {processos.length === 0
              ? "Nenhum processo cadastrado."
              : "Nenhum processo corresponde aos filtros selecionados."}
          </CardContent>
        </Card>
      ) : visao === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {etapasVisiveis.map((e, idx) => {
            const daEtapa = processosFiltrados.filter((p) => p.stage === e.id);
            return (
              <div key={e.id} className="w-64 shrink-0 rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-semibold">
                  {idx + 1}. {e.nome}{" "}
                  <span className="font-normal text-muted-foreground">({daEtapa.length})</span>
                </p>
                <p className="mb-3 text-xs text-muted-foreground">{e.descricao}</p>
                <div className="space-y-2">
                  {daEtapa.length === 0 ? (
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Nenhum processo nesta etapa.
                    </p>
                  ) : (
                    daEtapa.map((p) => <CartaoProcesso key={p.id} p={p} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2">
          {processosFiltrados.map((p) => (
            <CartaoProcesso key={p.id} p={p} />
          ))}
        </div>
      )}

      <NovoProcesso
        aberto={novo}
        onFechar={() => {
          setNovo(false);
          setNovoViaDfd(false);
        }}
        tenantId={selecionado.id}
        userId={userId}
        onSalvo={(processoId) => {
          void carregar();
          if (novoViaDfd) {
            window.location.assign(
              `/documentos?processo=${encodeURIComponent(processoId)}&tipo=dfd`,
            );
          }
        }}
      />

      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAbertoId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {aberto && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {aberto.number} — {aberto.title}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <span>Modalidade: {MODALIDADES[aberto.modality]}</span>
                <span>Setor: {aberto.requesting_unit || "—"}</span>
                <span>Responsável: {aberto.responsible_name || "—"}</span>
                <label>
                  Usuário responsável pelo processo
                  <AssigneeSelect
                    label="Responsável pelo processo"
                    value={aberto.responsible_user_id}
                    members={members}
                    onChange={async (value) => {
                      const { data, error } = await db
                        .from("procurement_processes")
                        .update({ responsible_user_id: value || null, updated_by: userId })
                        .eq("tenant_id", selecionado.id)
                        .eq("id", aberto.id)
                        .select("id")
                        .maybeSingle();
                      if (error || !data)
                        return void toast.error("Não foi possível vincular o responsável.");
                      void carregar();
                    }}
                  />
                </label>
                <span>Valor estimado: {formatarMoeda(aberto.estimated_value)}</span>
                <span>Prazo: {formatarData(aberto.due_date)}</span>
                <span>
                  Etapa atual: <b>{ETAPAS.find((e) => e.id === aberto.stage)?.nome}</b>
                </span>
              </div>
              <div className="space-y-4">
                {ETAPAS.map((e) => {
                  const lista = itens.filter((i) => i.process_id === aberto.id && i.stage === e.id);
                  return (
                    <div key={e.id}>
                      <p
                        className={
                          e.id === aberto.stage
                            ? "text-sm font-semibold text-primary"
                            : "text-sm font-semibold"
                        }
                      >
                        {e.nome}
                      </p>
                      {lista.map((i) => (
                        <div
                          key={i.id}
                          id={`tarefa-${i.id}`}
                          ref={(el) => {
                            if (el && window.location.hash === "#" + el.id)
                              el.scrollIntoView({ block: "center" });
                          }}
                          className="space-y-2 rounded-md border p-3"
                        >
                          <label className="flex items-start gap-2 text-sm">
                            <Checkbox
                              checked={i.is_done}
                              onCheckedChange={() => alternarItem(i)}
                              aria-label={`Concluir: ${i.title}`}
                            />
                            <span className={i.is_done ? "text-muted-foreground line-through" : ""}>
                              {i.title}
                            </span>
                          </label>
                          <div className="grid gap-2 pl-7 sm:grid-cols-2">
                            <div className="space-y-1">
                              <AssigneeSelect
                                label={`Usuário responsável: ${i.title}`}
                                value={i.responsible_user_id}
                                members={members}
                                onChange={async (value) => {
                                  const { data, error } = await db
                                    .from("process_items")
                                    .update({
                                      responsible_user_id: value || null,
                                      updated_by: userId,
                                    })
                                    .eq("tenant_id", selecionado.id)
                                    .eq("id", i.id)
                                    .select("id")
                                    .maybeSingle();
                                  if (error || !data)
                                    return void toast.error(
                                      "Não foi possível vincular o responsável da tarefa.",
                                    );
                                  setItens((current) =>
                                    current.map((row) =>
                                      row.id === i.id
                                        ? { ...row, responsible_user_id: value || null }
                                        : row,
                                    ),
                                  );
                                }}
                              />
                              <Label htmlFor={`responsavel-${i.id}`}>Responsável</Label>
                              <Input
                                id={`responsavel-${i.id}`}
                                maxLength={180}
                                value={i.responsible_name ?? ""}
                                onChange={(event) =>
                                  setItens((current) =>
                                    current.map((item) =>
                                      item.id === i.id
                                        ? { ...item, responsible_name: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                                onBlur={() => void salvarResponsavelPrazoEtapa(i)}
                                disabled={salvandoEtapaId === i.id}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`prazo-${i.id}`}>Prazo da etapa</Label>
                              <Input
                                id={`prazo-${i.id}`}
                                type="date"
                                value={i.due_date ?? ""}
                                onChange={(event) =>
                                  setItens((current) =>
                                    current.map((item) =>
                                      item.id === i.id
                                        ? { ...item, due_date: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                                onBlur={() => void salvarResponsavelPrazoEtapa(i)}
                                disabled={salvandoEtapaId === i.id}
                              />
                            </div>
                          </div>
                          <p className="pl-7 text-xs text-muted-foreground">
                            {salvandoEtapaId === i.id
                              ? "Salvando…"
                              : "Responsável e prazo salvam ao sair do campo."}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <DocumentosVinculados
                aberto={!!aberto}
                tenantId={selecionado.id}
                processId={aberto.id}
              />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setDadosAbertos(true)}>
                  <ClipboardList className="h-4 w-4" /> Itens, preços e orçamento
                </Button>
              </div>
              <DialogFooter className="flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!etapaAnterior(aberto.stage)}
                  onClick={() => moverEtapa(aberto, etapaAnterior(aberto.stage))}
                >
                  <ChevronLeft className="h-4 w-4" /> Devolver
                </Button>
                {proximaEtapa(aberto.stage) ? (
                  <Button onClick={() => moverEtapa(aberto, proximaEtapa(aberto.stage))}>
                    Avançar etapa <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={() => concluir(aberto)} disabled={aberto.status === "concluido"}>
                    Concluir processo
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {aberto && (
        <DadosEstruturados
          aberto={dadosAbertos}
          onFechar={() => setDadosAbertos(false)}
          tenantId={selecionado.id}
          processId={aberto.id}
          processNumber={aberto.number}
          userId={userId}
        />
      )}
    </div>
  );
}

type DocumentoVinculado = {
  id: string;
  title: string;
  status: string;
  document_type: string;
  template_version: number | null;
  created_at: string;
};

const TIPOS_DOCUMENTO_PROCESSO = [
  { value: "dfd", label: "DFD" },
  { value: "etp", label: "ETP" },
  { value: "risk_analysis", label: "Análise de riscos" },
  { value: "risk_matrix", label: "Matriz contratual" },
  { value: "tr", label: "Termo de Referência" },
] as const;

const ROTULOS_TIPO_DOCUMENTO: Record<string, string> = {
  dfd: "DFD",
  etp: "ETP",
  risk_analysis: "Análise de riscos",
  risk_matrix: "Matriz contratual de riscos",
  tr: "Termo de Referência",
  custom: "Documento personalizado",
};

function DocumentosVinculados(props: { aberto: boolean; tenantId: string; processId: string }) {
  const [documentos, setDocumentos] = useState<DocumentoVinculado[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!props.aberto) {
      setDocumentos([]);
      return;
    }

    setLoading(true);
    setErro(null);
    const { data, error } = await db
      .from("generated_documents")
      .select("id,title,status,document_type,template_version,created_at")
      .eq("tenant_id", props.tenantId)
      .eq("process_id", props.processId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);

    if (error) {
      setDocumentos([]);
      setErro("Não foi possível carregar os documentos vinculados a este processo.");
    } else {
      setDocumentos((data ?? []) as DocumentoVinculado[]);
    }
    setLoading(false);
  }, [props.aberto, props.tenantId, props.processId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const statusLabel: Record<string, string> = {
    draft: "Rascunho",
    signed: "Assinado",
    cancelled: "Cancelado",
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
            Documentos vinculados
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            DFD, ETP, Termo de Referência, pareceres e demais documentos deste processo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/documentos">
              Abrir GED <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Gerar documento deste processo
          </p>
          <div className="flex flex-wrap gap-2">
            {TIPOS_DOCUMENTO_PROCESSO.map((tipo) => (
              <Button key={tipo.value} asChild size="sm" variant="outline" className="min-h-9">
                <a
                  href={`/documentos?processo=${encodeURIComponent(props.processId)}&tipo=${tipo.value}`}
                  aria-label={`Gerar ${tipo.label} para este processo`}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {tipo.label}
                </a>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A geração exige que o modelo correspondente esteja instalado na Biblioteca-base desta
            Secretaria e que seu perfil tenha permissão para criar documentos.
          </p>
        </div>
        <div className="border-t pt-3">
          {loading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Carregando documentos…
            </div>
          ) : erro ? (
            <p role="status" className="text-sm text-destructive">
              {erro}
            </p>
          ) : documentos.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Nenhum documento foi gerado ou vinculado a este processo. Use o GED para escolher um
              modelo e gerar o primeiro documento.
            </p>
          ) : (
            documentos.map((documento) => (
              <div
                key={documento.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{documento.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ROTULOS_TIPO_DOCUMENTO[documento.document_type] ?? documento.document_type}
                    {documento.template_version ? ` · Modelo v${documento.template_version}` : ""}
                    {" · "}
                    {new Date(documento.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <Badge
                  variant={documento.status === "signed" ? "default" : "secondary"}
                  className="shrink-0"
                >
                  {statusLabel[documento.status] ?? documento.status}
                </Badge>
              </div>
            ))
          )}
          {documentos.length === 20 && (
            <p className="text-xs text-muted-foreground">
              Exibindo os 20 documentos mais recentes. Consulte o GED para acessar o histórico
              completo.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

type ItemCompra = {
  id: string;
  process_id: string;
  line_number: number;
  description: string;
  technical_specification: string | null;
  unit: string;
  quantity: number;
  estimated_unit_price: number | null;
  estimated_total: number | null;
  delivery_location: string | null;
  estimated_price_source: string;
  is_active: boolean;
};

type CotacaoCompra = {
  id: string;
  procurement_item_id: string;
  supplier_id: string | null;
  source_name: string;
  source_type: string;
  supplier_selection_justification: string | null;
  reference_identifier: string | null;
  reference_url: string | null;
  quoted_at: string;
  accessed_at: string | null;
  supplier_response_deadline: string | null;
  quantity: number;
  unit_price: number;
  delivery_cost: number;
  total_price: number | null;
  notes: string | null;
  selected_for_estimate: boolean;
  is_active: boolean;
  justificativa_expurgo: string | null;
  source_tax_id: string | null;
  source_contact_name: string | null;
  source_contact_email: string | null;
  source_contact_phone: string | null;
  source_address: string | null;
  brand_model: string | null;
  delivery_term: string | null;
  payment_terms: string | null;
  warranty_terms: string | null;
  evidence_storage_path: string | null;
  evidence_file_name: string | null;
  evidence_mime_type: string | null;
  evidence_file_size: number | null;
};

type AprovacaoPrecoCompra = {
  id: string;
  procurement_item_id: string;
  method: string;
  method_justification: string;
  exceptional_justification: string | null;
  approved_unit_price: number;
  approved_total_price: number;
  sample_count: number;
  status: string;
  approved_by: string;
  approved_at: string;
};

type ConformidadeCompra = {
  process_id: string;
  funding_source_type: string;
  funding_source_description: string | null;
  transfer_agreement_number: string | null;
  normative_basis: string;
  in65_applicability: string;
  local_regulation_name: string | null;
  local_regulation_reference: string | null;
  legal_review_status: string;
  legal_review_notes: string | null;
  validated_by: string | null;
  validated_at: string | null;
};

type FornecedorCompra = {
  id: string;
  legal_name: string;
  cnpj: string | null;
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

type DotacaoCompra = {
  id: string;
  fiscal_year: number;
  budget_unit: string;
  functional_program: string | null;
  budget_action: string | null;
  expense_nature: string | null;
  funding_source: string | null;
  allocated_amount: number;
  notes: string | null;
  is_active: boolean;
};

function DadosEstruturados(props: {
  aberto: boolean;
  onFechar: () => void;
  tenantId: string;
  processId: string;
  processNumber: string;
  userId: string;
}) {
  const [items, setItems] = useState<ItemCompra[]>([]);
  const [quotes, setQuotes] = useState<CotacaoCompra[]>([]);
  const [approvals, setApprovals] = useState<AprovacaoPrecoCompra[]>([]);
  const [compliance, setCompliance] = useState<ConformidadeCompra | null>(null);
  const [canApprovePrice, setCanApprovePrice] = useState(false);
  const [budgets, setBudgets] = useState<DotacaoCompra[]>([]);
  const [suppliers, setSuppliers] = useState<FornecedorCompra[]>([]);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [approvalForms, setApprovalForms] = useState<
    Record<
      string,
      {
        method: "media" | "mediana" | "menor" | "outro";
        methodJustification: string;
        exceptionalJustification: string;
        otherUnitPrice: string;
      }
    >
  >({});
  const [complianceForm, setComplianceForm] = useState({
    funding_source_type: "unknown",
    funding_source_description: "",
    transfer_agreement_number: "",
    normative_basis: "pending",
    in65_applicability: "pending",
    local_regulation_name: "",
    local_regulation_reference: "",
    legal_review_notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [quoteTarget, setQuoteTarget] = useState<string | null>(null);
  const [budgetFormOpen, setBudgetFormOpen] = useState(false);
  const [mapaAberto, setMapaAberto] = useState(false);

  const emptyItem = {
    description: "",
    technical_specification: "",
    unit: "unidade",
    quantity: "1",
    estimated_unit_price: "",
    delivery_location: "",
  };
  const [itemForm, setItemForm] = useState(emptyItem);
  const [quoteForm, setQuoteForm] = useState({
    supplier_id: "sem_fornecedor",
    source_name: "",
    reference_url: "",
    quoted_at: new Date().toISOString().slice(0, 10),
    quantity: "1",
    unit_price: "",
    delivery_cost: "0",
    notes: "",
    source_type: "painel_precos",
    supplier_selection_justification: "",
    reference_identifier: "",
    accessed_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16),
    source_tax_id: "",
    source_contact_name: "",
    source_contact_email: "",
    source_contact_phone: "",
    source_address: "",
    brand_model: "",
    delivery_term: "",
    payment_terms: "",
    warranty_terms: "",
    supplier_response_deadline: "",
  });
  const [budgetForm, setBudgetForm] = useState({
    fiscal_year: String(new Date().getFullYear()),
    budget_unit: "",
    functional_program: "",
    budget_action: "",
    expense_nature: "",
    funding_source: "",
    allocated_amount: "",
    notes: "",
  });

  const carregarDados = useCallback(async () => {
    if (!props.aberto) return;
    setLoading(true);

    try {
      const [
        itemRows,
        budgetRows,
        supplierRows,
        approvalRows,
        processComplianceResult,
        tenantComplianceResult,
        capabilityResult,
      ] = await Promise.all([
        carregarTodasAsPaginas<ItemCompra>((inicio, fim) =>
          db
            .from("procurement_items")
            .select("*")
            .eq("tenant_id", props.tenantId)
            .eq("process_id", props.processId)
            .eq("is_active", true)
            .order("line_number")
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<DotacaoCompra>((inicio, fim) =>
          db
            .from("procurement_budget_allocations")
            .select("*")
            .eq("tenant_id", props.tenantId)
            .eq("process_id", props.processId)
            .eq("is_active", true)
            .order("fiscal_year", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<FornecedorCompra>((inicio, fim) =>
          db
            .from("suppliers")
            .select(
              "id,legal_name,cnpj,contact_name,contact_email,contact_phone,street,street_number,complement,neighborhood,city,state,postal_code",
            )
            .eq("tenant_id", props.tenantId)
            .order("legal_name")
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<AprovacaoPrecoCompra>((inicio, fim) =>
          db
            .from("procurement_price_approvals")
            .select("*")
            .eq("tenant_id", props.tenantId)
            .eq("process_id", props.processId)
            .order("approved_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
        db
          .from("procurement_process_compliance")
          .select("*")
          .eq("tenant_id", props.tenantId)
          .eq("process_id", props.processId)
          .maybeSingle(),
        db
          .from("tenant_procurement_compliance")
          .select("*")
          .eq("tenant_id", props.tenantId)
          .maybeSingle(),
        db.rpc("get_procurement_price_capabilities", { p_tenant_id: props.tenantId }),
      ]);
      if (processComplianceResult.error) throw processComplianceResult.error;
      if (tenantComplianceResult.error) throw tenantComplianceResult.error;
      if (capabilityResult.error) throw capabilityResult.error;
      setApprovals(approvalRows);
      setCompliance(processComplianceResult.data);
      setCanApprovePrice(Boolean(capabilityResult.data?.[0]?.can_approve_price));
      const processCompliance = processComplianceResult.data;
      const tenantCompliance = tenantComplianceResult.data;
      setComplianceForm({
        funding_source_type: processCompliance?.funding_source_type ?? "unknown",
        funding_source_description: processCompliance?.funding_source_description ?? "",
        transfer_agreement_number: processCompliance?.transfer_agreement_number ?? "",
        normative_basis:
          processCompliance?.normative_basis ?? tenantCompliance?.normative_basis ?? "pending",
        in65_applicability:
          processCompliance?.in65_applicability ??
          tenantCompliance?.in65_applicability ??
          "pending",
        local_regulation_name:
          processCompliance?.local_regulation_name ?? tenantCompliance?.local_regulation_name ?? "",
        local_regulation_reference:
          processCompliance?.local_regulation_reference ??
          tenantCompliance?.local_regulation_reference ??
          "",
        legal_review_notes: processCompliance?.legal_review_notes ?? "",
      });

      const itemIds = itemRows.map((item) => item.id);
      const quoteRows: CotacaoCompra[] = [];
      // Keep PostgREST URL filters bounded even when a process contains many items.
      for (let inicio = 0; inicio < itemIds.length; inicio += 100) {
        const itemIdsPagina = itemIds.slice(inicio, inicio + 100);
        const quotesPage = await carregarTodasAsPaginas<CotacaoCompra>((from, to) =>
          db
            .from("procurement_price_quotes")
            .select("*")
            .eq("tenant_id", props.tenantId)
            .in("procurement_item_id", itemIdsPagina)
            .order("quoted_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        );
        quoteRows.push(...quotesPage);
      }

      setItems(itemRows);
      setQuotes(quoteRows);
      setBudgets(budgetRows);
      setSuppliers(supplierRows);
    } catch (error) {
      setItems([]);
      setQuotes([]);
      setBudgets([]);
      setSuppliers([]);
      setApprovals([]);
      setCompliance(null);
      setCanApprovePrice(false);
      toast.error(
        error instanceof Error ? error.message : "Falha ao carregar os dados da contratação.",
      );
    } finally {
      setLoading(false);
    }
  }, [props.aberto, props.tenantId, props.processId]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  async function salvarItem(event: React.FormEvent) {
    event.preventDefault();
    const quantity = numeroDecimal(itemForm.quantity);
    const unitPrice = itemForm.estimated_unit_price.trim()
      ? numeroDecimal(itemForm.estimated_unit_price)
      : null;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Informe uma quantidade maior que zero.");
      return;
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      toast.error("O preço unitário estimado é inválido.");
      return;
    }
    setSaving(true);
    const { error } = await db.from("procurement_items").insert({
      tenant_id: props.tenantId,
      process_id: props.processId,
      line_number: Math.max(0, ...items.map((item) => item.line_number)) + 1,
      description: itemForm.description.trim(),
      technical_specification: itemForm.technical_specification.trim() || null,
      unit: itemForm.unit.trim(),
      quantity,
      estimated_unit_price: unitPrice,
      delivery_location: itemForm.delivery_location.trim() || null,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItemForm(emptyItem);
    setItemFormOpen(false);
    toast.success("Item de contratação cadastrado.");
    await carregarDados();
  }

  async function salvarCotacao(event: React.FormEvent) {
    event.preventDefault();
    if (!quoteTarget) return;
    const quoteQuantity = numeroDecimal(quoteForm.quantity);
    const unitPrice = numeroDecimal(quoteForm.unit_price);
    const deliveryCost = numeroDecimal(quoteForm.delivery_cost || "0");
    if (
      !Number.isFinite(quoteQuantity) ||
      quoteQuantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      !Number.isFinite(deliveryCost) ||
      deliveryCost < 0
    ) {
      toast.error("Informe quantidade, preço e frete válidos.");
      return;
    }
    if (quoteForm.reference_url && !/^https:\/\//i.test(quoteForm.reference_url.trim())) {
      toast.error("A referência da cotação deve usar HTTPS.");
      return;
    }
    const item = items.find((entry) => entry.id === quoteTarget);
    const supplier = suppliers.find((entry) => entry.id === quoteForm.supplier_id);
    const allowedEvidenceTypes = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/jpeg",
      "image/png",
    ]);
    if (
      evidenceFile &&
      (!allowedEvidenceTypes.has(evidenceFile.type) || evidenceFile.size > 20 * 1024 * 1024)
    ) {
      toast.error("O comprovante deve ser PDF, DOC, DOCX, XLS, XLSX, JPG ou PNG de até 20 MB.");
      return;
    }
    setSaving(true);
    const { data: savedQuote, error } = await db
      .from("procurement_price_quotes")
      .insert({
        tenant_id: props.tenantId,
        procurement_item_id: quoteTarget,
        supplier_id: quoteForm.supplier_id === "sem_fornecedor" ? null : quoteForm.supplier_id,
        source_name: quoteForm.source_name.trim() || supplier?.legal_name || "",
        source_type: quoteForm.source_type,
        supplier_selection_justification:
          quoteForm.source_type === "fornecedor"
            ? quoteForm.supplier_selection_justification.trim()
            : null,
        reference_identifier: quoteForm.reference_identifier.trim() || null,
        reference_url: quoteForm.reference_url.trim() || null,
        quoted_at: quoteForm.quoted_at,
        accessed_at: quoteForm.accessed_at ? new Date(quoteForm.accessed_at).toISOString() : null,
        supplier_response_deadline: quoteForm.supplier_response_deadline || null,
        source_tax_id: quoteForm.source_tax_id.trim() || supplier?.cnpj || null,
        source_contact_name: quoteForm.source_contact_name.trim() || supplier?.contact_name || null,
        source_contact_email:
          quoteForm.source_contact_email.trim() || supplier?.contact_email || null,
        source_contact_phone:
          quoteForm.source_contact_phone.trim() || supplier?.contact_phone || null,
        source_address:
          quoteForm.source_address.trim() ||
          [
            supplier?.street,
            supplier?.street_number,
            supplier?.complement,
            supplier?.neighborhood,
            supplier?.city,
            supplier?.state,
            supplier?.postal_code,
          ]
            .filter(Boolean)
            .join(", ") ||
          null,
        brand_model: quoteForm.brand_model.trim() || null,
        delivery_term: quoteForm.delivery_term.trim() || null,
        payment_terms: quoteForm.payment_terms.trim() || null,
        warranty_terms: quoteForm.warranty_terms.trim() || null,
        quantity: quoteQuantity,
        unit_price: unitPrice,
        delivery_cost: deliveryCost,
        notes: quoteForm.notes.trim() || null,
        created_by: props.userId,
        updated_by: props.userId,
      })
      .select("id")
      .single();
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }
    let evidenceWarning: string | null = null;
    if (evidenceFile) {
      const extensions: Record<string, string> = {
        "application/pdf": "pdf",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.ms-excel": "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "image/jpeg": "jpg",
        "image/png": "png",
      };
      const evidenceId = crypto.randomUUID();
      const storagePath = `${props.tenantId}/procurement-quotes/${quoteTarget}/${savedQuote.id}/${evidenceId}.${extensions[evidenceFile.type]}`;
      const { error: uploadError } = await db.storage
        .from("gfs-private-documents")
        .upload(storagePath, evidenceFile, { contentType: evidenceFile.type, upsert: false });
      if (uploadError) {
        evidenceWarning = uploadError.message;
      } else {
        const { error: linkError } = await db
          .from("procurement_price_quotes")
          .update({
            evidence_storage_path: storagePath,
            evidence_file_name: evidenceFile.name,
            evidence_mime_type: evidenceFile.type,
            evidence_file_size: evidenceFile.size,
            updated_by: props.userId,
          })
          .eq("tenant_id", props.tenantId)
          .eq("id", savedQuote.id);
        if (linkError) {
          await db.storage.from("gfs-private-documents").remove([storagePath]);
          evidenceWarning = linkError.message;
        }
      }
    }
    setSaving(false);
    setQuoteTarget(null);
    setEvidenceFile(null);
    setQuoteForm({
      supplier_id: "sem_fornecedor",
      source_name: "",
      reference_url: "",
      quoted_at: new Date().toISOString().slice(0, 10),
      quantity: String(item?.quantity ?? 1),
      unit_price: "",
      delivery_cost: "0",
      notes: "",
      source_type: "painel_precos",
      reference_identifier: "",
      accessed_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
      supplier_response_deadline: "",
      source_tax_id: "",
      source_contact_name: "",
      source_contact_email: "",
      source_contact_phone: "",
      source_address: "",
      brand_model: "",
      delivery_term: "",
      payment_terms: "",
      warranty_terms: "",
    });
    toast.success("Cotação registrada com rastreabilidade da fonte.");
    if (evidenceWarning)
      toast.warning(`Cotação salva, mas o comprovante não foi vinculado: ${evidenceWarning}`);
    await carregarDados();
  }

  async function exportarMapa(formato: "docx" | "pdf" | "workflow") {
    setSaving(true);
    try {
      const { buildDocxFromText, generateDocx, docxToModel, renderPdf } =
        await import("@/lib/docx-engine");
      const { carregarTimbradoSecretaria } = await import("@/lib/document-branding");
      const { data: tenant, error } = await db
        .from("tenants")
        .select("name")
        .eq("id", props.tenantId)
        .single();
      if (error) throw error;
      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("full_name")
        .eq("id", props.userId)
        .single();
      if (profileError) throw profileError;
      const branding = await carregarTimbradoSecretaria(props.tenantId, tenant.name);
      const clean = (value: unknown) => String(value ?? "Não informado").replace(/[\t\r\n]/g, " ");
      const activeItems = items.filter((item) => item.is_active);
      const currentApprovals = approvals.filter((approval) => approval.status === "approved");
      const allItemsApproved =
        activeItems.length > 0 &&
        activeItems.every(
          (item) =>
            item.estimated_price_source === "approved" &&
            currentApprovals.some((approval) => approval.procurement_item_id === item.id),
        );
      const normativeValidated = compliance?.legal_review_status === "validated";
      const mapaPronto = allItemsApproved && normativeValidated;
      const fundingSourceLabels: Record<string, string> = {
        own_resources: "Recursos próprios do ente",
        federal_transfer: "Transferência da União",
        state_transfer: "Transferência estadual",
        other_transfer: "Outra transferência voluntária",
        mixed: "Recursos de origens mistas",
      };
      const fundingSourceLabel =
        fundingSourceLabels[compliance?.funding_source_type ?? ""] ??
        "Origem dos recursos não informada";
      const basisLabel =
        compliance?.normative_basis === "in65_2021"
          ? "IN SEGES/ME nº 65/2021"
          : compliance?.normative_basis === "local_regulation"
            ? `Regulamentação local: ${compliance.local_regulation_name ?? "não informada"} — ${compliance.local_regulation_reference ?? "referência pendente"}`
            : compliance?.normative_basis === "other"
              ? "Outro enquadramento normativo"
              : "Enquadramento normativo pendente";
      const applicabilityLabel =
        compliance?.in65_applicability === "applicable"
          ? "IN 65 aplicável"
          : compliance?.in65_applicability === "adopted"
            ? "IN 65 adotada pelo órgão"
            : compliance?.in65_applicability === "not_applicable"
              ? "IN 65 declarada não aplicável — ver justificativa"
              : "Aplicabilidade pendente de análise";
      const lines = [
        "MAPA COMPARATIVO DE PREÇOS — PESQUISA E ESTIMATIVA",
        mapaPronto
          ? "Situação: preços dos itens aprovados e enquadramento normativo validado especificamente para este processo."
          : "RASCUNHO — NÃO HOMOLOGADO — PENDENTE DE APROVAÇÃO DOS PREÇOS E/OU VALIDAÇÃO NORMATIVA.",
        `Processo: ${props.processNumber}`,
        `Órgão: ${tenant.name}`,
        `Emitido em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)`,
        `Responsável pela emissão: ${profile.full_name}`,
        `Origem dos recursos: ${fundingSourceLabel}`,
        `Descrição da fonte/programa: ${clean(compliance?.funding_source_description)}`,
        `Convênio/instrumento de transferência: ${clean(compliance?.transfer_agreement_number)}`,
        `Base normativa declarada: ${basisLabel}`,
        `Aplicabilidade da IN 65/2021: ${applicabilityLabel}`,
        `Validação normativa: ${normativeValidated ? "Validada pela autoridade registrada no sistema em " + formatarData(compliance?.validated_at ?? "") : "Pendente de validação da assessoria/autoridade competente"}`,
        compliance?.legal_review_notes
          ? `Observações jurídicas: ${clean(compliance.legal_review_notes)}`
          : "",
        "Critério de análise: as cotações ativas compõem a série de preços; os alertas estatísticos são subsídios de análise e não excluem automaticamente valores.",
        "Fórmula de preço efetivo: (preço unitário × quantidade cotada + frete) ÷ quantidade cotada. Total aprovado: preço unitário aprovado × quantidade prevista do item.",
      ].filter(Boolean);
      for (const item of activeItems) {
        const rows = quotes
          .filter((quote) => quote.procurement_item_id === item.id && quote.is_active)
          .sort(
            (a, b) =>
              (precoUnitarioComFrete(a) ?? Infinity) - (precoUnitarioComFrete(b) ?? Infinity),
          );
        const archived = quotes.filter(
          (quote) => quote.procurement_item_id === item.id && !quote.is_active,
        );
        const summary = calcularResumoDePrecos(rows);
        const approval = currentApprovals.find((entry) => entry.procurement_item_id === item.id);
        const signals = expurgarAmostrasInconsistentes(rows);
        const dispersion = analisarDispersaoPrecos(
          rows.map(precoUnitarioComFrete).filter((value): value is number => value !== null),
        );
        lines.push(
          "",
          `ITEM ${item.line_number} — ${clean(item.description)}`,
          `Especificação: ${clean(item.technical_specification)}`,
          `Unidade: ${item.unit} · Quantidade prevista: ${item.quantity} · Local de entrega: ${clean(item.delivery_location)}`,
          `Preço unitário atualmente registrado: ${formatarMoeda(item.estimated_unit_price)} · Total do item: ${formatarMoeda(item.estimated_total)}`,
          `Situação do preço: ${approval ? "APROVADO" : "PENDENTE DE APROVAÇÃO"}`,
          `Cotações ativas consideradas: ${summary.quantidade}`,
        );
        if (approval) {
          lines.push(
            `Método aprovado: ${approval.method}`,
            `Justificativa do método: ${clean(approval.method_justification)}`,
            `Preço unitário aprovado: ${formatarMoeda(approval.approved_unit_price)}`,
            `Preço total aprovado: ${formatarMoeda(approval.approved_total_price)}`,
            `Aprovado em: ${formatarData(approval.approved_at)} · Responsável autenticado: ${approval.approved_by}`,
            `Amostras consideradas na aprovação: ${approval.sample_count}`,
            ...(approval.exceptional_justification
              ? [
                  `Justificativa excepcional para menos de três preços: ${clean(approval.exceptional_justification)}`,
                ]
              : []),
          );
        } else {
          lines.push(
            "Método e valor homologado: pendentes. A mediana abaixo é apenas referência estatística, não preço aprovado.",
          );
        }
        lines.push(
          "COMPARATIVO DOS PREÇOS EFETIVOS",
          [
            "Fonte",
            "Data",
            "Quantidade",
            "Preço unitário",
            "Frete total",
            "Preço total",
            "Unitário com frete",
          ].join("\t"),
        );
        for (const quote of rows) {
          lines.push(
            [
              quote.source_name,
              formatarData(quote.quoted_at),
              quote.quantity,
              formatarMoeda(quote.unit_price),
              formatarMoeda(quote.delivery_cost),
              formatarMoeda(quote.total_price),
              formatarMoeda(precoUnitarioComFrete(quote)),
            ]
              .map(clean)
              .join("\t"),
          );
        }

        lines.push(
          "IDENTIFICAÇÃO E RASTREABILIDADE DAS FONTES",
          [
            "Fonte",
            "Tipo",
            "Identificador",
            "CPF/CNPJ",
            "Acesso à fonte",
            "Validade",
            "Referência eletrônica",
          ].join("\t"),
        );
        for (const quote of rows) {
          const supplier = suppliers.find((entry) => entry.id === quote.supplier_id);
          lines.push(
            [
              quote.source_name,
              quote.source_type,
              quote.reference_identifier,
              quote.source_tax_id ?? supplier?.cnpj,
              quote.accessed_at ? new Date(quote.accessed_at).toLocaleString("pt-BR") : "",
              quote.supplier_response_deadline
                ? formatarData(quote.supplier_response_deadline)
                : "",
              quote.reference_url,
            ]
              .map(clean)
              .join("\t"),
          );
        }

        lines.push(
          "CONDIÇÕES COMERCIAIS E COMPROVANTES",
          [
            "Fonte",
            "Marca/modelo",
            "Entrega",
            "Pagamento",
            "Garantia",
            "Comprovante",
            "Observações",
          ].join("\t"),
        );
        for (const quote of rows) {
          lines.push(
            [
              quote.source_name,
              quote.brand_model,
              quote.delivery_term,
              quote.payment_terms,
              quote.warranty_terms,
              [
                quote.evidence_file_name,
                quote.evidence_mime_type,
                quote.evidence_file_size ? `${quote.evidence_file_size} bytes` : "",
              ]
                .filter(Boolean)
                .join(" / "),
              quote.notes,
            ]
              .map(clean)
              .join("\t"),
          );
        }

        lines.push(
          "CONTATOS DAS FONTES",
          ["Fonte", "Responsável", "E-mail", "Telefone", "Endereço"].join("\t"),
        );
        for (const quote of rows) {
          const supplier = suppliers.find((entry) => entry.id === quote.supplier_id);
          lines.push(
            [
              quote.source_name,
              quote.source_contact_name ?? supplier?.contact_name,
              quote.source_contact_email ?? supplier?.contact_email,
              quote.source_contact_phone ?? supplier?.contact_phone,
              quote.source_address ??
                [
                  supplier?.street,
                  supplier?.street_number,
                  supplier?.complement,
                  supplier?.neighborhood,
                  supplier?.city,
                  supplier?.state,
                  supplier?.postal_code,
                ]
                  .filter(Boolean)
                  .join(", "),
            ]
              .map(clean)
              .join("\t"),
          );
        }

        for (const quote of rows) {
          const signal = signals.find((entry) => entry.cotacao.id === quote.id);
          if (signal?.motivos.length) {
            lines.push(
              `Alerta estatístico para análise humana — ${clean(quote.source_name)}: ${signal.motivos.join("; ")}`,
            );
          }
        }
        lines.push("COTAÇÕES EXPURGADAS — PRESERVADAS PARA RASTREABILIDADE");
        if (archived.length === 0) {
          lines.push("Nenhuma cotação expurgada deste item.");
        } else {
          for (const quote of archived) {
            lines.push(
              `Fonte: ${quote.source_name} · Tipo: ${quote.source_type} · Data: ${formatarData(quote.quoted_at)} · Unitário efetivo: ${formatarMoeda(precoUnitarioComFrete(quote))} · Motivo do expurgo: ${clean(quote.justificativa_expurgo)} · Comprovante: ${clean(quote.evidence_file_name)}`,
            );
          }
        }
        lines.push(
          `Menor preço ativo: ${formatarMoeda(summary.menor)} · Média: ${formatarMoeda(summary.media)} · Mediana: ${formatarMoeda(summary.mediana)} · CV amostral: ${summary.coeficienteVariacao?.toFixed(2) ?? "não calculável"}%.`,
          dispersion.dispersaoExcessiva
            ? "ALERTA: coeficiente de variação superior a 25%; revisar fontes, comparabilidade e justificativas."
            : "Dispersão: sem alerta de CV superior a 25% nesta amostra.",
        );
      }
      if (formato === "workflow") {
        const { data, error } = await db
          .from("generated_documents")
          .insert({
            tenant_id: props.tenantId,
            process_id: props.processId,
            title: `Mapa comparativo — ${props.processNumber}`,
            content_snapshot: lines.join("\n"),
            process_snapshot: { document_kind: "price_map" },
            status: "draft",
          })
          .select("id")
          .single();
        if (error) throw error;
        if (!mapaPronto) {
          toast.warning(
            "Rascunho criado. A tramitação será liberada após aprovar todos os preços e validar o enquadramento normativo.",
          );
        } else {
          toast.success(
            "Mapa completo gerado como rascunho para conferência e aprovação independente.",
          );
        }
        window.location.assign("/documentos?documento=" + encodeURIComponent(data.id));
        return;
      }
      const generated = await generateDocx({
        template: await buildDocxFromText(
          lines.join("\n"),
          mapaPronto ? "MAPA COMPARATIVO DE PREÇOS" : "RASCUNHO — MAPA COMPARATIVO DE PREÇOS",
        ),
        values: {},
        items: [],
        branding,
      });
      const bytes =
        formato === "docx"
          ? generated.bytes
          : await renderPdf(
              { ...(await docxToModel(generated.bytes)), footerText: [] },
              { branding, title: mapaPronto ? "Mapa comparativo" : "Rascunho — mapa comparativo" },
            );
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], {
          type:
            formato === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `mapa-${props.processNumber.replace(/[^a-z0-9_-]/gi, "-")}.${formato}`;
      a.click();
      URL.revokeObjectURL(url);
      if (!mapaPronto) {
        toast.warning(
          "Arquivo exportado como RASCUNHO. A aprovação do preço e a validação normativa continuam pendentes.",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o mapa.");
    } finally {
      setSaving(false);
    }
  }
  async function abrirComprovanteCotacao(quote: CotacaoCompra) {
    if (!quote.evidence_storage_path) return;
    const { data, error } = await db.storage
      .from("gfs-private-documents")
      .createSignedUrl(quote.evidence_storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Comprovante indisponível para consulta.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function selecionarCotacao(quote: CotacaoCompra) {
    const { error } = await db.rpc("select_procurement_price_quote", {
      p_tenant_id: props.tenantId,
      p_item_id: quote.procurement_item_id,
      p_quote_id: quote.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cotação selecionada como referência e preço estimado atualizado.");
    await carregarDados();
  }

  async function aprovarPreco(item: ItemCompra) {
    if (!canApprovePrice) {
      toast.error("Seu perfil não possui autorização para aprovar o preço estimado.");
      return;
    }
    const form = approvalForms[item.id] ?? {
      method: "mediana" as const,
      methodJustification: "",
      exceptionalJustification: "",
      otherUnitPrice: "",
    };
    const activeQuotes = quotes.filter(
      (quote) => quote.procurement_item_id === item.id && quote.is_active,
    );
    let otherPrice: number | undefined;
    if (form.method === "outro") {
      otherPrice = numeroDecimal(form.otherUnitPrice);
      if (!Number.isFinite(otherPrice) || otherPrice < 0) {
        toast.error("Informe o preço unitário do método alternativo.");
        return;
      }
    }
    try {
      const preview = calcularPrecoHomologado(form.method, activeQuotes, item.quantity, otherPrice);
      if (preview.quantidadeAmostras < 3 && form.exceptionalJustification.trim().length < 10) {
        toast.error(
          "Com menos de três preços válidos, registre a justificativa excepcional (mínimo de 10 caracteres).",
        );
        return;
      }
      const minimumMethodJustification = form.method === "outro" ? 20 : 10;
      if (form.methodJustification.trim().length < minimumMethodJustification) {
        toast.error(
          `Justifique a escolha do método (mínimo de ${minimumMethodJustification} caracteres).`,
        );
        return;
      }
      setSaving(true);
      const { error } = await db.rpc("approve_procurement_item_price", {
        p_tenant_id: props.tenantId,
        p_item_id: item.id,
        p_method: form.method,
        p_method_justification: form.methodJustification.trim(),
        ...(form.exceptionalJustification.trim()
          ? { p_exceptional_justification: form.exceptionalJustification.trim() }
          : {}),
        ...(otherPrice !== undefined ? { p_other_unit_price: otherPrice } : {}),
      });
      setSaving(false);
      if (error) throw error;
      toast.success(
        `Preço aprovado: ${formatarMoeda(preview.precoUnitarioAprovado)} por unidade; total ${formatarMoeda(preview.precoTotalAprovado)}.`,
      );
      await carregarDados();
    } catch (error) {
      setSaving(false);
      toast.error(error instanceof Error ? error.message : "Não foi possível aprovar o preço.");
    }
  }

  async function salvarConformidadeNormativa() {
    if (!canApprovePrice) {
      toast.error("Seu perfil não pode validar o enquadramento normativo.");
      return;
    }
    const legalNotes = complianceForm.legal_review_notes.trim();
    const transferFunding = [
      "federal_transfer",
      "state_transfer",
      "other_transfer",
      "mixed",
    ].includes(complianceForm.funding_source_type);
    if (complianceForm.funding_source_type === "unknown") {
      toast.error("Identifique a origem dos recursos deste processo antes de validar.");
      return;
    }
    if (
      transferFunding &&
      !complianceForm.funding_source_description.trim() &&
      !complianceForm.transfer_agreement_number.trim()
    ) {
      toast.error("Informe o programa, a fonte ou o instrumento de transferência dos recursos.");
      return;
    }
    if (
      complianceForm.normative_basis === "local_regulation" &&
      (!complianceForm.local_regulation_name.trim() ||
        !complianceForm.local_regulation_reference.trim())
    ) {
      toast.error("Informe o nome e a referência oficial do regulamento local.");
      return;
    }
    if (
      complianceForm.in65_applicability === "adopted" &&
      complianceForm.normative_basis !== "local_regulation"
    ) {
      toast.error(
        "A adoção local da IN 65 exige a identificação do regulamento municipal ou estadual.",
      );
      return;
    }
    if (
      complianceForm.in65_applicability === "not_applicable" &&
      (complianceForm.normative_basis === "in65_2021" || legalNotes.length < 20)
    ) {
      toast.error(
        "Para declarar a IN 65 não aplicável, selecione outro fundamento e registre justificativa jurídica (mínimo de 20 caracteres).",
      );
      return;
    }
    if (complianceForm.normative_basis === "other" && legalNotes.length < 10) {
      toast.error("Descreva o fundamento normativo alternativo (mínimo de 10 caracteres).");
      return;
    }
    setSaving(true);
    const { error } = await db.from("procurement_process_compliance").upsert(
      {
        tenant_id: props.tenantId,
        process_id: props.processId,
        funding_source_type: complianceForm.funding_source_type,
        funding_source_description: complianceForm.funding_source_description.trim() || null,
        transfer_agreement_number: complianceForm.transfer_agreement_number.trim() || null,
        normative_basis: complianceForm.normative_basis,
        in65_applicability: complianceForm.in65_applicability,
        local_regulation_name: complianceForm.local_regulation_name.trim() || null,
        local_regulation_reference: complianceForm.local_regulation_reference.trim() || null,
        legal_review_status: "validated",
        legal_review_notes: complianceForm.legal_review_notes.trim() || null,
        updated_by: props.userId,
      },
      { onConflict: "tenant_id,process_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Enquadramento normativo registrado para este processo.");
    await carregarDados();
  }

  async function arquivarCotacao(quote: CotacaoCompra) {
    const justificativa = window.prompt("Justificativa para excluir esta cotação da pesquisa:");
    if (!justificativa?.trim()) return;
    setSaving(true);
    const { error } = await db
      .from("procurement_price_quotes")
      .update({
        is_active: false,
        selected_for_estimate: false,
        justificativa_expurgo: justificativa.trim(),
        updated_by: props.userId,
      })
      .eq("id", quote.id)
      .eq("tenant_id", props.tenantId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Cotação arquivada.");
      await carregarDados();
    }
  }

  async function arquivarItem(item: ItemCompra) {
    if (quotes.some((quote) => quote.procurement_item_id === item.id && quote.is_active)) {
      toast.error("Arquive primeiro as cotações deste item para preservar a pesquisa de preços.");
      return;
    }
    setSaving(true);
    const { error } = await db
      .from("procurement_items")
      .update({ is_active: false, updated_by: props.userId })
      .eq("id", item.id)
      .eq("tenant_id", props.tenantId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Item arquivado.");
      await carregarDados();
    }
  }

  async function salvarDotacao(event: React.FormEvent) {
    event.preventDefault();
    const amount = numeroDecimal(budgetForm.allocated_amount);
    const year = Number(budgetForm.fiscal_year);
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2200 ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      toast.error("Informe exercício e valor orçamentário válidos.");
      return;
    }
    setSaving(true);
    const { error } = await db.from("procurement_budget_allocations").insert({
      tenant_id: props.tenantId,
      process_id: props.processId,
      fiscal_year: year,
      budget_unit: budgetForm.budget_unit.trim(),
      functional_program: budgetForm.functional_program.trim() || null,
      budget_action: budgetForm.budget_action.trim() || null,
      expense_nature: budgetForm.expense_nature.trim() || null,
      funding_source: budgetForm.funding_source.trim() || null,
      allocated_amount: amount,
      notes: budgetForm.notes.trim() || null,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBudgetFormOpen(false);
    setBudgetForm({
      fiscal_year: String(new Date().getFullYear()),
      budget_unit: "",
      functional_program: "",
      budget_action: "",
      expense_nature: "",
      funding_source: "",
      allocated_amount: "",
      notes: "",
    });
    toast.success("Dotação orçamentária cadastrada.");
    await carregarDados();
  }

  async function arquivarDotacao(allocation: DotacaoCompra) {
    setSaving(true);
    const { error } = await db
      .from("procurement_budget_allocations")
      .update({ is_active: false, updated_by: props.userId })
      .eq("id", allocation.id)
      .eq("tenant_id", props.tenantId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Alocação orçamentária arquivada.");
      await carregarDados();
    }
  }

  const totalEstimadoItens = items.reduce(
    (total, item) => total + (Number(item.estimated_total) || 0),
    0,
  );
  const totalOrcamentario = budgets.reduce(
    (total, entry) => total + Number(entry.allocated_amount || 0),
    0,
  );

  if (!props.aberto) return null;

  return (
    <Dialog open={props.aberto} onOpenChange={(open) => !open && props.onFechar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Composição da contratação — {props.processNumber}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Itens ativos</p>
              <p className="text-2xl font-semibold">{items.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total estimado dos itens</p>
              <p className="text-2xl font-semibold">{formatarMoeda(totalEstimadoItens)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Dotações ativas</p>
              <p className="text-2xl font-semibold">{formatarMoeda(totalOrcamentario)}</p>
            </CardContent>
          </Card>
        </div>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="items" className="w-full">
            <TabsList>
              <TabsTrigger value="items">
                <ClipboardList className="h-4 w-4" /> Itens e preços
              </TabsTrigger>
              <TabsTrigger value="budget">
                <Coins className="h-4 w-4" /> Orçamento
              </TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="space-y-4">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setMapaAberto(true)}
                  disabled={quotes.length === 0}
                >
                  Mapa comparativo ({quotes.length})
                </Button>
                <Button onClick={() => setItemFormOpen((value) => !value)} variant="outline">
                  <Plus className="h-4 w-4" /> Adicionar item
                </Button>
              </div>
              {itemFormOpen && (
                <Card>
                  <CardContent className="pt-4">
                    <form onSubmit={salvarItem} className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Descrição do item *</Label>
                        <Input
                          required
                          minLength={3}
                          maxLength={500}
                          value={itemForm.description}
                          onChange={(event) =>
                            setItemForm((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Especificação técnica</Label>
                        <Textarea
                          rows={2}
                          value={itemForm.technical_specification}
                          onChange={(event) =>
                            setItemForm((current) => ({
                              ...current,
                              technical_specification: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Unidade *</Label>
                        <Input
                          required
                          maxLength={30}
                          value={itemForm.unit}
                          onChange={(event) =>
                            setItemForm((current) => ({ ...current, unit: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Quantidade *</Label>
                        <Input
                          required
                          inputMode="decimal"
                          value={itemForm.quantity}
                          onChange={(event) =>
                            setItemForm((current) => ({ ...current, quantity: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Preço unitário estimado (R$)</Label>
                        <Input
                          inputMode="decimal"
                          value={itemForm.estimated_unit_price}
                          onChange={(event) =>
                            setItemForm((current) => ({
                              ...current,
                              estimated_unit_price: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Local de entrega</Label>
                        <Input
                          value={itemForm.delivery_location}
                          onChange={(event) =>
                            setItemForm((current) => ({
                              ...current,
                              delivery_location: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="flex justify-end gap-2 sm:col-span-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setItemFormOpen(false)}
                        >
                          Cancelar
                        </Button>
                        <Button type="submit" disabled={saving}>
                          {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}{" "}
                          Salvar item
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              )}
              {items.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                  Nenhum item estruturado foi informado para este processo.
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => {
                    const itemQuotes = quotes.filter(
                      (quote) => quote.procurement_item_id === item.id && quote.is_active,
                    );
                    const archivedQuotes = quotes.filter(
                      (quote) => quote.procurement_item_id === item.id && !quote.is_active,
                    );
                    const itemApproval = approvals.find(
                      (approval) =>
                        approval.procurement_item_id === item.id && approval.status === "approved",
                    );
                    return (
                      <Card key={item.id}>
                        <CardContent className="space-y-3 pt-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {item.line_number}. {item.description}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.estimated_price_source === "approved"
                                  ? "Preço estimado aprovado"
                                  : item.estimated_price_source === "quote_reference"
                                    ? "Preço de referência provisório"
                                    : item.estimated_price_source === "none"
                                      ? "Preço pendente de nova apuração"
                                      : "Preço informado manualmente"}
                                {item.estimated_unit_price !== null
                                  ? ` · ${formatarMoeda(item.estimated_unit_price)} / ${item.unit}`
                                  : ""}
                              </p>
                              {item.technical_specification && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {item.technical_specification}
                                </p>
                              )}
                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.quantity} {item.unit} · Unitário:{" "}
                                {formatarMoeda(item.estimated_unit_price)} · Total:{" "}
                                {formatarMoeda(item.estimated_total)}
                              </p>
                              {item.delivery_location && (
                                <p className="text-xs text-muted-foreground">
                                  Entrega: {item.delivery_location}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setQuoteTarget(item.id);
                                  setQuoteForm((current) => ({
                                    ...current,
                                    quantity: String(item.quantity),
                                  }));
                                }}
                              >
                                <Search className="h-4 w-4" /> Nova cotação
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => void arquivarItem(item)}
                                disabled={saving}
                                aria-label="Arquivar item"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          {quoteTarget === item.id && (
                            <form
                              onSubmit={salvarCotacao}
                              className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"
                            >
                              <div className="space-y-1 sm:col-span-2">
                                <Label>Fonte da cotação / fornecedor *</Label>
                                <Input
                                  required
                                  value={quoteForm.source_name}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      source_name: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Fornecedor cadastrado (opcional)</Label>
                                <Select
                                  value={quoteForm.supplier_id}
                                  onValueChange={(value) => {
                                    const supplier = suppliers.find((entry) => entry.id === value);
                                    setQuoteForm((current) => ({
                                      ...current,
                                      supplier_id: value,
                                      source_type:
                                        value === "sem_fornecedor"
                                          ? current.source_type
                                          : "fornecedor",
                                      source_name: supplier?.legal_name ?? current.source_name,
                                      source_tax_id: supplier?.cnpj ?? current.source_tax_id,
                                      source_contact_name:
                                        supplier?.contact_name ?? current.source_contact_name,
                                      source_contact_email:
                                        supplier?.contact_email ?? current.source_contact_email,
                                      source_contact_phone:
                                        supplier?.contact_phone ?? current.source_contact_phone,
                                      source_address: supplier
                                        ? [
                                            supplier.street,
                                            supplier.street_number,
                                            supplier.complement,
                                            supplier.neighborhood,
                                            supplier.city,
                                            supplier.state,
                                            supplier.postal_code,
                                          ]
                                            .filter(Boolean)
                                            .join(", ")
                                        : current.source_address,
                                    }));
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="sem_fornecedor">
                                      Outra fonte de mercado
                                    </SelectItem>
                                    {suppliers.map((supplier) => (
                                      <SelectItem key={supplier.id} value={supplier.id}>
                                        {supplier.legal_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label>Tipo de fonte *</Label>
                                <Select
                                  value={quoteForm.source_type}
                                  onValueChange={(value) =>
                                    setQuoteForm((current) => ({ ...current, source_type: value }))
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="painel_precos">
                                      Painel oficial de preços
                                    </SelectItem>
                                    <SelectItem value="contratacoes_publicas">
                                      Contratações públicas / PNCP
                                    </SelectItem>
                                    <SelectItem value="midia_especializada">
                                      Mídia especializada
                                    </SelectItem>
                                    <SelectItem value="site_especializado">
                                      Site especializado
                                    </SelectItem>
                                    <SelectItem value="fornecedor">
                                      Cotação direta de fornecedor
                                    </SelectItem>
                                    <SelectItem value="nota_fiscal_eletronica">
                                      Nota fiscal eletrônica
                                    </SelectItem>
                                    <SelectItem value="banco_precos_saude">
                                      Banco de Preços em Saúde
                                    </SelectItem>
                                    <SelectItem value="outro">Outra fonte identificável</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label>Identificador da fonte / PNCP / NF</Label>
                                <Input
                                  value={quoteForm.reference_identifier}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      reference_identifier: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Data e hora de acesso à fonte</Label>
                                <Input
                                  type="datetime-local"
                                  required={[
                                    "painel_precos",
                                    "contratacoes_publicas",
                                    "midia_especializada",
                                    "site_especializado",
                                    "banco_precos_saude",
                                    "nota_fiscal_eletronica",
                                  ].includes(quoteForm.source_type)}
                                  value={quoteForm.accessed_at}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      accessed_at: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              {quoteForm.source_type === "fornecedor" && (
                                <div className="space-y-1 sm:col-span-2">
                                  <Label>Justificativa da escolha deste fornecedor *</Label>
                                  <Textarea
                                    required
                                    minLength={10}
                                    rows={2}
                                    value={quoteForm.supplier_selection_justification}
                                    onChange={(event) =>
                                      setQuoteForm((current) => ({
                                        ...current,
                                        supplier_selection_justification: event.target.value,
                                      }))
                                    }
                                    placeholder="Registre o critério objetivo da escolha do fornecedor consultado, conforme art. 3º, VIII, e art. 5º, IV, da IN 65/2021."
                                  />
                                </div>
                              )}
                              <div className="space-y-1">
                                <Label>Prazo de validade da proposta</Label>
                                <Input
                                  type="date"
                                  value={quoteForm.supplier_response_deadline}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      supplier_response_deadline: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>CPF/CNPJ da fonte (se não vinculada)</Label>
                                <Input
                                  value={quoteForm.source_tax_id}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      source_tax_id: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Responsável / contato</Label>
                                <Input
                                  value={quoteForm.source_contact_name}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      source_contact_name: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>E-mail de contato</Label>
                                <Input
                                  type="email"
                                  value={quoteForm.source_contact_email}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      source_contact_email: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Telefone de contato</Label>
                                <Input
                                  value={quoteForm.source_contact_phone}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      source_contact_phone: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1 sm:col-span-2">
                                <Label>Endereço da fonte / fornecedor</Label>
                                <Input
                                  value={quoteForm.source_address}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      source_address: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Marca / modelo</Label>
                                <Input
                                  value={quoteForm.brand_model}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      brand_model: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Prazo de entrega</Label>
                                <Input
                                  value={quoteForm.delivery_term}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      delivery_term: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Condições de pagamento</Label>
                                <Input
                                  value={quoteForm.payment_terms}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      payment_terms: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Garantia</Label>
                                <Input
                                  value={quoteForm.warranty_terms}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      warranty_terms: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1 sm:col-span-2">
                                <Label>
                                  Comprovante da cotação (PDF, DOCX, XLSX ou imagem · até 20 MB)
                                </Label>
                                <Input
                                  type="file"
                                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                  onChange={(event) =>
                                    setEvidenceFile(event.target.files?.[0] ?? null)
                                  }
                                />
                                {evidenceFile && (
                                  <p className="text-xs text-muted-foreground">
                                    {evidenceFile.name}
                                  </p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <Label>Data da cotação *</Label>
                                <Input
                                  type="date"
                                  required
                                  value={quoteForm.quoted_at}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      quoted_at: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Quantidade cotada *</Label>
                                <Input
                                  required
                                  inputMode="decimal"
                                  value={quoteForm.quantity}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      quantity: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Preço unitário (R$) *</Label>
                                <Input
                                  required
                                  inputMode="decimal"
                                  value={quoteForm.unit_price}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      unit_price: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Frete (R$)</Label>
                                <Input
                                  inputMode="decimal"
                                  value={quoteForm.delivery_cost}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      delivery_cost: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Referência HTTPS</Label>
                                <Input
                                  type="url"
                                  placeholder="https://"
                                  value={quoteForm.reference_url}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      reference_url: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1 sm:col-span-2">
                                <Label>Observações</Label>
                                <Textarea
                                  rows={2}
                                  value={quoteForm.notes}
                                  onChange={(event) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      notes: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="flex justify-end gap-2 sm:col-span-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setQuoteTarget(null)}
                                >
                                  Cancelar
                                </Button>
                                <Button type="submit" disabled={saving}>
                                  Salvar cotação
                                </Button>
                              </div>
                            </form>
                          )}
                          {itemQuotes.length > 0 && (
                            <div className="border-t pt-3">
                              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                                PESQUISA DE PREÇOS ({itemQuotes.length})
                              </p>
                              <div className="space-y-2">
                                {itemQuotes.map((quote) => (
                                  <div
                                    key={quote.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium">
                                        {quote.source_name}{" "}
                                        {quote.selected_for_estimate && (
                                          <Badge variant="secondary">Referência escolhida</Badge>
                                        )}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatarData(quote.quoted_at)} · {quote.quantity} un. ·
                                        Unitário {formatarMoeda(quote.unit_price)} · Total{" "}
                                        {formatarMoeda(quote.total_price ?? 0)}
                                      </p>
                                      {quote.reference_url && (
                                        <a
                                          href={quote.reference_url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-xs text-primary underline"
                                        >
                                          Consultar fonte
                                        </a>
                                      )}
                                    </div>
                                    <div className="flex gap-1">
                                      {!quote.selected_for_estimate && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => void selecionarCotacao(quote)}
                                          disabled={saving}
                                        >
                                          Usar como referência
                                        </Button>
                                      )}
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => void arquivarCotacao(quote)}
                                        disabled={saving}
                                        aria-label="Arquivar cotação"
                                      >
                                        <Archive className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {archivedQuotes.length > 0 && (
                            <div className="rounded-md border border-dashed p-3">
                              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                                HISTÓRICO DE COTAÇÕES EXPURGADAS ({archivedQuotes.length})
                              </p>
                              <div className="space-y-2">
                                {archivedQuotes.map((quote) => (
                                  <div key={quote.id} className="rounded bg-muted/30 p-2 text-xs">
                                    <p className="font-medium">
                                      {quote.source_name} · {formatarData(quote.quoted_at)}
                                    </p>
                                    <p className="text-muted-foreground">
                                      Motivo do expurgo:{" "}
                                      {quote.justificativa_expurgo || "Não registrado"}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {itemApproval && (
                            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                              <p className="font-semibold">Preço estimado aprovado</p>
                              <p>
                                Método: {itemApproval.method} · Unitário:{" "}
                                {formatarMoeda(itemApproval.approved_unit_price)} · Total:{" "}
                                {formatarMoeda(itemApproval.approved_total_price)}
                              </p>
                              <p className="text-muted-foreground">
                                Aprovado em {formatarData(itemApproval.approved_at)} ·{" "}
                                {itemApproval.sample_count} amostra(s)
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
            <TabsContent value="budget" className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setBudgetFormOpen((value) => !value)}>
                  <Plus className="h-4 w-4" /> Adicionar dotação
                </Button>
              </div>
              {budgetFormOpen && (
                <Card>
                  <CardContent className="pt-4">
                    <form onSubmit={salvarDotacao} className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Exercício *</Label>
                        <Input
                          type="number"
                          min={2000}
                          max={2200}
                          required
                          value={budgetForm.fiscal_year}
                          onChange={(event) =>
                            setBudgetForm((current) => ({
                              ...current,
                              fiscal_year: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Unidade orçamentária *</Label>
                        <Input
                          required
                          value={budgetForm.budget_unit}
                          onChange={(event) =>
                            setBudgetForm((current) => ({
                              ...current,
                              budget_unit: event.target.value,
                            }))
                          }
                        />
                      </div>
                      {(
                        [
                          ["functional_program", "Programa funcional"],
                          ["budget_action", "Ação orçamentária"],
                          ["expense_nature", "Natureza da despesa"],
                          ["funding_source", "Fonte de recurso"],
                        ] as const
                      ).map(([key, label]) => (
                        <div className="space-y-1" key={key}>
                          <Label>{label}</Label>
                          <Input
                            value={budgetForm[key]}
                            onChange={(event) =>
                              setBudgetForm((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                      <div className="space-y-1">
                        <Label>Valor alocado (R$) *</Label>
                        <Input
                          required
                          inputMode="decimal"
                          value={budgetForm.allocated_amount}
                          onChange={(event) =>
                            setBudgetForm((current) => ({
                              ...current,
                              allocated_amount: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Observações</Label>
                        <Textarea
                          rows={2}
                          value={budgetForm.notes}
                          onChange={(event) =>
                            setBudgetForm((current) => ({ ...current, notes: event.target.value }))
                          }
                        />
                      </div>
                      <div className="flex justify-end gap-2 sm:col-span-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setBudgetFormOpen(false)}
                        >
                          Cancelar
                        </Button>
                        <Button type="submit" disabled={saving}>
                          Salvar dotação
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              )}
              {budgets.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                  Nenhuma alocação orçamentária registrada.
                </div>
              ) : (
                <div className="space-y-2">
                  {budgets.map((entry) => (
                    <Card key={entry.id}>
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                        <div>
                          <p className="font-medium">
                            {entry.fiscal_year} · {entry.budget_unit}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[
                              entry.functional_program,
                              entry.budget_action,
                              entry.expense_nature,
                              entry.funding_source,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {entry.notes && (
                            <p className="text-xs text-muted-foreground">{entry.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <strong>{formatarMoeda(entry.allocated_amount)}</strong>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => void arquivarDotacao(entry)}
                            disabled={saving}
                            aria-label="Arquivar dotação"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onFechar}>
            Fechar
          </Button>
        </DialogFooter>
        <Dialog open={mapaAberto} onOpenChange={setMapaAberto}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Mapa comparativo de preços — {props.processNumber}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Mapa com memória de cálculo, histórico de expurgos, documentos comprobatórios e
              aprovação do preço estimado por item.
            </p>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Enquadramento normativo exige validação do órgão</AlertTitle>
              <AlertDescription>
                A aplicabilidade da IN SEGES/ME nº 65/2021 deve ser analisada em cada contratação
                conforme a origem dos recursos e a regulamentação local. O sistema não substitui o
                parecer jurídico da Administração.
              </AlertDescription>
            </Alert>
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      Enquadramento normativo e origem dos recursos deste processo
                    </p>
                    <p className="text-xs text-muted-foreground">
                      A aplicabilidade é validada individualmente para esta contratação; o perfil da
                      Secretaria serve apenas como referência inicial.
                    </p>
                  </div>
                  <Badge
                    variant={
                      compliance?.legal_review_status === "validated" ? "default" : "destructive"
                    }
                  >
                    {compliance?.legal_review_status === "validated"
                      ? "Validado"
                      : "Pendente de validação"}
                  </Badge>
                </div>
                {canApprovePrice ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Origem dos recursos do processo *</Label>
                        <Select
                          value={complianceForm.funding_source_type}
                          onValueChange={(value) =>
                            setComplianceForm((current) => ({
                              ...current,
                              funding_source_type: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unknown">Ainda não identificada</SelectItem>
                            <SelectItem value="own_resources">Recursos próprios do ente</SelectItem>
                            <SelectItem value="federal_transfer">Transferência da União</SelectItem>
                            <SelectItem value="state_transfer">Transferência estadual</SelectItem>
                            <SelectItem value="other_transfer">
                              Outra transferência voluntária
                            </SelectItem>
                            <SelectItem value="mixed">Recursos de origens mistas</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Programa / descrição da fonte de recursos</Label>
                        <Input
                          value={complianceForm.funding_source_description}
                          onChange={(event) =>
                            setComplianceForm((current) => ({
                              ...current,
                              funding_source_description: event.target.value,
                            }))
                          }
                          placeholder="Programa, ação orçamentária ou origem do repasse"
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Convênio / termo / instrumento de transferência</Label>
                        <Input
                          value={complianceForm.transfer_agreement_number}
                          onChange={(event) =>
                            setComplianceForm((current) => ({
                              ...current,
                              transfer_agreement_number: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Base normativa declarada</Label>
                        <Select
                          value={complianceForm.normative_basis}
                          onValueChange={(value) =>
                            setComplianceForm((current) => ({ ...current, normative_basis: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pendente de enquadramento</SelectItem>
                            <SelectItem value="in65_2021">IN SEGES/ME nº 65/2021</SelectItem>
                            <SelectItem value="local_regulation">
                              Regulamentação municipal/local
                            </SelectItem>
                            <SelectItem value="other">Outro fundamento normativo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Aplicabilidade da IN 65/2021</Label>
                        <Select
                          value={complianceForm.in65_applicability}
                          onValueChange={(value) =>
                            setComplianceForm((current) => ({
                              ...current,
                              in65_applicability: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pendente de análise</SelectItem>
                            <SelectItem value="applicable">Aplicável ao órgão/recursos</SelectItem>
                            <SelectItem value="adopted">
                              Adotada por regulamentação local
                            </SelectItem>
                            <SelectItem value="not_applicable">
                              Não aplicável (exige justificativa)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {complianceForm.normative_basis === "local_regulation" && (
                        <>
                          <div className="space-y-1">
                            <Label>Nome do regulamento local *</Label>
                            <Input
                              required
                              value={complianceForm.local_regulation_name}
                              onChange={(event) =>
                                setComplianceForm((current) => ({
                                  ...current,
                                  local_regulation_name: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Referência legal / publicação *</Label>
                            <Input
                              required
                              value={complianceForm.local_regulation_reference}
                              onChange={(event) =>
                                setComplianceForm((current) => ({
                                  ...current,
                                  local_regulation_reference: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      )}
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Fundamentação e observações da análise jurídica</Label>
                        <Textarea
                          rows={3}
                          value={complianceForm.legal_review_notes}
                          onChange={(event) =>
                            setComplianceForm((current) => ({
                              ...current,
                              legal_review_notes: event.target.value,
                            }))
                          }
                          placeholder="Registre a origem dos recursos, a norma local aplicável ou a justificativa de não aplicabilidade."
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {compliance?.validated_at && (
                        <p className="text-xs text-muted-foreground">
                          Última validação: {formatarData(compliance.validated_at)} · usuário
                          autenticado {compliance.validated_by}
                        </p>
                      )}
                      <Button
                        type="button"
                        onClick={() => void salvarConformidadeNormativa()}
                        disabled={
                          saving ||
                          complianceForm.funding_source_type === "unknown" ||
                          complianceForm.normative_basis === "pending" ||
                          complianceForm.in65_applicability === "pending"
                        }
                      >
                        Registrar validação normativa
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Seu perfil pode consultar a situação, mas somente a autoridade com permissão de
                    aprovação de preços pode registrar a validação normativa.
                  </p>
                )}
              </CardContent>
            </Card>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const csv = gerarCsvMapaDePrecos(
                    props.processNumber,
                    items as ItemMapa[],
                    quotes as CotacaoMapa[],
                  );
                  const url = URL.createObjectURL(
                    new Blob([csv], { type: "text/csv;charset=utf-8" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `mapa-comparativo-${props.processNumber.replace(/[^a-zA-Z0-9_-]+/g, "-") || "processo"}.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Exportar mapa para Excel (CSV)
              </Button>
              <Button disabled={saving} onClick={() => void exportarMapa("pdf")}>
                Gerar mapa PDF
              </Button>
              <Button disabled={saving} onClick={() => void exportarMapa("docx")}>
                Gerar mapa DOCX
              </Button>
              <Button disabled={saving} onClick={() => void exportarMapa("workflow")}>
                Encaminhar mapa para aprovação e assinatura
              </Button>
            </div>
            {items.map((item) => {
              const rows = quotes
                .filter((q) => q.procurement_item_id === item.id && q.is_active)
                .sort(
                  (a, b) =>
                    (precoUnitarioComFrete(a) ?? Infinity) - (precoUnitarioComFrete(b) ?? Infinity),
                );
              const resumo = calcularResumoDePrecos(rows);
              const archivedRows = quotes.filter(
                (q) => q.procurement_item_id === item.id && !q.is_active,
              );
              const itemApproval = approvals.find(
                (approval) =>
                  approval.procurement_item_id === item.id && approval.status === "approved",
              );
              const approvalForm = approvalForms[item.id] ?? {
                method: "mediana" as const,
                methodJustification: "",
                exceptionalJustification: "",
                otherUnitPrice: "",
              };
              let approvalPreview: ReturnType<typeof calcularPrecoHomologado> | null = null;
              try {
                if (rows.length > 0) {
                  approvalPreview = calcularPrecoHomologado(
                    approvalForm.method,
                    rows,
                    item.quantity,
                    approvalForm.method === "outro"
                      ? numeroDecimal(approvalForm.otherUnitPrice)
                      : undefined,
                  );
                }
              } catch {
                approvalPreview = null;
              }
              const sinais = expurgarAmostrasInconsistentes(rows);
              const dispersao = analisarDispersaoPrecos(
                rows.map(precoUnitarioComFrete).filter((v): v is number => v !== null),
              );
              return (
                <section key={item.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold">
                      {item.line_number}. {item.description}
                    </h3>
                    <Badge variant="outline">{resumo.quantidade} cotação(ões) válidas</Badge>
                  </div>
                  {rows.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      Nenhuma cotação ativa registrada para este item.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1180px] text-sm">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="p-2">Fornecedor / fonte</th>
                            <th className="p-2">Tipo / CNPJ</th>
                            <th className="p-2">Referência</th>
                            <th className="p-2">Cotação / acesso</th>
                            <th className="p-2 text-right">Unitário</th>
                            <th className="p-2 text-right">Frete</th>
                            <th className="p-2 text-right">Total</th>
                            <th className="p-2 text-right">Efetivo</th>
                            <th className="p-2">Condições / comprovante</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((q) => {
                            const supplier = suppliers.find((entry) => entry.id === q.supplier_id);
                            const signals = sinais.find((entry) => entry.cotacao.id === q.id);
                            return (
                              <tr key={q.id} className="border-t align-top">
                                <td className="p-2">
                                  {q.source_name}
                                  {q.selected_for_estimate && (
                                    <Badge className="ml-2" variant="secondary">
                                      Referência escolhida
                                    </Badge>
                                  )}
                                  {signals?.motivos.map((reason) => (
                                    <p key={reason} className="mt-1 text-xs text-amber-700">
                                      {reason}
                                    </p>
                                  ))}
                                </td>
                                <td className="p-2">
                                  <p>{q.source_type.replaceAll("_", " ")}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {q.source_tax_id || supplier?.cnpj || "CNPJ/CPF não informado"}
                                  </p>
                                </td>
                                <td className="p-2">
                                  <p>{q.reference_identifier || "—"}</p>
                                  <button
                                    type="button"
                                    className="text-xs text-primary underline"
                                    disabled={q.selected_for_estimate || saving}
                                    aria-pressed={q.selected_for_estimate}
                                    onClick={() => void selecionarCotacao(q)}
                                  >
                                    {q.selected_for_estimate
                                      ? "Referência selecionada"
                                      : "Selecionar referência"}
                                  </button>
                                </td>
                                <td className="p-2">
                                  <p>{formatarData(q.quoted_at)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Acesso:{" "}
                                    {q.accessed_at
                                      ? new Date(q.accessed_at).toLocaleString("pt-BR")
                                      : "Não registrado"}
                                  </p>
                                </td>
                                <td className="p-2 text-right">{formatarMoeda(q.unit_price)}</td>
                                <td className="p-2 text-right">{formatarMoeda(q.delivery_cost)}</td>
                                <td className="p-2 text-right font-medium">
                                  {formatarMoeda(q.total_price ?? 0)}
                                </td>
                                <td className="p-2 text-right">
                                  {formatarMoeda(precoUnitarioComFrete(q))}
                                </td>
                                <td className="p-2">
                                  <p className="max-w-[260px] whitespace-normal text-xs">
                                    {[
                                      q.brand_model,
                                      q.delivery_term,
                                      q.payment_terms,
                                      q.warranty_terms,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") || "Condições não detalhadas"}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    {q.reference_url && (
                                      <a
                                        className="text-xs text-primary underline"
                                        href={q.reference_url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Consultar fonte
                                      </a>
                                    )}
                                    {q.evidence_storage_path && (
                                      <button
                                        type="button"
                                        className="text-xs text-primary underline"
                                        onClick={() => void abrirComprovanteCotacao(q)}
                                      >
                                        Comprovante: {q.evidence_file_name}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {archivedRows.length > 0 && (
                    <div className="rounded-md border border-dashed p-3">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">
                        COTAÇÕES EXPURGADAS — HISTÓRICO PRESERVADO ({archivedRows.length})
                      </p>
                      <div className="space-y-2">
                        {archivedRows.map((quote) => (
                          <div
                            key={quote.id}
                            className="flex flex-wrap justify-between gap-2 rounded bg-muted/30 p-2 text-xs"
                          >
                            <div>
                              <p className="font-medium">
                                {quote.source_name} · {formatarData(quote.quoted_at)}
                              </p>
                              <p className="text-muted-foreground">
                                Tipo: {quote.source_type.replaceAll("_", " ")} · Unitário efetivo:{" "}
                                {formatarMoeda(precoUnitarioComFrete(quote))}
                              </p>
                              <p className="text-amber-800">
                                Justificativa do expurgo:{" "}
                                {quote.justificativa_expurgo || "Não registrada"}
                              </p>
                            </div>
                            {quote.evidence_storage_path && (
                              <button
                                type="button"
                                className="text-primary underline"
                                onClick={() => void abrirComprovanteCotacao(quote)}
                              >
                                Consultar comprovante
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {dispersao.dispersaoExcessiva && (
                    <p
                      role="status"
                      className="rounded border border-amber-400 bg-amber-50 p-3 text-amber-950"
                    >
                      Dispersão superior a 25%. Revise as fontes e justifique as exclusões antes da
                      homologação.
                    </p>
                  )}
                  {rows.length < 3 && (
                    <p className="text-amber-700">
                      Menos de três cotações: exige análise e justificativa da equipe.
                    </p>
                  )}
                  <p>
                    Referência estatística (mediana, não homologada):{" "}
                    {formatarMoeda(resumo.mediana)}
                  </p>
                  {itemApproval && (
                    <Alert>
                      <AlertTitle>Preço estimado aprovado</AlertTitle>
                      <AlertDescription>
                        Método: {itemApproval.method} · Unitário:{" "}
                        {formatarMoeda(itemApproval.approved_unit_price)} · Total:{" "}
                        {formatarMoeda(itemApproval.approved_total_price)} · Aprovado em{" "}
                        {formatarData(itemApproval.approved_at)}.
                      </AlertDescription>
                    </Alert>
                  )}
                  {canApprovePrice ? (
                    <div className="space-y-3 rounded-lg border p-3">
                      <div>
                        <p className="font-semibold">Aprovação do preço estimado</p>
                        <p className="text-xs text-muted-foreground">
                          A aprovação é por item e fica registrada com método, justificativa,
                          amostras e responsável.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Método estatístico</Label>
                          <Select
                            value={approvalForm.method}
                            onValueChange={(value) =>
                              setApprovalForms((current) => ({
                                ...current,
                                [item.id]: {
                                  ...approvalForm,
                                  method: value as "media" | "mediana" | "menor" | "outro",
                                },
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="media">Média aritmética</SelectItem>
                              <SelectItem value="mediana">Mediana</SelectItem>
                              <SelectItem value="menor">Menor preço</SelectItem>
                              <SelectItem value="outro">Outro critério justificado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {approvalForm.method === "outro" && (
                          <div className="space-y-1">
                            <Label>Preço unitário aprovado (R$)</Label>
                            <Input
                              inputMode="decimal"
                              value={approvalForm.otherUnitPrice}
                              onChange={(event) =>
                                setApprovalForms((current) => ({
                                  ...current,
                                  [item.id]: {
                                    ...approvalForm,
                                    otherUnitPrice: event.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                        )}
                        <div className="space-y-1 sm:col-span-2">
                          <Label>
                            Justificativa da escolha do método * (mínimo de{" "}
                            {approvalForm.method === "outro" ? 20 : 10} caracteres)
                          </Label>
                          <Textarea
                            rows={2}
                            value={approvalForm.methodJustification}
                            onChange={(event) =>
                              setApprovalForms((current) => ({
                                ...current,
                                [item.id]: {
                                  ...approvalForm,
                                  methodJustification: event.target.value,
                                },
                              }))
                            }
                            placeholder="Explique por que o método é adequado à série de preços e ao objeto."
                          />
                        </div>
                        {approvalPreview && approvalPreview.quantidadeAmostras < 3 && (
                          <div className="space-y-1 sm:col-span-2">
                            <Label>Justificativa excepcional para menos de três preços *</Label>
                            <Textarea
                              rows={2}
                              value={approvalForm.exceptionalJustification}
                              onChange={(event) =>
                                setApprovalForms((current) => ({
                                  ...current,
                                  [item.id]: {
                                    ...approvalForm,
                                    exceptionalJustification: event.target.value,
                                  },
                                }))
                              }
                              placeholder="Registre a impossibilidade de obter três preços e a fundamentação para prosseguir."
                            />
                          </div>
                        )}
                      </div>
                      {approvalPreview && (
                        <p className="text-sm">
                          Prévia do método:{" "}
                          <strong>{formatarMoeda(approvalPreview.precoUnitarioAprovado)}</strong>{" "}
                          por unidade · total{" "}
                          <strong>{formatarMoeda(approvalPreview.precoTotalAprovado)}</strong> ·
                          {approvalPreview.quantidadeAmostras} amostra(s)
                        </p>
                      )}
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          disabled={saving || rows.length === 0 || !approvalPreview}
                          onClick={() => void aprovarPreco(item)}
                        >
                          Registrar aprovação do preço
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      A aprovação do preço depende de perfil com permissão específica da Secretaria.
                    </p>
                  )}
                  <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Menor unitário c/ frete</dt>
                      <dd className="font-semibold">{formatarMoeda(resumo.menor)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Média</dt>
                      <dd className="font-semibold">{formatarMoeda(resumo.media)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Mediana</dt>
                      <dd className="font-semibold">{formatarMoeda(resumo.mediana)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Coeficiente de variação</dt>
                      <dd className="font-semibold">
                        {resumo.coeficienteVariacao === null
                          ? "Não calculável"
                          : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(
                              resumo.coeficienteVariacao,
                            ) + "%"}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Frete rateado pela quantidade cotada. O mapa não exclui valores automaticamente;
                    a análise e justificativa permanecem sob responsabilidade da equipe. Referência
                    escolhida:{" "}
                    {rows.find((q) => q.selected_for_estimate)?.source_name ?? "Não definida"}.
                  </p>
                </section>
              );
            })}
            <DialogFooter>
              <Button variant="outline" onClick={() => setMapaAberto(false)}>
                Fechar mapa
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function NovoProcesso(props: {
  aberto: boolean;
  onFechar: () => void;
  tenantId: string;
  userId: string;
  onSalvo: (processoId: string) => void;
}) {
  const vazio = {
    number: "",
    title: "",
    description: "",
    modality: "pregao",
    priority: "normal",
    requesting_unit: "",
    responsible_name: "",
    estimated_value: "",
    due_date: "",
  };
  const [f, setF] = useState(vazio);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof vazio) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const valorEstimado = f.estimated_value.trim() ? numeroDecimal(f.estimated_value) : null;
    if (valorEstimado !== null && (!Number.isFinite(valorEstimado) || valorEstimado < 0)) {
      toast.error("Informe um valor estimado válido e não negativo.");
      return;
    }

    setSalvando(true);
    const { data: processId, error } = await db.rpc("create_procurement_process_with_checklist", {
      p_tenant_id: props.tenantId,
      p_number: f.number.trim(),
      p_title: f.title.trim(),
      p_modality: f.modality,
      p_priority: f.priority,
      ...(f.description.trim() ? { p_description: f.description.trim() } : {}),
      ...(f.requesting_unit.trim() ? { p_requesting_unit: f.requesting_unit.trim() } : {}),
      ...(f.responsible_name.trim() ? { p_responsible_name: f.responsible_name.trim() } : {}),
      ...(valorEstimado !== null ? { p_estimated_value: valorEstimado } : {}),
      ...(f.due_date ? { p_due_date: f.due_date } : {}),
    });
    setSalvando(false);
    if (error || !processId) {
      toast.error(error?.message ?? "Não foi possível criar o processo.");
      return;
    }

    toast.success("Processo criado com o checklist completo.");
    setF(vazio);
    props.onSalvo(processId);
    props.onFechar();
  }

  return (
    <Dialog open={props.aberto} onOpenChange={(o) => !o && props.onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo processo de contratação</DialogTitle>
        </DialogHeader>
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Nº do processo *</Label>
            <Input required value={f.number} onChange={(e) => set("number")(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Modalidade</Label>
            <Select value={f.modality} onValueChange={set("modality")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODALIDADES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Objeto *</Label>
            <Input
              required
              minLength={3}
              value={f.title}
              onChange={(e) => set("title")(e.target.value)}
              placeholder="Aquisição de medicamentos da farmácia básica"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Justificativa</Label>
            <Textarea value={f.description} onChange={(e) => set("description")(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Setor requisitante</Label>
            <Input
              value={f.requesting_unit}
              onChange={(e) => set("requesting_unit")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Responsável</Label>
            <Input
              value={f.responsible_name}
              onChange={(e) => set("responsible_name")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor estimado (R$)</Label>
            <Input
              inputMode="decimal"
              value={f.estimated_value}
              onChange={(e) => set("estimated_value")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Prazo desejado</Label>
            <Input
              type="date"
              value={f.due_date}
              onChange={(e) => set("due_date")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Prioridade</Label>
            <Select value={f.priority} onValueChange={set("priority")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baixa">Baixa</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={props.onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Criar processo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
