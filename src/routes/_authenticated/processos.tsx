import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  ETAPAS,
  etapaAnterior,
  formatarData,
  formatarMoeda,
  MODALIDADES,
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
  const [loading, setLoading] = useState(true);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<"kanban" | "lista">("kanban");
  const [novo, setNovo] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [dadosAbertos, setDadosAbertos] = useState(false);

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setProcessos([]);
      setItens([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErro(null);
    try {
      const [processosRows, checklistRows] = await Promise.all([
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("procurement_processes")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .neq("status", "arquivado")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("process_items")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .order("sort_order")
            .order("id")
            .range(inicio, fim),
        ),
      ]);
      setPendente(false);
      setProcessos(comEtapaValida(processosRows));
      setItens(comEtapaValida(checklistRows));
    } catch (error) {
      setProcessos([]);
      setItens([]);
      const message = error instanceof Error ? error.message : String(error);
      if (bancoNaoConfigurado(message)) setPendente(true);
      else setErro(message);
    } finally {
      setLoading(false);
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

  async function moverEtapa(p: Processo, destino: EtapaId | null) {
    if (!destino) return;
    const { error } = await db
      .from("procurement_processes")
      .update({ stage: destino, updated_by: userId })
      .eq("id", p.id);
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

  async function concluir(p: Processo) {
    const { error } = await db
      .from("procurement_processes")
      .update({ status: "concluido", updated_by: userId })
      .eq("id", p.id);
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
        <div className="flex gap-2">
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
          <AlertTitle>Aguardando ativação no banco de dados</AlertTitle>
          <AlertDescription>
            A esteira está pronta, mas a estrutura de processos ainda não foi aprovada e aplicada no
            Supabase SMS2.
          </AlertDescription>
        </Alert>
      )}
      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : visao === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {ETAPAS.map((e, idx) => {
            const daEtapa = processos.filter((p) => p.stage === e.id);
            return (
              <div key={e.id} className="w-64 shrink-0 rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-semibold">
                  {idx + 1}. {e.nome}{" "}
                  <span className="font-normal text-muted-foreground">({daEtapa.length})</span>
                </p>
                <p className="mb-3 text-xs text-muted-foreground">{e.descricao}</p>
                <div className="space-y-2">
                  {daEtapa.map((p) => (
                    <CartaoProcesso key={p.id} p={p} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : processos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum processo cadastrado.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {processos.map((p) => (
            <CartaoProcesso key={p.id} p={p} />
          ))}
        </div>
      )}

      <NovoProcesso
        aberto={novo}
        onFechar={() => setNovo(false)}
        tenantId={selecionado.id}
        userId={userId}
        onSalvo={carregar}
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
                        <label key={i.id} className="flex items-center gap-2 py-1 text-sm">
                          <Checkbox checked={i.is_done} onCheckedChange={() => alternarItem(i)} />
                          <span className={i.is_done ? "text-muted-foreground line-through" : ""}>
                            {i.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
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
  is_active: boolean;
};

type CotacaoCompra = {
  id: string;
  procurement_item_id: string;
  supplier_id: string | null;
  source_name: string;
  reference_url: string | null;
  quoted_at: string;
  quantity: number;
  unit_price: number;
  delivery_cost: number;
  total_price: number;
  notes: string | null;
  selected_for_estimate: boolean;
  is_active: boolean;
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

type FornecedorCompra = { id: string; legal_name: string };

function numeroDecimal(value: string): number {
  return Number(value.trim().replace(/\s/g, "").replace(",", "."));
}

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
  const [budgets, setBudgets] = useState<DotacaoCompra[]>([]);
  const [suppliers, setSuppliers] = useState<FornecedorCompra[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [quoteTarget, setQuoteTarget] = useState<string | null>(null);
  const [budgetFormOpen, setBudgetFormOpen] = useState(false);

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
      const [itemRows, budgetRows, supplierRows] = await Promise.all([
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
            .select("id,legal_name")
            .eq("tenant_id", props.tenantId)
            .order("legal_name")
            .order("id")
            .range(inicio, fim),
        ),
      ]);

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
            .eq("is_active", true)
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
      toast.error(error instanceof Error ? error.message : "Falha ao carregar os dados da contratação.");
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
    setSaving(true);
    const { error } = await db.from("procurement_price_quotes").insert({
      tenant_id: props.tenantId,
      procurement_item_id: quoteTarget,
      supplier_id: quoteForm.supplier_id === "sem_fornecedor" ? null : quoteForm.supplier_id,
      source_name: quoteForm.source_name.trim() || supplier?.legal_name || "",
      reference_url: quoteForm.reference_url.trim() || null,
      quoted_at: quoteForm.quoted_at,
      quantity: quoteQuantity,
      unit_price: unitPrice,
      delivery_cost: deliveryCost,
      notes: quoteForm.notes.trim() || null,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setQuoteTarget(null);
    setQuoteForm({
      supplier_id: "sem_fornecedor",
      source_name: "",
      reference_url: "",
      quoted_at: new Date().toISOString().slice(0, 10),
      quantity: String(item?.quantity ?? 1),
      unit_price: "",
      delivery_cost: "0",
      notes: "",
    });
    toast.success("Cotação registrada.");
    await carregarDados();
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

  async function arquivarCotacao(quote: CotacaoCompra) {
    setSaving(true);
    const { error } = await db
      .from("procurement_price_quotes")
      .update({ is_active: false, selected_for_estimate: false, updated_by: props.userId })
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
              <div className="flex justify-end">
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
                      (quote) => quote.procurement_item_id === item.id,
                    );
                    return (
                      <Card key={item.id}>
                        <CardContent className="space-y-3 pt-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {item.line_number}. {item.description}
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
                                  onValueChange={(value) =>
                                    setQuoteForm((current) => ({
                                      ...current,
                                      supplier_id: value,
                                      source_name:
                                        value === "sem_fornecedor"
                                          ? current.source_name
                                          : (suppliers.find((supplier) => supplier.id === value)
                                              ?.legal_name ?? current.source_name),
                                    }))
                                  }
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
                                        {formatarMoeda(quote.total_price)}
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
      </DialogContent>
    </Dialog>
  );
}

function NovoProcesso(props: {
  aberto: boolean;
  onFechar: () => void;
  tenantId: string;
  userId: string;
  onSalvo: () => void;
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
    const valorEstimado = f.estimated_value.trim()
      ? Number(f.estimated_value.replace(",", "."))
      : null;
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
    props.onFechar();
    props.onSalvo();
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
