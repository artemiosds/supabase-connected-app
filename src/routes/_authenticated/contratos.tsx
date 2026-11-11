import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  History,
  Pencil,
  Loader2,
  Plus,
  ScrollText,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { exportarCsv } from "@/lib/csv-export";
import { ContractItemsBalance } from "@/components/contracts/contract-items-balance";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  diasAte,
  formatarData,
  formatarMoeda,
  MODALIDADES,
  nivelAlerta,
  numeroDecimal,
  ORIENTACAO_ALERTA,
  ROTULO_ALERTA,
  type NivelAlerta,
} from "@/lib/contratacao";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const Route = createFileRoute("/_authenticated/contratos")({
  head: () => ({
    meta: [
      { title: "Contratos e vencimentos — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Contratos, aditivos e régua de alertas de vencimento de 120, 90, 60 e 30 dias.",
      },
    ],
  }),
  component: Contratos,
});

type Contrato = {
  id: string;
  number: string;
  object: string;
  supplier_id: string | null;
  process_id: string | null;
  modality: string;
  instrument_type: string;
  total_value: number;
  start_date: string;
  end_date: string;
  manager_name: string | null;
  inspector_name: string | null;
  ordinance: string | null;
  status: string;
  notes: string | null;
};

type ContratoForm = {
  number: string;
  object: string;
  supplier_id: string;
  process_id: string;
  modality: string;
  instrument_type: string;
  total_value: string;
  start_date: string;
  end_date: string;
  manager_name: string;
  inspector_name: string;
  ordinance: string;
  status: string;
  notes: string;
};

const CONTRATO_FORM_VAZIO: ContratoForm = {
  number: "",
  object: "",
  supplier_id: "",
  process_id: "",
  modality: "pregao",
  instrument_type: "contrato",
  total_value: "",
  start_date: "",
  end_date: "",
  manager_name: "",
  inspector_name: "",
  ordinance: "",
  status: "vigente",
  notes: "",
};

type Aditivo = {
  id: string;
  contract_id: string;
  number: string;
  kind: string;
  new_end_date: string | null;
  value_change: number;
  notes: string | null;
  signed_at: string;
  created_at: string;
};

type ProcessoOpcao = {
  id: string;
  number: string;
  title: string;
};

const corAlerta: Record<NivelAlerta, string> = {
  vencido: "bg-destructive text-destructive-foreground",
  "30": "bg-destructive/15 text-destructive border-destructive/30",
  "60": "bg-accent text-accent-foreground border-accent",
  "90": "bg-secondary text-secondary-foreground",
  "120": "bg-primary/10 text-primary border-primary/30",
  ok: "bg-muted text-muted-foreground",
};

function Contratos() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [lista, setLista] = useState<Contrato[]>([]);
  const [fornecedores, setFornecedores] = useState<{ id: string; legal_name: string }[]>([]);
  const [processos, setProcessos] = useState<ProcessoOpcao[]>([]);
  const [aditivos, setAditivos] = useState<Aditivo[]>([]);
  const [historicosAbertos, setHistoricosAbertos] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [contratoEditando, setContratoEditando] = useState<Contrato | null>(null);
  const [aditivoDe, setAditivoDe] = useState<Contrato | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "alerta">("todos");

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setLista([]);
      setFornecedores([]);
      setProcessos([]);
      setAditivos([]);
      setHistoricosAbertos({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setErro(null);
    try {
      const [contratosRows, fornecedoresRows, processosRows, aditivosRows] = await Promise.all([
        carregarTodasAsPaginas<Contrato>((inicio, fim) =>
          db
            .from("contracts")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .order("end_date", { ascending: true })
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("suppliers")
            .select("id, legal_name")
            .eq("tenant_id", selecionado.id)
            .order("legal_name")
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<ProcessoOpcao>((inicio, fim) =>
          db
            .from("procurement_processes")
            .select("id,number,title")
            .eq("tenant_id", selecionado.id)
            .neq("status", "arquivado")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<Aditivo>((inicio, fim) =>
          db
            .from("contract_amendments")
            .select(
              "id,contract_id,number,kind,new_end_date,value_change,notes,signed_at,created_at",
            )
            .eq("tenant_id", selecionado.id)
            .order("signed_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
      ]);
      setPendente(false);
      setLista(contratosRows);
      setFornecedores(fornecedoresRows);
      setProcessos(processosRows);
      setAditivos(aditivosRows);
    } catch (error) {
      setLista([]);
      setFornecedores([]);
      setProcessos([]);
      setAditivos([]);
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

  const comNivel = useMemo(
    () =>
      lista.map((c) => {
        const dias = diasAte(c.end_date);
        return {
          ...c,
          dias,
          nivel: c.status === "vigente" ? nivelAlerta(dias) : ("ok" as const),
        };
      }),
    [lista],
  );
  const contagem = (n: NivelAlerta) => comNivel.filter((c) => c.nivel === n).length;
  const exibidos = filtro === "alerta" ? comNivel.filter((c) => c.nivel !== "ok") : comNivel;
  const nomeFornecedor = (id: string | null) =>
    fornecedores.find((f) => f.id === id)?.legal_name ?? "—";
  const nomeProcesso = (id: string | null) => {
    const processo = processos.find((item) => item.id === id);
    return processo ? `${processo.number} — ${processo.title}` : null;
  };
  const rotuloTipoAditivo: Record<string, string> = {
    prorrogacao: "Prorrogação de prazo",
    acrescimo: "Acréscimo de valor",
    supressao: "Supressão de valor",
    outro: "Outro",
  };

  if (!selecionado) {
    return <p className="text-muted-foreground">Selecione uma organização no topo da tela.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contratos e vencimentos</h1>
          <p className="text-sm text-muted-foreground">
            Régua de alertas: 120, 90, 60 e 30 dias antes do fim da vigência.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || exibidos.length === 0}
            onClick={() =>
              exportarCsv(
                `contratos-${new Date().toISOString().slice(0, 10)}.csv`,
                [
                  {
                    header: "Número",
                    value: (contrato: (typeof exibidos)[number]) => contrato.number,
                  },
                  {
                    header: "Instrumento",
                    value: (contrato: (typeof exibidos)[number]) =>
                      contrato.instrument_type === "ata_registro_precos"
                        ? "Ata de Registro de Preços"
                        : "Contrato",
                  },
                  {
                    header: "Objeto",
                    value: (contrato: (typeof exibidos)[number]) => contrato.object,
                  },
                  {
                    header: "Fornecedor",
                    value: (contrato: (typeof exibidos)[number]) =>
                      nomeFornecedor(contrato.supplier_id),
                  },
                  {
                    header: "Modalidade",
                    value: (contrato: (typeof exibidos)[number]) =>
                      MODALIDADES[contrato.modality] ?? contrato.modality,
                  },
                  {
                    header: "Valor total",
                    value: (contrato: (typeof exibidos)[number]) => Number(contrato.total_value),
                  },
                  {
                    header: "Início",
                    value: (contrato: (typeof exibidos)[number]) => contrato.start_date,
                  },
                  {
                    header: "Fim",
                    value: (contrato: (typeof exibidos)[number]) => contrato.end_date,
                  },
                  {
                    header: "Dias restantes",
                    value: (contrato: (typeof exibidos)[number]) => contrato.dias,
                  },
                  {
                    header: "Status",
                    value: (contrato: (typeof exibidos)[number]) => contrato.status,
                  },
                ],
                exibidos,
              )
            }
          >
            <Download className="h-4 w-4" /> Exportar Excel (CSV)
          </Button>
          <Button
            onClick={() => {
              setContratoEditando(null);
              setNovoAberto(true);
            }}
            disabled={pendente}
          >
            <Plus className="h-4 w-4" /> Novo contrato
          </Button>
        </div>
      </div>

      {pendente && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Dados de contratos indisponíveis</AlertTitle>
          <AlertDescription>
            Não foi possível acessar os dados de contratos no momento. A estrutura do módulo já está
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(["vencido", "30", "60", "90", "120"] as NivelAlerta[]).map((n) => (
          <Card key={n}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{ROTULO_ALERTA[n]}</p>
              <p className="text-2xl font-semibold">{contagem(n)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={filtro === "todos" ? "default" : "outline"}
          onClick={() => setFiltro("todos")}
        >
          Todos
        </Button>
        <Button
          size="sm"
          variant={filtro === "alerta" ? "default" : "outline"}
          onClick={() => setFiltro("alerta")}
        >
          Somente com alerta
        </Button>
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : exibidos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Nenhum contrato para exibir</p>
            <p className="text-sm text-muted-foreground">
              Cadastre o primeiro contrato para acompanhar os vencimentos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {exibidos.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-base">Contrato nº {c.number}</CardTitle>
                  <p className="text-sm text-muted-foreground">{c.object}</p>
                </div>
                <Badge variant="outline" className={corAlerta[c.nivel]}>
                  {c.status !== "vigente"
                    ? c.status
                    : c.dias < 0
                      ? `Vencido há ${-c.dias} dia(s)`
                      : `${c.dias} dia(s) restantes`}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  <span>Fornecedor: {nomeFornecedor(c.supplier_id)}</span>
                  <span>Modalidade: {MODALIDADES[c.modality] ?? c.modality}</span>
                  <span>
                    Instrumento:{" "}
                    {c.instrument_type === "ata_registro_precos"
                      ? "Ata de Registro de Preços"
                      : "Contrato"}
                  </span>
                  {c.process_id && (
                    <span className="sm:col-span-2">
                      Processo vinculado: {nomeProcesso(c.process_id) ?? "Processo associado"}
                    </span>
                  )}
                  <span>Valor: {formatarMoeda(Number(c.total_value))}</span>
                  <span>
                    Vigência: {formatarData(c.start_date)} a {formatarData(c.end_date)}
                  </span>
                  <span>Gestor: {c.manager_name || "—"}</span>
                  <span>
                    Fiscal: {c.inspector_name || "—"}
                    {c.ordinance ? ` (Portaria ${c.ordinance})` : ""}
                  </span>
                </div>
                {c.nivel !== "ok" && (
                  <p className="rounded-md bg-muted px-3 py-2 text-foreground">
                    {ORIENTACAO_ALERTA[c.nivel]}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={c.status === "arquivado"}
                    onClick={() => {
                      setContratoEditando(c);
                      setNovoAberto(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Editar contrato
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAditivoDe(c)}>
                    <FilePlus2 className="h-4 w-4" /> Registrar aditivo
                  </Button>
                  {c.process_id && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/processos">Abrir processo relacionado</Link>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={historicosAbertos[c.id] === true}
                    aria-controls={`historico-aditivos-${c.id}`}
                    onClick={() =>
                      setHistoricosAbertos((current) => ({
                        ...current,
                        [c.id]: !current[c.id],
                      }))
                    }
                  >
                    <History className="h-4 w-4" />
                    Histórico ({aditivos.filter((item) => item.contract_id === c.id).length})
                    {historicosAbertos[c.id] ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <ContractItemsBalance
                  contract={c}
                  tenantId={selecionado.id}
                  userId={session?.user.id ?? ""}
                />
                {historicosAbertos[c.id] && (
                  <div
                    id={`historico-aditivos-${c.id}`}
                    className="space-y-2 rounded-lg border bg-muted/20 p-3"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Histórico de aditivos do contrato
                    </p>
                    {aditivos.filter((item) => item.contract_id === c.id).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum aditivo foi registrado para este contrato.
                      </p>
                    ) : (
                      <ol className="space-y-3">
                        {aditivos
                          .filter((item) => item.contract_id === c.id)
                          .map((item) => (
                            <li key={item.id} className="border-l-2 border-primary/30 pl-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium">{item.number}</p>
                                <Badge variant="outline">
                                  {rotuloTipoAditivo[item.kind] ?? item.kind}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {new Date(item.signed_at).toLocaleDateString("pt-BR")}
                                {item.new_end_date
                                  ? ` · Nova vigência até ${formatarData(item.new_end_date)}`
                                  : ""}
                                {Number(item.value_change) !== 0
                                  ? ` · Alteração: ${formatarMoeda(Number(item.value_change))}`
                                  : ""}
                              </p>
                              {item.notes && (
                                <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>
                              )}
                            </li>
                          ))}
                      </ol>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NovoContrato
        aberto={novoAberto}
        contrato={contratoEditando}
        hasAditivos={
          !!contratoEditando && aditivos.some((item) => item.contract_id === contratoEditando.id)
        }
        onFechar={() => {
          setNovoAberto(false);
          setContratoEditando(null);
        }}
        tenantId={selecionado.id}
        userId={session?.user.id ?? ""}
        fornecedores={fornecedores}
        processos={processos}
        onSalvo={carregar}
      />
      <NovoAditivo
        contrato={aditivoDe}
        onFechar={() => setAditivoDe(null)}
        tenantId={selecionado.id}
        userId={session?.user.id ?? ""}
        onSalvo={carregar}
      />
    </div>
  );
}

function NovoContrato(props: {
  aberto: boolean;
  contrato: Contrato | null;
  hasAditivos: boolean;
  onFechar: () => void;
  tenantId: string;
  userId: string;
  fornecedores: { id: string; legal_name: string }[];
  processos: ProcessoOpcao[];
  onSalvo: () => void;
}) {
  const [f, setF] = useState<ContratoForm>(CONTRATO_FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof ContratoForm) => (v: string) => setF((current) => ({ ...current, [k]: v }));

  useEffect(() => {
    if (!props.aberto) return;
    const contrato = props.contrato;
    setF(
      contrato
        ? {
            number: contrato.number,
            object: contrato.object,
            supplier_id: contrato.supplier_id ?? "",
            process_id: contrato.process_id ?? "",
            modality: contrato.modality,
            instrument_type: contrato.instrument_type,
            total_value: String(Number(contrato.total_value)),
            start_date: contrato.start_date,
            end_date: contrato.end_date,
            manager_name: contrato.manager_name ?? "",
            inspector_name: contrato.inspector_name ?? "",
            ordinance: contrato.ordinance ?? "",
            status: contrato.status,
            notes: contrato.notes ?? "",
          }
        : CONTRATO_FORM_VAZIO,
    );
  }, [props.aberto, props.contrato]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!props.userId) {
      toast.error("Não foi possível identificar o usuário da sessão.");
      return;
    }
    if (f.end_date < f.start_date) {
      toast.error("A data final deve ser igual ou posterior à data inicial.");
      return;
    }
    const totalValue = f.total_value.trim() ? numeroDecimal(f.total_value) : 0;
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      toast.error("Informe um valor global válido e não negativo.");
      return;
    }
    if (
      props.contrato &&
      props.hasAditivos &&
      (totalValue !== Number(props.contrato.total_value) || f.end_date !== props.contrato.end_date)
    ) {
      toast.error(
        "Com aditivos registrados, alterações de valor e vigência devem ser feitas por novo aditivo.",
      );
      return;
    }

    setSalvando(true);
    const dadosContrato = {
      number: f.number.trim(),
      object: f.object.trim(),
      supplier_id: f.supplier_id || null,
      process_id: f.process_id || null,
      modality: f.modality,
      instrument_type: f.instrument_type,
      total_value: totalValue,
      start_date: f.start_date,
      end_date: f.end_date,
      manager_name: f.manager_name.trim() || null,
      inspector_name: f.inspector_name.trim() || null,
      ordinance: f.ordinance.trim() || null,
      status: f.status,
      notes: f.notes.trim() || null,
      updated_by: props.userId,
    };

    if (props.contrato) {
      const { data: updated, error } = await db
        .from("contracts")
        .update(dadosContrato)
        .eq("tenant_id", props.tenantId)
        .eq("id", props.contrato.id)
        .select("id")
        .maybeSingle();
      setSalvando(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!updated) {
        toast.error("Contrato não encontrado ou sem permissão para atualização.");
        return;
      }
      toast.success("Contrato atualizado. As alterações foram registradas no histórico.");
      props.onFechar();
      props.onSalvo();
      return;
    }

    const { data: createdContract, error } = await db
      .from("contracts")
      .insert({
        tenant_id: props.tenantId,
        ...dadosContrato,
        created_by: props.userId,
      })
      .select("id")
      .single();
    if (error) {
      setSalvando(false);
      toast.error(error.message);
      return;
    }

    let linkedQuotes = 0;
    if (createdContract?.id && f.process_id && f.supplier_id) {
      const { data: processItems, error: itemError } = await db
        .from("procurement_items")
        .select("id")
        .eq("tenant_id", props.tenantId)
        .eq("process_id", f.process_id);
      if (!itemError && processItems?.length) {
        const { data: linked, error: linkError } = await db
          .from("procurement_price_quotes")
          .update({ contract_id: createdContract.id, updated_by: props.userId })
          .eq("tenant_id", props.tenantId)
          .eq("supplier_id", f.supplier_id)
          .eq("selected_for_estimate", true)
          .eq("is_active", true)
          .in(
            "procurement_item_id",
            processItems.map((item) => item.id),
          )
          .is("contract_id", null)
          .select("id");
        if (!linkError) linkedQuotes = linked?.length ?? 0;
        else
          toast.warning(
            "Contrato salvo, mas não foi possível vincular as cotações selecionadas: " +
              linkError.message,
          );
      }
    }
    setSalvando(false);
    toast.success(
      linkedQuotes
        ? "Contrato cadastrado e " + linkedQuotes + " cotação(ões) de referência vinculada(s)."
        : "Contrato cadastrado.",
    );
    props.onFechar();
    props.onSalvo();
  }

  return (
    <Dialog open={props.aberto} onOpenChange={(open) => !open && props.onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.contrato ? "Editar contrato" : "Novo contrato"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <Campo label="Número/ano *">
            <Input
              required
              maxLength={60}
              value={f.number}
              onChange={(e) => set("number")(e.target.value)}
              placeholder="042/2026"
            />
          </Campo>
          <Campo label="Tipo de instrumento">
            <Select value={f.instrument_type} onValueChange={set("instrument_type")}>
              <SelectTrigger aria-label="Tipo de instrumento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contrato">Contrato</SelectItem>
                <SelectItem value="ata_registro_precos">Ata de Registro de Preços (ARP)</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Modalidade">
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
          </Campo>
          <div className="sm:col-span-2">
            <Campo label="Objeto *">
              <Textarea
                required
                minLength={3}
                maxLength={500}
                value={f.object}
                onChange={(e) => set("object")(e.target.value)}
              />
            </Campo>
          </div>
          <Campo label="Processo de contratação">
            <Select
              value={f.process_id || "sem_processo"}
              onValueChange={(value) => set("process_id")(value === "sem_processo" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Vincular a um processo (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sem_processo">Sem processo vinculado</SelectItem>
                {props.processos.map((processo) => (
                  <SelectItem key={processo.id} value={processo.id}>
                    {processo.number} — {processo.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Fornecedor">
            <Select
              value={f.supplier_id || "sem_fornecedor"}
              onValueChange={(value) => set("supplier_id")(value === "sem_fornecedor" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sem_fornecedor">Sem fornecedor vinculado</SelectItem>
                {props.fornecedores.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Valor global (R$)">
            <Input
              inputMode="decimal"
              value={f.total_value}
              disabled={!!props.contrato && props.hasAditivos}
              onChange={(e) => set("total_value")(e.target.value)}
            />
          </Campo>
          <Campo label="Início da vigência *">
            <Input
              type="date"
              required
              value={f.start_date}
              onChange={(e) => set("start_date")(e.target.value)}
            />
          </Campo>
          <Campo label="Fim da vigência *">
            <Input
              type="date"
              required
              value={f.end_date}
              disabled={!!props.contrato && props.hasAditivos}
              onChange={(e) => set("end_date")(e.target.value)}
            />
          </Campo>
          <Campo label="Gestor do contrato">
            <Input
              maxLength={180}
              value={f.manager_name}
              onChange={(e) => set("manager_name")(e.target.value)}
            />
          </Campo>
          <Campo label="Fiscal do contrato">
            <Input
              maxLength={180}
              value={f.inspector_name}
              onChange={(e) => set("inspector_name")(e.target.value)}
            />
          </Campo>
          <Campo label="Portaria de designação">
            <Input
              maxLength={120}
              value={f.ordinance}
              onChange={(e) => set("ordinance")(e.target.value)}
            />
          </Campo>
          {props.contrato && (
            <Campo label="Situação">
              <Select value={f.status} onValueChange={set("status")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vigente">Vigente</SelectItem>
                  <SelectItem value="encerrado">Encerrado</SelectItem>
                  <SelectItem value="rescindido">Rescindido</SelectItem>
                  <SelectItem value="arquivado">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
          )}
          <div className="sm:col-span-2">
            <Campo label="Observações">
              <Textarea
                rows={3}
                maxLength={5000}
                value={f.notes}
                onChange={(e) => set("notes")(e.target.value)}
              />
            </Campo>
          </div>
          {props.contrato && props.hasAditivos && (
            <Alert className="sm:col-span-2">
              <AlertTitle>Contrato com aditivos registrados</AlertTitle>
              <AlertDescription>
                Valor global e fim de vigência são controlados pelo histórico de aditivos. Registre
                essas alterações pelo botão “Registrar aditivo”.
              </AlertDescription>
            </Alert>
          )}
          {props.contrato && (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Fornecedor e processo não podem ser trocados enquanto existirem cotações ou documentos
              vinculados a este contrato. O banco preserva esses vínculos e registra cada alteração.
            </p>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={props.onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {props.contrato ? "Salvar alterações" : "Salvar contrato"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NovoAditivo(props: {
  contrato: Contrato | null;
  onFechar: () => void;
  tenantId: string;
  userId: string;
  onSalvo: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [tipo, setTipo] = useState("prorrogacao");
  const [novaData, setNovaData] = useState("");
  const [valor, setValor] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!props.contrato) return;
    const v = valor.trim() ? numeroDecimal(valor) : 0;
    if (tipo === "prorrogacao") {
      if (!novaData || novaData <= props.contrato.end_date) {
        toast.error("A nova data final deve ser posterior à vigência atual do contrato.");
        return;
      }
    } else if (tipo === "acrescimo" || tipo === "supressao") {
      if (!valor.trim() || !Number.isFinite(v) || v <= 0) {
        toast.error("Informe um valor de aditivo válido e maior que zero.");
        return;
      }
      if (tipo === "supressao" && v > props.contrato.total_value) {
        toast.error("A supressão não pode exceder o valor atual do contrato.");
        return;
      }
    }
    setSalvando(true);
    const { error } = await db.from("contract_amendments").insert({
      tenant_id: props.tenantId,
      contract_id: props.contrato.id,
      number: numero.trim(),
      kind: tipo,
      new_end_date: tipo === "prorrogacao" ? novaData || null : null,
      value_change: tipo === "supressao" ? -Math.abs(v) : tipo === "acrescimo" ? Math.abs(v) : 0,
      notes: observacoes.trim() || null,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Aditivo registrado e contrato atualizado.");
    setNumero("");
    setNovaData("");
    setValor("");
    setObservacoes("");
    props.onFechar();
    props.onSalvo();
  }

  return (
    <Dialog open={!!props.contrato} onOpenChange={(o) => !o && props.onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Termo aditivo — Contrato {props.contrato?.number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={salvar} className="grid gap-4">
          <Campo label="Número do aditivo *">
            <Input
              required
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="1º Termo Aditivo"
            />
          </Campo>
          <Campo label="Tipo">
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prorrogacao">Prorrogação de prazo</SelectItem>
                <SelectItem value="acrescimo">Acréscimo de valor</SelectItem>
                <SelectItem value="supressao">Supressão de valor</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          {tipo === "prorrogacao" && (
            <Campo label="Nova data final *">
              <Input
                type="date"
                required
                value={novaData}
                onChange={(e) => setNovaData(e.target.value)}
              />
            </Campo>
          )}
          {(tipo === "acrescimo" || tipo === "supressao") && (
            <Campo label="Valor (R$) *">
              <Input
                required
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </Campo>
          )}
          <Campo label="Observações e justificativa do aditivo">
            <Textarea
              rows={3}
              maxLength={2000}
              value={observacoes}
              onChange={(event) => setObservacoes(event.target.value)}
              placeholder="Informe a justificativa, referência do processo e observações relevantes."
            />
          </Campo>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
