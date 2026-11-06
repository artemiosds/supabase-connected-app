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
} from "lucide-react";
import { toast } from "sonner";
import { dbFase3, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  CHECKLIST_PADRAO,
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

const corPrioridade: Record<string, string> = {
  urgente: "bg-destructive/15 text-destructive",
  alta: "bg-warning/20 text-foreground",
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

  const carregar = useCallback(async () => {
    if (!selecionado?.id) return;
    setLoading(true);
    setErro(null);
    const [p, i] = await Promise.all([
      dbFase3
        .from("procurement_processes")
        .select("*")
        .eq("tenant_id", selecionado.id)
        .neq("status", "arquivado")
        .order("created_at", { ascending: false }),
      dbFase3.from("process_items").select("*").eq("tenant_id", selecionado.id).order("sort_order"),
    ]);
    if (p.error) {
      if (bancoNaoConfigurado(p.error.message)) setPendente(true);
      else setErro(p.error.message);
    } else {
      setPendente(false);
      setProcessos(p.data ?? []);
      setItens(i.data ?? []);
    }
    setLoading(false);
  }, [selecionado?.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const progresso = (id: string) => {
    const lista = itens.filter((x) => x.process_id === id);
    return lista.length ? Math.round((lista.filter((x) => x.is_done).length / lista.length) * 100) : 0;
  };

  async function moverEtapa(p: Processo, destino: EtapaId | null) {
    if (!destino) return;
    const { error } = await dbFase3
      .from("procurement_processes")
      .update({ stage: destino, updated_by: userId })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(`Processo movido para ${ETAPAS.find((e) => e.id === destino)?.nome}.`);
    void carregar();
  }

  async function alternarItem(item: Item) {
    const { error } = await dbFase3
      .from("process_items")
      .update({ is_done: !item.is_done, updated_by: userId })
      .eq("id", item.id);
    if (error) return toast.error(error.message);
    setItens((s) => s.map((x) => (x.id === item.id ? { ...x, is_done: !x.is_done } : x)));
  }

  async function concluir(p: Processo) {
    const { error } = await dbFase3
      .from("procurement_processes")
      .update({ status: "concluido", updated_by: userId })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
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
            A esteira está pronta, mas a estrutura de processos ainda não foi aprovada e aplicada
            no Supabase SMS2.
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
                  const lista = itens.filter(
                    (i) => i.process_id === aberto.id && i.stage === e.id,
                  );
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
    </div>
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
    setSalvando(true);
    const { data, error } = await dbFase3
      .from("procurement_processes")
      .insert({
        tenant_id: props.tenantId,
        number: f.number.trim(),
        title: f.title.trim(),
        description: f.description.trim() || null,
        modality: f.modality,
        priority: f.priority,
        requesting_unit: f.requesting_unit.trim() || null,
        responsible_name: f.responsible_name.trim() || null,
        estimated_value: f.estimated_value ? Number(f.estimated_value.replace(",", ".")) : null,
        due_date: f.due_date || null,
        created_by: props.userId,
        updated_by: props.userId,
      })
      .select("id")
      .single();
    if (error) {
      setSalvando(false);
      return toast.error(error.message);
    }
    // Checklist automático com os documentos de cada etapa.
    const itens = ETAPAS.flatMap((etapa) =>
      CHECKLIST_PADRAO[etapa.id].map((title, i) => ({
        tenant_id: props.tenantId,
        process_id: data.id,
        stage: etapa.id,
        title,
        sort_order: i,
        created_by: props.userId,
        updated_by: props.userId,
      })),
    );
    const r = await dbFase3.from("process_items").insert(itens);
    setSalvando(false);
    if (r.error) toast.error(`Processo criado, mas o checklist falhou: ${r.error.message}`);
    else toast.success("Processo criado com o checklist de documentos.");
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
