import { SupplierSelect, type SupplierOption } from "@/components/supplier-select";
import { AssigneeSelect, useAssignees } from "@/components/assignee-select";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  History,
  Pencil,
  Loader2,
  Plus,
  Search,
  ScrollText,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import type { CsvColumn } from "@/lib/csv-export";
import { ContractItemsBalance } from "@/components/contracts/contract-items-balance";
import { RenewalWorkspace } from "@/components/contracts/renewal-workspace";
import { ContractExtensionDialog } from "@/components/contracts/contract-extension-dialog";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  diasAte,
  formatarData,
  formatarMoeda,
  MODALIDADES,
  nivelAlerta,
  selecionarContratosAVencerEm90Dias,
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
  manager_user_id: string | null;
  inspector_name: string | null;
  inspector_user_id: string | null;
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
  manager_user_id: string;
  inspector_name: string;
  inspector_user_id: string;
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
  manager_user_id: "",
  inspector_name: "",
  inspector_user_id: "",
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
  const [fornecedores, setFornecedores] = useState<SupplierOption[]>([]);
  const [processos, setProcessos] = useState<ProcessoOpcao[]>([]);
  const [aditivos, setAditivos] = useState<Aditivo[]>([]);
  const [tenantCarregadoId, setTenantCarregadoId] = useState<string | null>(null);
  const requisicaoRef = useRef(0);
  const [historicosAbertos, setHistoricosAbertos] = useState<Record<string, boolean>>({});
  const [saldoContratoId, setSaldoContratoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [contratoEditando, setContratoEditando] = useState<Contrato | null>(null);
  const [aditivoDe, setAditivoDe] = useState<Contrato | null>(null);
  const [prorrogacaoDe, setProrrogacaoDe] = useState<Contrato | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "alerta" | NivelAlerta>("todos");
  const [aba, setAba] = useState<"contratos" | "aditivos" | "renovacoes">("contratos");
  const [busca, setBusca] = useState("");
  const [tipoAditivo, setTipoAditivo] = useState("todos");
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [buscaContrato, setBuscaContrato] = useState("");

  useEffect(() => {
    setSeletorAberto(false);
    setAditivoDe(null);
    setProrrogacaoDe(null);
    setBusca("");
    setBuscaContrato("");
    setFiltro("todos");
    setTipoAditivo("todos");
  }, [selecionado?.id]);

  const carregar = useCallback(async () => {
    const requisicaoAtual = ++requisicaoRef.current;
    const tenantId = selecionado?.id;

    // Esconde os dados anteriores imediatamente e invalida qualquer resposta atrasada.
    setTenantCarregadoId(null);
    setLista([]);
    setFornecedores([]);
    setProcessos([]);
    setAditivos([]);
    setHistoricosAbertos({});
    setErro(null);
    setPendente(false);

    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [contratosRows, fornecedoresRows, processosRows, aditivosRows] = await Promise.all([
        carregarTodasAsPaginas<Contrato>((inicio, fim) =>
          db
            .from("contracts")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("end_date", { ascending: true })
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("suppliers")
            .select("id,legal_name,trade_name,cnpj,city")
            .eq("tenant_id", tenantId)
            .order("legal_name")
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<ProcessoOpcao>((inicio, fim) =>
          db
            .from("procurement_processes")
            .select("id,number,title")
            .eq("tenant_id", tenantId)
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
            .eq("tenant_id", tenantId)
            .order("signed_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
      ]);

      if (requisicaoAtual !== requisicaoRef.current) return;
      setLista(contratosRows);
      setFornecedores(fornecedoresRows);
      setProcessos(processosRows);
      setAditivos(aditivosRows);
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

  // Abre atalhos do painel e do sino somente após carregar o contexto da Secretaria.
  useEffect(() => {
    if (loading || !selecionado?.id || tenantCarregadoId !== selecionado.id) return;
    const url = new URL(window.location.href);
    const novo = url.searchParams.get("novo");
    const contractId = url.searchParams.get("contrato");
    const novoAditivo = url.searchParams.get("aditivo") === "novo";
    const renovacao = url.searchParams.get("renovacao") === "1";
    if (!novo && !contractId && !renovacao) return;
    if (renovacao) setAba("renovacoes");
    if (novo === "1") {
      setContratoEditando(null);
      setNovoAberto(true);
    }
    if (contractId) {
      const contrato = lista.find((item) => item.id === contractId);
      if (!contrato) {
        toast.error("O contrato solicitado não está disponível nesta Secretaria.");
      } else if (renovacao) {
        setBusca(contrato.number);
      } else if (novoAditivo) {
        setAditivoDe(contrato);
      } else {
        if (url.searchParams.get("saldo") === "1") setSaldoContratoId(contrato.id);
        document.getElementById(`contrato-${contractId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
    url.searchParams.delete("novo");
    url.searchParams.delete("contrato");
    url.searchParams.delete("aditivo");
    url.searchParams.delete("renovacao");
    url.searchParams.delete("saldo");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [loading, selecionado?.id, tenantCarregadoId, lista]);

  const dadosTenantAtual = !!selecionado?.id && tenantCarregadoId === selecionado.id;
  const listaAtual = dadosTenantAtual ? lista : [];
  const fornecedoresAtuais = dadosTenantAtual ? fornecedores : [];
  const processosAtuais = dadosTenantAtual ? processos : [];
  const aditivosAtuais = dadosTenantAtual ? aditivos : [];
  const prorrogacaoContratoId = prorrogacaoDe?.id;
  const aditivosDoContrato = useMemo(
    () =>
      dadosTenantAtual && prorrogacaoContratoId
        ? aditivos.filter((item) => item.contract_id === prorrogacaoContratoId)
        : [],
    [aditivos, dadosTenantAtual, prorrogacaoContratoId],
  );
  const loadingAtual = loading || !dadosTenantAtual;
  const erroAtual = dadosTenantAtual ? erro : null;
  const pendenteAtual = dadosTenantAtual && pendente;

  const comNivel = useMemo(
    () =>
      listaAtual.map((c) => {
        const dias = diasAte(c.end_date);
        return {
          ...c,
          dias,
          nivel: c.status === "vigente" ? nivelAlerta(dias) : ("ok" as const),
        };
      }),
    [listaAtual],
  );
  const contratosAVencer90Dias = useMemo(
    () => selecionarContratosAVencerEm90Dias(listaAtual),
    [listaAtual],
  );
  const contagem = (n: NivelAlerta) => comNivel.filter((c) => c.nivel === n).length;
  const nomeFornecedor = (id: string | null) =>
    fornecedoresAtuais.find((f) => f.id === id)?.legal_name ?? "—";
  const normalizar = (texto: string) =>
    texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const termosBusca = (texto: string, consulta: string) =>
    normalizar(consulta)
      .trim()
      .split(/\s+/)
      .every((termo) => normalizar(texto).includes(termo));
  const textoContrato = (contrato: Contrato) =>
    [
      contrato.number,
      contrato.object,
      nomeFornecedor(contrato.supplier_id),
      contrato.manager_name,
      contrato.inspector_name,
      processosAtuais.find((p) => p.id === contrato.process_id)?.number,
    ]
      .filter(Boolean)
      .join(" ");
  const exibidos = comNivel.filter(
    (c) =>
      (filtro === "todos" || (filtro === "alerta" ? c.nivel !== "ok" : c.nivel === filtro)) &&
      termosBusca(textoContrato(c), busca),
  );
  const colunasRelatorio: CsvColumn<(typeof exibidos)[number]>[] = [
    { header: "Número", value: (contrato) => contrato.number },
    {
      header: "Instrumento",
      value: (contrato) =>
        contrato.instrument_type === "ata_registro_precos"
          ? "Ata de Registro de Preços"
          : "Contrato",
    },
    { header: "Objeto", value: (contrato) => contrato.object },
    { header: "Fornecedor", value: (contrato) => nomeFornecedor(contrato.supplier_id) },
    {
      header: "Modalidade",
      value: (contrato) => MODALIDADES[contrato.modality] ?? contrato.modality,
    },
    { header: "Valor total", value: (contrato) => Number(contrato.total_value) },
    { header: "Início", value: (contrato) => contrato.start_date },
    { header: "Fim", value: (contrato) => contrato.end_date },
    { header: "Dias restantes", value: (contrato) => contrato.dias },
    { header: "Status", value: (contrato) => contrato.status },
  ];
  const nomeProcesso = (id: string | null) => {
    const processo = processosAtuais.find((item) => item.id === id);
    return processo ? `${processo.number} — ${processo.title}` : null;
  };
  const colunasRelatorio90Dias: CsvColumn<(typeof contratosAVencer90Dias)[number]>[] = [
    { header: "Contrato", value: (contrato) => contrato.number },
    {
      header: "Instrumento",
      value: (contrato) =>
        contrato.instrument_type === "ata_registro_precos"
          ? "Ata de Registro de Preços"
          : "Contrato",
    },
    { header: "Objeto", value: (contrato) => contrato.object },
    { header: "Fornecedor", value: (contrato) => nomeFornecedor(contrato.supplier_id) },
    { header: "Processo", value: (contrato) => nomeProcesso(contrato.process_id) ?? "—" },
    {
      header: "Modalidade",
      value: (contrato) => MODALIDADES[contrato.modality] ?? contrato.modality,
    },
    { header: "Valor total", value: (contrato) => Number(contrato.total_value) },
    { header: "Início da vigência", value: (contrato) => formatarData(contrato.start_date) },
    { header: "Fim da vigência", value: (contrato) => formatarData(contrato.end_date) },
    { header: "Dias restantes", value: (contrato) => diasAte(contrato.end_date) },
    { header: "Gestor", value: (contrato) => contrato.manager_name ?? "—" },
    { header: "Fiscal", value: (contrato) => contrato.inspector_name ?? "—" },
    { header: "Portaria", value: (contrato) => contrato.ordinance ?? "—" },
  ];
  const rotuloTipoAditivo: Record<string, string> = {
    prorrogacao: "Prorrogação de prazo",
    acrescimo: "Acréscimo de valor",
    supressao: "Supressão de valor",
    outro: "Outro",
  };
  const aditivosFiltrados = aditivosAtuais.flatMap((item) => {
    const contrato = listaAtual.find((c) => c.id === item.contract_id);
    if (!contrato || (tipoAditivo !== "todos" && item.kind !== tipoAditivo)) return [];
    return termosBusca(
      [item.number, rotuloTipoAditivo[item.kind], item.notes, textoContrato(contrato)]
        .filter(Boolean)
        .join(" "),
      busca,
    )
      ? [{ item, contrato }]
      : [];
  });
  const colunasAditivos: CsvColumn<(typeof aditivosFiltrados)[number]>[] = [
    { header: "Aditivo", value: ({ item }) => item.number },
    { header: "Contrato", value: ({ contrato }) => contrato.number },
    { header: "Fornecedor", value: ({ contrato }) => nomeFornecedor(contrato.supplier_id) },
    { header: "Tipo", value: ({ item }) => rotuloTipoAditivo[item.kind] ?? item.kind },
    { header: "Assinatura", value: ({ item }) => item.signed_at },
    { header: "Nova vigência", value: ({ item }) => item.new_end_date ?? "" },
    { header: "Alteração de valor", value: ({ item }) => Number(item.value_change) },
    { header: "Justificativa", value: ({ item }) => item.notes ?? "" },
  ];

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
            variant="outline"
            onClick={() => {
              setBuscaContrato("");
              setSeletorAberto(true);
            }}
            disabled={pendenteAtual || loadingAtual || !!erroAtual || listaAtual.length === 0}
          >
            <FilePlus2 className="h-4 w-4" /> Novo aditivo
          </Button>
          <ReportExportActions
            title="Contratos e Atas de Registro de Preços"
            filename={`contratos-${new Date().toISOString().slice(0, 10)}.csv`}
            columns={colunasRelatorio}
            rows={exibidos}
            disabled={loadingAtual || pendenteAtual || !!erroAtual}
          />
          <ReportExportActions
            title="Contratos vigentes a vencer nos próximos 90 dias"
            filename={`contratos-a-vencer-90-dias-${new Date().toLocaleDateString("sv-SE")}`}
            columns={colunasRelatorio90Dias}
            rows={contratosAVencer90Dias}
            disabled={loadingAtual || pendenteAtual || !!erroAtual}
          />
          <Button
            onClick={() => {
              setContratoEditando(null);
              setNovoAberto(true);
            }}
            disabled={pendenteAtual || loadingAtual || !!erroAtual}
          >
            <Plus className="h-4 w-4" /> Novo contrato
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button
          variant={aba === "contratos" ? "default" : "ghost"}
          onClick={() => {
            setAba("contratos");
            setBusca("");
          }}
        >
          Contratos e atas ({listaAtual.length})
        </Button>
        <Button
          variant={aba === "aditivos" ? "default" : "ghost"}
          onClick={() => {
            setAba("aditivos");
            setBusca("");
          }}
        >
          <History className="h-4 w-4" /> Central de aditivos ({aditivosAtuais.length})
        </Button>
        <Button
          variant={aba === "renovacoes" ? "default" : "ghost"}
          onClick={() => {
            setAba("renovacoes");
            setBusca("");
          }}
        >
          Central de renovações
        </Button>
      </div>

      <div className="relative max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          aria-label={aba === "aditivos" ? "Pesquisar aditivos" : "Pesquisar contratos"}
          placeholder={
            aba !== "aditivos"
              ? "Número, fornecedor, objeto, processo ou responsável"
              : "Número do aditivo, contrato, fornecedor ou justificativa"
          }
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {pendenteAtual && (
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
      {erroAtual && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erroAtual}</AlertDescription>
        </Alert>
      )}

      {aba === "renovacoes" ? (
        loadingAtual ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <RenewalWorkspace
            key={selecionado.id}
            tenantId={selecionado.id}
            userId={session?.user.id ?? ""}
            contracts={listaAtual.filter((c) => termosBusca(textoContrato(c), busca))}
            supplierName={nomeFornecedor}
            onAmendment={(id) => setAditivoDe(listaAtual.find((c) => c.id === id) ?? null)}
          />
        )
      ) : aba === "contratos" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {(["vencido", "30", "60", "90", "120"] as NivelAlerta[]).map((n) => (
              <Card key={n} className={filtro === n ? "ring-2 ring-primary" : ""}>
                <button
                  type="button"
                  className="w-full text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-pressed={filtro === n}
                  onClick={() => setFiltro(filtro === n ? "todos" : n)}
                >
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{ROTULO_ALERTA[n]}</p>
                    <p className="text-2xl font-semibold">{contagem(n)}</p>
                  </CardContent>
                </button>
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

          {loadingAtual ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : exibidos.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <ScrollText className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">Nenhum contrato para exibir</p>
                <p className="text-sm text-muted-foreground">
                  {listaAtual.length
                    ? "Nenhum contrato corresponde aos filtros. Limpe a pesquisa ou selecione Todos."
                    : "Cadastre o primeiro contrato para acompanhar os vencimentos."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {exibidos.map((c) => (
                <Card key={c.id} id={`contrato-${c.id}`}>
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
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Registrar aditivo — Contrato ${c.number}`}
                        onClick={() => setAditivoDe(c)}
                      >
                        <FilePlus2 className="h-4 w-4" /> Registrar aditivo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                        disabled={
                          c.status !== "vigente" ||
                          c.instrument_type !== "contrato" ||
                          diasAte(c.end_date) <= 0
                        }
                        aria-label={`Prorrogar vigência — Contrato ${c.number}`}
                        title="Disponível apenas para contratos vigentes e não vencidos."
                        onClick={() => setProrrogacaoDe(c)}
                      >
                        <CalendarClock className="h-4 w-4" /> Prorrogar vigência
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
                        Histórico (
                        {aditivosAtuais.filter((item) => item.contract_id === c.id).length})
                        {historicosAbertos[c.id] ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <ContractItemsBalance
                      autoOpen={saldoContratoId === c.id}
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
                        {aditivosAtuais.filter((item) => item.contract_id === c.id).length === 0 ? (
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
                                    {formatarData(item.signed_at)}
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
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Histórico consolidado de aditivos</h2>
              <p className="text-sm text-muted-foreground">
                Consulte alterações formalizadas e os contratos vinculados.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={tipoAditivo} onValueChange={setTipoAditivo}>
                <SelectTrigger className="w-[200px]" aria-label="Tipo de aditivo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  {Object.entries(rotuloTipoAditivo).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ReportExportActions
                title="Relatório de aditivos contratuais"
                filename={`aditivos-${new Date().toISOString().slice(0, 10)}`}
                columns={colunasAditivos}
                rows={aditivosFiltrados}
                disabled={loadingAtual || pendenteAtual || !!erroAtual}
              />
            </div>
          </div>
          {loadingAtual ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : aditivosFiltrados.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {aditivosAtuais.length
                  ? "Nenhum aditivo corresponde aos filtros."
                  : "Nenhum aditivo registrado para esta Secretaria."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {aditivosFiltrados.map(({ item, contrato }) => (
                <Card key={item.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{item.number}</p>
                        <p className="text-sm text-muted-foreground">
                          Contrato {contrato.number} · {nomeFornecedor(contrato.supplier_id)}
                        </p>
                      </div>
                      <Badge variant="outline">{rotuloTipoAditivo[item.kind] ?? item.kind}</Badge>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-3">
                      <span>Assinatura: {formatarData(item.signed_at)}</span>
                      <span>
                        Nova vigência: {item.new_end_date ? formatarData(item.new_end_date) : "—"}
                      </span>
                      <span>Alteração: {formatarMoeda(Number(item.value_change))}</span>
                    </div>
                    {item.notes && (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {item.notes}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAba("contratos");
                        setFiltro("todos");
                        setBusca(contrato.number);
                        setHistoricosAbertos((atual) => ({ ...atual, [contrato.id]: true }));
                      }}
                    >
                      Ver contrato e histórico
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={seletorAberto && dadosTenantAtual} onOpenChange={setSeletorAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selecionar contrato para novo aditivo</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Buscar contrato para aditivo"
            placeholder="Número, fornecedor ou objeto"
            value={buscaContrato}
            onChange={(e) => setBuscaContrato(e.target.value)}
          />
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {listaAtual
              .filter(
                (c) => c.status !== "arquivado" && termosBusca(textoContrato(c), buscaContrato),
              )
              .map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className="w-full rounded-md border p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setSeletorAberto(false);
                    setAditivoDe(c);
                  }}
                >
                  <p className="font-medium">
                    Contrato {c.number} · {nomeFornecedor(c.supplier_id)}
                  </p>
                  <p className="text-sm text-muted-foreground">{c.object}</p>
                  <p className="text-xs text-muted-foreground">
                    Vigência atual: {formatarData(c.end_date)}
                  </p>
                </button>
              ))}
            {!listaAtual.some(
              (c) => c.status !== "arquivado" && termosBusca(textoContrato(c), buscaContrato),
            ) && <p className="p-3 text-sm text-muted-foreground">Nenhum contrato encontrado.</p>}
          </div>
        </DialogContent>
      </Dialog>

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
        fornecedores={fornecedoresAtuais}
        processos={processosAtuais}
        onSalvo={carregar}
      />
      <NovoAditivo
        contrato={aditivoDe}
        onFechar={() => setAditivoDe(null)}
        tenantId={selecionado.id}
        userId={session?.user.id ?? ""}
        onSalvo={carregar}
      />
      <ContractExtensionDialog
        open={!!prorrogacaoDe}
        onOpenChange={(open) => !open && setProrrogacaoDe(null)}
        contrato={prorrogacaoDe}
        supplierName={prorrogacaoDe ? nomeFornecedor(prorrogacaoDe.supplier_id) : undefined}
        aditivosContrato={aditivosDoContrato}
        tenantId={selecionado.id}
        userId={session?.user.id ?? ""}
        onSucesso={() => {
          setProrrogacaoDe(null);
          void carregar();
        }}
        onIrParaRenovacoes={() => {
          if (!prorrogacaoDe) return;
          setProrrogacaoDe(null);
          setAba("renovacoes");
          setBusca(prorrogacaoDe.number);
        }}
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
  fornecedores: SupplierOption[];
  processos: ProcessoOpcao[];
  onSalvo: () => void;
}) {
  const members = useAssignees(props.aberto ? props.tenantId : undefined);
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
            manager_user_id: contrato.manager_user_id ?? "",
            inspector_name: contrato.inspector_name ?? "",
            inspector_user_id: contrato.inspector_user_id ?? "",
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
      ...((f.manager_user_id || props.contrato?.manager_user_id) && {
        manager_user_id: f.manager_user_id || null,
      }),
      inspector_name: f.inspector_name.trim() || null,
      ...((f.inspector_user_id || props.contrato?.inspector_user_id) && {
        inspector_user_id: f.inspector_user_id || null,
      }),
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
            <SupplierSelect
              suppliers={props.fornecedores}
              emptyOption={{ value: "sem_fornecedor", label: "Sem fornecedor vinculado" }}
              value={f.supplier_id || "sem_fornecedor"}
              onValueChange={(value) => set("supplier_id")(value === "sem_fornecedor" ? "" : value)}
            />
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
          <Campo label="Usuário vinculado — Gestor">
            <AssigneeSelect
              label="Gestor"
              members={members}
              value={f.manager_user_id}
              onChange={set("manager_user_id")}
            />
          </Campo>
          <Campo label="Gestor do contrato">
            <Input
              maxLength={180}
              value={f.manager_name}
              onChange={(e) => set("manager_name")(e.target.value)}
            />
          </Campo>
          <Campo label="Usuário vinculado — Fiscal">
            <AssigneeSelect
              label="Fiscal"
              members={members}
              value={f.inspector_user_id}
              onChange={set("inspector_user_id")}
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
  const [dataAssinatura, setDataAssinatura] = useState(() =>
    new Date().toLocaleDateString("sv-SE"),
  );
  const [valor, setValor] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!props.contrato) return;
    setNumero("");
    setTipo("prorrogacao");
    setNovaData("");
    setDataAssinatura(new Date().toLocaleDateString("sv-SE"));
    setValor("");
    setObservacoes("");
  }, [props.contrato]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!props.contrato) return;
    if (!props.userId) {
      toast.error("Não foi possível identificar o usuário da sessão.");
      return;
    }
    if (!numero.trim()) {
      toast.error("Informe o número do termo aditivo.");
      return;
    }
    if (!dataAssinatura || dataAssinatura > new Date().toLocaleDateString("sv-SE")) {
      toast.error("Informe uma data de assinatura válida, não futura.");
      return;
    }
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
      signed_at: dataAssinatura,
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
    setDataAssinatura(new Date().toLocaleDateString("sv-SE"));
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
          {props.contrato && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                Valor vigente: <strong>{formatarMoeda(Number(props.contrato.total_value))}</strong>
              </p>
              <p>
                Fim da vigência: <strong>{formatarData(props.contrato.end_date)}</strong>
              </p>
              {(tipo === "acrescimo" || tipo === "supressao") &&
                Number.isFinite(numeroDecimal(valor)) &&
                numeroDecimal(valor) > 0 && (
                  <p>
                    Valor após a alteração (prévia):{" "}
                    <strong>
                      {formatarMoeda(
                        Number(props.contrato.total_value) +
                          (tipo === "supressao" ? -1 : 1) * numeroDecimal(valor),
                      )}
                    </strong>
                  </p>
                )}
            </div>
          )}
          <Campo label="Número do aditivo *">
            <Input
              required
              maxLength={80}
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
          <Campo label="Data da assinatura *">
            <Input
              type="date"
              required
              max={new Date().toLocaleDateString("sv-SE")}
              value={dataAssinatura}
              onChange={(event) => setDataAssinatura(event.target.value)}
            />
          </Campo>
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
