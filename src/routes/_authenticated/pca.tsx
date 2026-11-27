import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  FilePlus2,
  Filter,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PncpExportDialog } from "@/components/procurement/pncp-export-dialog";
import { useTenant } from "@/hooks/use-tenant";
import { isCommercialModuleEnabled } from "@/lib/commercial-access";
import { ETAPAS, formatarData, formatarMoeda, MODALIDADES } from "@/lib/contratacao";
import { bancoNaoConfigurado, carregarTodasAsPaginas, db } from "@/lib/db";
import {
  avaliarCronogramaPca,
  consolidarDemandasPCA,
  type DemandaPCARow,
  type ItemConsolidadoPCA,
} from "@/lib/pca-consolidation-helper";
import { exportarXlsx } from "@/lib/xlsx-export";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/pca")({
  head: () => ({ meta: [{ title: "Plano de Contratações Anual (PCA) — Primus Gestão" }] }),
  component: PcaPage,
});

interface DemandCapabilities {
  can_create?: boolean;
  can_approve?: boolean;
  can_view?: boolean;
}

type ItemFormDraft = {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  estimated_unit_price: string;
  catmat_code: string;
};

type DemandaFormState = {
  title: string;
  justification: string;
  requesting_unit: string;
  responsible_name: string;
  category: "bens" | "servicos" | "obras" | "tic" | "outro";
  priority: "urgente" | "alta" | "normal" | "baixa";
  desired_date: string;
  items: ItemFormDraft[];
};

const CATEGORIAS_PCA = {
  bens: "Bens e Materiais / Insumos",
  servicos: "Serviços Continuados / Comuns",
  obras: "Obras e Serviços de Engenharia",
  tic: "Tecnologia da Informação e Comunicação",
  outro: "Outro",
} as const;

const PRIORIDADES_PCA = {
  urgente: "Urgente",
  alta: "Alta",
  normal: "Normal",
  baixa: "Baixa",
} as const;

function novoItemRascunho(): ItemFormDraft {
  return {
    key: crypto.randomUUID(),
    description: "",
    unit: "",
    quantity: "",
    estimated_unit_price: "",
    catmat_code: "",
  };
}

function emptyDemandForm(): DemandaFormState {
  return {
    title: "",
    justification: "",
    requesting_unit: "",
    responsible_name: "",
    category: "bens",
    priority: "normal",
    desired_date: "",
    items: [novoItemRascunho()],
  };
}

function resolveStatus(d: DemandaPCARow): "submitted" | "approved" | "rejected" | "cancelled" | "converted" {
  if (d.process_id || d.review_status === "converted") return "converted";
  if (d.review_status === "cancelled") return "cancelled";
  if (d.review_status === "rejected") return "rejected";
  if (d.approved_at || d.review_status === "approved") return "approved";
  return "submitted";
}

function PcaPage() {
  const { selecionado } = useTenant();
  const tenantId = selecionado?.id;

  const moduloPca = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "pca")
    : false;
  const moduloProcessos = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "processos")
    : false;

  const [year, setYear] = useState(new Date().getFullYear());
  const [demandas, setDemandas] = useState<DemandaPCARow[]>([]);
  const [processosVinculados, setProcessosVinculados] = useState<
    Record<string, { number: string; stage: string; status: string }>
  >({});
  const [capabilities, setCapabilities] = useState<DemandCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros e consolidação
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todas");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [somenteAprovadas, setSomenteAprovadas] = useState(false);

  // Modal de nova / edição de demanda
  const [formAberto, setFormAberto] = useState(false);
  const [editandoDemanda, setEditandoDemanda] = useState<DemandaPCARow | null>(null);
  const [formState, setFormState] = useState<DemandaFormState>(emptyDemandForm);

  // Modais de workflow
  const [convertendoDemanda, setConvertendoDemanda] = useState<DemandaPCARow | null>(null);
  const [numeroProcesso, setNumeroProcesso] = useState("");
  const [modalidadeProcesso, setModalidadeProcesso] = useState("");

  const [devolvendoDemanda, setDevolvendoDemanda] = useState<DemandaPCARow | null>(null);
  const [motivoDevolucao, setMotivoDevolucao] = useState("");

  const [cancelandoDemanda, setCancelandoDemanda] = useState<DemandaPCARow | null>(null);

  const requisicaoRef = useRef(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    setFormAberto(false);
    setEditandoDemanda(null);
    setConvertendoDemanda(null);
    setDevolvendoDemanda(null);
    setCancelandoDemanda(null);
    setFormState(emptyDemandForm());
  }, [tenantId, year]);

  const carregarDados = useCallback(async () => {
    const req = ++requisicaoRef.current;

    if (!tenantId || !moduloPca) {
      setDemandas([]);
      setCapabilities(null);
      setErro(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErro(null);
      const [demandsRows, capsRes] = await Promise.all([
        carregarTodasAsPaginas<DemandaPCARow>((from, to) =>
          db
            .from("annual_procurement_demands")
            .select(
              "id,plan_year,title,justification,approved_at,process_id,items,submitted_at,requesting_unit,responsible_name,estimated_total_value,desired_date,priority,category,review_status,rejection_reason",
            )
            .eq("tenant_id", tenantId)
            .eq("plan_year", year)
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        ),
        db.rpc("annual_demand_capabilities", { p_tenant_id: tenantId }),
      ]);

      if (req !== requisicaoRef.current) return;
      if (capsRes.error) throw new Error(capsRes.error.message);

      setDemandas(demandsRows);
      setCapabilities((capsRes.data?.[0] as DemandCapabilities) ?? null);

      const processIds = Array.from(
        new Set(
          demandsRows
            .map((d) => d.process_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (processIds.length > 0) {
        const { data: procData } = await db
          .from("procurement_processes")
          .select("id,number,stage,status")
          .eq("tenant_id", tenantId)
          .in("id", processIds);
        if (req === requisicaoRef.current && procData) {
          const map: Record<string, { number: string; stage: string; status: string }> = {};
          for (const p of procData) {
            map[p.id] = { number: p.number, stage: p.stage, status: p.status };
          }
          setProcessosVinculados(map);
        }
      } else {
        setProcessosVinculados({});
      }
    } catch (error) {
      if (req !== requisicaoRef.current) return;
      const msg = error instanceof Error ? error.message : "Erro ao consultar o PCA.";
      setDemandas([]);
      setErro(bancoNaoConfigurado(msg) ? "PCA pendente de implantação nesta base." : msg);
      toast.error("Falha ao carregar PCA", { description: msg });
    } finally {
      if (req === requisicaoRef.current) setLoading(false);
    }
  }, [tenantId, year, moduloPca]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  const resumoGeral = useMemo(
    () => consolidarDemandasPCA(demandas, { somenteAprovadas, excluirInativas: true }),
    [demandas, somenteAprovadas],
  );
  const resumoOficialPncp = useMemo(
    () => consolidarDemandasPCA(demandas, { somenteAprovadas: true, excluirInativas: true }),
    [demandas],
  );
  const cronograma = useMemo(() => avaliarCronogramaPca(year), [year]);

  const demandasFiltradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return demandas.filter((d) => {
      const status = resolveStatus(d);
      if (filtroStatus !== "todas" && status !== filtroStatus) return false;
      if (filtroCategoria !== "todas" && (d.category || "bens") !== filtroCategoria) return false;
      if (!termo) return true;
      return [d.title, d.justification, d.requesting_unit, d.responsible_name]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase("pt-BR").includes(termo));
    });
  }, [demandas, busca, filtroStatus, filtroCategoria]);

  async function executarAcao(
    action: "submit" | "update" | "approve" | "reject" | "cancel" | "convert",
    id: string,
    data: Json,
  ) {
    if (!tenantId || submittingRef.current) return false;
    submittingRef.current = true;
    setBusy(true);
    try {
      const result = await db.rpc("manage_annual_demand", {
        p_tenant_id: tenantId,
        p_action: action,
        p_id: id,
        p_data: data,
      });
      if (result.error) throw new Error(result.error.message);

      const messages: Record<typeof action, string> = {
        submit: "Demanda enviada para aprovação.",
        update: "Demanda atualizada e reenviada para análise.",
        approve: "Demanda aprovada para compra.",
        reject: "Demanda devolvida para ajuste da unidade solicitante.",
        cancel: "Demanda cancelada no exercício.",
        convert: "Processo criado com os itens do PCA.",
      };
      toast.success(messages[action]);
      await carregarDados();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gravar a demanda.");
      return false;
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function abrirNovaDemanda() {
    setEditandoDemanda(null);
    setFormState(emptyDemandForm());
    setFormAberto(true);
  }

  function abrirEdicaoDemanda(demand: DemandaPCARow) {
    const rawItems = Array.isArray(demand.items) ? demand.items : [];
    const parsedItems: ItemFormDraft[] = rawItems
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => ({
        key: crypto.randomUUID(),
        description: String(item["description"] ?? ""),
        unit: String(item["unit"] ?? ""),
        quantity: String(item["quantity"] ?? ""),
        estimated_unit_price:
          item["estimated_unit_price"] != null ? String(item["estimated_unit_price"]) : "",
        catmat_code: item["catmat_code"] != null ? String(item["catmat_code"]) : "",
      }));

    setEditandoDemanda(demand);
    setFormState({
      title: demand.title,
      justification: demand.justification,
      requesting_unit: demand.requesting_unit ?? "",
      responsible_name: demand.responsible_name ?? "",
      category: (demand.category as DemandaFormState["category"]) || "bens",
      priority: (demand.priority as DemandaFormState["priority"]) || "normal",
      desired_date: demand.desired_date ?? "",
      items: parsedItems.length > 0 ? parsedItems : [novoItemRascunho()],
    });
    setFormAberto(true);
  }

  async function handleSalvarDemanda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanItems = formState.items.map((item) => {
      const qty = Number(item.quantity);
      const priceText = item.estimated_unit_price.trim();
      const catmatText = item.catmat_code.trim();
      return {
        description: item.description.trim(),
        unit: item.unit.trim(),
        quantity: qty,
        ...(priceText !== "" ? { estimated_unit_price: Number(priceText) } : {}),
        ...(catmatText !== "" ? { catmat_code: catmatText } : {}),
      };
    });

    const payload: Json = {
      year,
      title: formState.title.trim(),
      justification: formState.justification.trim(),
      requesting_unit: formState.requesting_unit.trim(),
      responsible_name: formState.responsible_name.trim(),
      category: formState.category,
      priority: formState.priority,
      desired_date: formState.desired_date || null,
      items: cleanItems,
    };

    const ok = editandoDemanda
      ? await executarAcao("update", editandoDemanda.id, payload)
      : await executarAcao("submit", crypto.randomUUID(), payload);

    if (ok) {
      setFormAberto(false);
      setEditandoDemanda(null);
      setFormState(emptyDemandForm());
    }
  }

  async function handleConverterDemanda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!convertendoDemanda || !numeroProcesso.trim() || !modalidadeProcesso) return;

    const ok = await executarAcao("convert", convertendoDemanda.id, {
      number: numeroProcesso.trim(),
      modality: modalidadeProcesso,
    });

    if (ok) {
      setConvertendoDemanda(null);
      setNumeroProcesso("");
      setModalidadeProcesso("");
    }
  }

  async function handleDevolverDemanda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!devolvendoDemanda || motivoDevolucao.trim().length < 10) {
      toast.error("Informe o motivo da devolução com pelo menos 10 caracteres.");
      return;
    }

    const ok = await executarAcao("reject", devolvendoDemanda.id, {
      reason: motivoDevolucao.trim(),
    });

    if (ok) {
      setDevolvendoDemanda(null);
      setMotivoDevolucao("");
    }
  }

  async function handleExportarConsolidadoXlsx() {
    try {
      const columns = [
        { header: "Descrição do Item", value: (r: ItemConsolidadoPCA) => r.descricaoOriginal },
        { header: "Unidade", value: (r: ItemConsolidadoPCA) => r.unidade },
        {
          header: "Quantidade Total Consolidada",
          value: (r: ItemConsolidadoPCA) => r.quantidadeTotal,
        },
        {
          header: "Valor Estimado Total (R$)",
          value: (r: ItemConsolidadoPCA) => Number(r.valorEstimadoTotal.toFixed(2)),
        },
        {
          header: "Demandas / Unidades Solicitantes",
          value: (r: ItemConsolidadoPCA) => r.totalDemandasOrigem,
        },
      ];

      await exportarXlsx(`pca-consolidado-${year}`, columns, resumoGeral.itensConsolidados);
      toast.success("Quadro consolidado do PCA exportado em XLSX!");
    } catch (error) {
      toast.error("Erro ao exportar XLSX", {
        description: error instanceof Error ? error.message : "Falha desconhecida",
      });
    }
  }

  async function handleExportarDemandasXlsx() {
    try {
      const statusText: Record<string, string> = {
        submitted: "Aguardando aprovação",
        approved: "Aprovada",
        rejected: "Devolvida",
        cancelled: "Cancelada",
        converted: "Convertida em processo",
      };
      const columns = [
        { header: "Objeto", value: (d: DemandaPCARow) => d.title },
        { header: "Unidade Solicitante", value: (d: DemandaPCARow) => d.requesting_unit ?? "—" },
        { header: "Responsável", value: (d: DemandaPCARow) => d.responsible_name ?? "—" },
        {
          header: "Categoria",
          value: (d: DemandaPCARow) =>
            CATEGORIAS_PCA[(d.category as keyof typeof CATEGORIAS_PCA) ?? "bens"] ?? "Bens",
        },
        {
          header: "Prioridade",
          value: (d: DemandaPCARow) =>
            PRIORIDADES_PCA[(d.priority as keyof typeof PRIORIDADES_PCA) ?? "normal"] ?? "Normal",
        },
        {
          header: "Previsão Desejada",
          value: (d: DemandaPCARow) => (d.desired_date ? formatarData(d.desired_date) : "—"),
        },
        {
          header: "Valor Estimado (R$)",
          value: (d: DemandaPCARow) => Number(d.estimated_total_value ?? 0),
        },
        { header: "Situação", value: (d: DemandaPCARow) => statusText[resolveStatus(d)] ?? "—" },
      ];

      await exportarXlsx(`pca-demandas-${year}`, columns, demandasFiltradas);
      toast.success("Lista de demandas do PCA exportada em XLSX!");
    } catch (error) {
      toast.error("Erro ao exportar XLSX", {
        description: error instanceof Error ? error.message : "Falha desconhecida",
      });
    }
  }

  const anosDisponiveis = Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i);

  if (!selecionado) {
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>O Plano de Contratações Anual é isolado por Secretaria.</AlertDescription>
      </Alert>
    );
  }

  if (!moduloPca) {
    return (
      <Alert>
        <AlertTitle>Módulo PCA indisponível</AlertTitle>
        <AlertDescription>
          Habilite o módulo Plano de Contratações Anual nas configurações do plano de{" "}
          {selecionado.nome}.
        </AlertDescription>
      </Alert>
    );
  }

  if (capabilities && capabilities.can_view === false) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Acesso restrito ao PCA</AlertTitle>
        <AlertDescription>
          Seu perfil nesta Secretaria não possui permissão para consultar o Plano de Contratações
          Anual.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Plano de Contratações Anual (PCA)</h1>
            {capabilities && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                {capabilities.can_approve
                  ? "Aprovação e Gestão Habilitadas"
                  : capabilities.can_create
                    ? "Envio de Demandas Habilitado"
                    : "Somente Leitura"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Formalização de DFD, consolidação em escala e publicação no PNCP conforme Lei nº
            14.133/2021 e Decreto nº 10.947/2022.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <CalendarClock className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Exercício" />
            </SelectTrigger>
            <SelectContent>
              {anosDisponiveis.map((ano) => (
                <SelectItem key={ano} value={String(ano)}>
                  Exercício {ano}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void carregarDados()}
            disabled={loading || busy}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          <PncpExportDialog
            kind="pca"
            tenantId={selecionado.id}
            tenantName={selecionado.nome}
            triggerLabel="Exportar PCA (PNCP)"
            pca={{
              year,
              totalDemands: resumoOficialPncp.totalDemandas - resumoOficialPncp.demandasCanceladas,
              approvedDemands:
                resumoOficialPncp.demandasAprovadas + resumoOficialPncp.demandasConvertidas,
              items: resumoOficialPncp.itensConsolidados.map((item) => ({
                description: item.descricaoOriginal,
                unit: item.unidade,
                totalQuantity: item.quantidadeTotal,
                sourceDemandsCount: item.totalDemandasOrigem,
                valorEstimadoTotal: item.valorEstimadoTotal,
              })),
            }}
          />

          {capabilities?.can_create && (
            <Button size="sm" onClick={abrirNovaDemanda} disabled={busy}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Nova Demanda
            </Button>
          )}
        </div>
      </div>

      {/* Cronograma Decreto 10.947/2022 */}
      <Alert
        variant={cronograma.status === "atrasado" ? "destructive" : "default"}
        className="border-primary/20 bg-primary/5"
      >
        <CalendarClock className="h-4 w-4" aria-hidden />
        <AlertTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span>{cronograma.titulo}</span>
          <Badge variant="outline" className="text-[11px]">
            {cronograma.fase}
          </Badge>
        </AlertTitle>
        <AlertDescription className="text-xs">{cronograma.descricao}</AlertDescription>
      </Alert>

      {/* Cards de Indicadores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Demandas no Exercício
            </CardTitle>
            <Layers className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{resumoGeral.totalDemandas}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {resumoGeral.demandasDevolvidas > 0
                ? `${resumoGeral.demandasDevolvidas} devolvida(s) · `
                : ""}
              exercício {year}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Aguardando Aprovação
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {resumoGeral.demandasAguardando}
            </div>
            <p className="text-xs text-muted-foreground mt-1">em análise da gestão</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Aprovadas / Vinculadas
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {resumoGeral.demandasAprovadas + resumoGeral.demandasConvertidas}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {resumoGeral.demandasConvertidas} convertida(s) em processo
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Valor Estimado (PCA)
            </CardTitle>
            <FilePlus2 className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              {formatarMoeda(resumoGeral.valorTotalEstimado)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Aprovado: {formatarMoeda(resumoGeral.valorTotalAprovado)}
            </p>
          </CardContent>
        </Card>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Erro ao carregar PCA</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/* Abas Principais */}
      <Tabs defaultValue="demandas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="demandas">Demandas Cadastradas ({demandasFiltradas.length})</TabsTrigger>
          <TabsTrigger value="consolidado">
            Quadro Consolidado de Itens ({resumoGeral.itensConsolidados.length})
          </TabsTrigger>
        </TabsList>

        {/* Aba 1: Demandas Cadastradas */}
        <TabsContent value="demandas" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3">
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              <div className="relative">
                <Filter className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar objeto, unidade, responsável…"
                  className="h-9 pl-8 text-xs"
                />
              </div>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as situações</SelectItem>
                  <SelectItem value="submitted">Aguardando aprovação</SelectItem>
                  <SelectItem value="approved">Aprovada</SelectItem>
                  <SelectItem value="rejected">Devolvida p/ ajuste</SelectItem>
                  <SelectItem value="converted">Convertida em processo</SelectItem>
                  <SelectItem value="cancelled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as categorias</SelectItem>
                  {Object.entries(CATEGORIAS_PCA).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportarDemandasXlsx}
              disabled={demandasFiltradas.length === 0}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Exportar Demandas (.xlsx)
            </Button>
          </div>

          {loading ? (
            <div className="py-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando demandas do PCA {year}…
            </div>
          ) : demandasFiltradas.length === 0 ? (
            <Card className="border-dashed py-12 text-center">
              <CardContent className="space-y-2">
                <p className="font-medium text-sm">
                  Nenhuma demanda encontrada para os filtros aplicados no exercício {year}.
                </p>
                <p className="text-xs text-muted-foreground">
                  As unidades podem registrar suas necessidades anuais clicando em "Nova Demanda".
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {demandasFiltradas.map((demand) => {
                const itemsList = Array.isArray(demand.items) ? demand.items : [];
                const status = resolveStatus(demand);
                const editable =
                  capabilities?.can_create && (status === "submitted" || status === "rejected");
                return (
                  <Card key={demand.id} className="border-border shadow-xs">
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">{demand.title}</CardTitle>
                            <Badge variant="outline" className="text-[11px]">
                              {CATEGORIAS_PCA[(demand.category as keyof typeof CATEGORIAS_PCA) ?? "bens"] ??
                                "Bens"}
                            </Badge>
                            {demand.priority && demand.priority !== "normal" && (
                              <Badge variant="outline" className="text-[11px]">
                                Prioridade:{" "}
                                {PRIORIDADES_PCA[demand.priority as keyof typeof PRIORIDADES_PCA] ??
                                  demand.priority}
                              </Badge>
                            )}
                          </div>
                          <CardDescription className="text-xs">
                            Enviada em {formatarData(demand.submitted_at)} · {itemsList.length}{" "}
                            item(ns)
                            {demand.requesting_unit ? ` · Unidade: ${demand.requesting_unit}` : ""}
                            {demand.responsible_name
                              ? ` · Responsável: ${demand.responsible_name}`
                              : ""}
                            {demand.desired_date
                              ? ` · Prev. contratação: ${formatarData(demand.desired_date)}`
                              : ""}
                            {demand.estimated_total_value != null
                              ? ` · Valor est.: ${formatarMoeda(demand.estimated_total_value)}`
                              : ""}
                          </CardDescription>
                        </div>
                        <Badge
                          variant={
                            status === "converted"
                              ? "default"
                              : status === "approved"
                                ? "secondary"
                                : status === "rejected" || status === "cancelled"
                                  ? "destructive"
                                  : "outline"
                          }
                        >
                          {status === "converted"
                            ? "Processo vinculado"
                            : status === "approved"
                              ? "Demanda aprovada"
                              : status === "rejected"
                                ? "Devolvida p/ ajuste"
                                : status === "cancelled"
                                  ? "Cancelada"
                                  : "Aguardando aprovação"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground">{demand.justification}</p>

                      {status === "rejected" && demand.rejection_reason && (
                        <Alert variant="destructive" className="py-2">
                          <AlertTitle className="text-xs">Motivo da devolução</AlertTitle>
                          <AlertDescription className="text-xs">
                            {demand.rejection_reason}
                          </AlertDescription>
                        </Alert>
                      )}

                      {itemsList.length > 0 && (
                        <div className="rounded-md border bg-muted/20 p-3">
                          <ul className="space-y-1 text-xs">
                            {itemsList.map(
                              (item, idx) =>
                                item &&
                                typeof item === "object" &&
                                !Array.isArray(item) && (
                                  <li key={idx} className="flex items-center justify-between gap-2">
                                    <span className="truncate">
                                      {String((item as Record<string, unknown>)["description"])}
                                      {(item as Record<string, unknown>)["catmat_code"]
                                        ? ` (CATMAT/CATSER: ${String((item as Record<string, unknown>)["catmat_code"])})`
                                        : ""}
                                    </span>
                                    <span className="font-semibold tabular-nums shrink-0">
                                      {String((item as Record<string, unknown>)["quantity"])}{" "}
                                      {String((item as Record<string, unknown>)["unit"])}
                                      {(item as Record<string, unknown>)["estimated_unit_price"] !=
                                      null
                                        ? ` × ${formatarMoeda(Number((item as Record<string, unknown>)["estimated_unit_price"]))}`
                                        : ""}
                                    </span>
                                  </li>
                                ),
                            )}
                          </ul>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {editable && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => abrirEdicaoDemanda(demand)}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1.5" />
                            Editar demanda
                          </Button>
                        )}

                        {status === "submitted" && capabilities?.can_approve && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void executarAcao("approve", demand.id, {})}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                              Aprovar demanda
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setDevolvendoDemanda(demand);
                                setMotivoDevolucao("");
                              }}
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                              Devolver
                            </Button>
                          </>
                        )}

                        {status === "approved" && capabilities?.can_approve && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setDevolvendoDemanda(demand);
                              setMotivoDevolucao("");
                            }}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                            Devolver para ajuste
                          </Button>
                        )}

                        {status !== "converted" &&
                          status !== "cancelled" &&
                          capabilities?.can_create && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() => setCancelandoDemanda(demand)}
                            >
                              <Ban className="w-3.5 h-3.5 mr-1.5" />
                              Cancelar demanda
                            </Button>
                          )}

                        {status === "approved" &&
                          capabilities?.can_create &&
                          moduloProcessos && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setConvertendoDemanda(demand);
                                setNumeroProcesso("");
                                setModalidadeProcesso("");
                              }}
                            >
                              <FilePlus2 className="w-3.5 h-3.5 mr-1.5" />
                              Criar processo desta demanda
                            </Button>
                          )}

                        {demand.process_id && (
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const proc = processosVinculados[demand.process_id];
                              if (!proc) return null;
                              const etapaNome =
                                proc.status === "concluido"
                                  ? "Concluído"
                                  : (ETAPAS.find((e) => e.id === proc.stage)?.nome ?? proc.stage);
                              return (
                                <Badge variant="secondary" className="text-[11px] font-normal">
                                  Proc. {proc.number} · {etapaNome}
                                </Badge>
                              );
                            })()}
                            <Button variant="link" size="sm" asChild className="px-0 h-auto">
                              <Link
                                to="/processos"
                                search={{ processo: demand.process_id } as never}
                                className="text-xs flex items-center gap-1"
                              >
                                Abrir processo vinculado <ArrowUpRight className="w-3.5 h-3.5" />
                              </Link>
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Aba 2: Quadro Consolidado de Itens */}
        <TabsContent value="consolidado" className="space-y-4">
          <Card className="border-border shadow-xs">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Quadro Consolidado de Itens para Compra em Escala
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Agrupamento automático de itens solicitados no exercício {year} (exclui demandas
                    devolvidas ou canceladas).
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <Checkbox
                      checked={somenteAprovadas}
                      onCheckedChange={(checked) => setSomenteAprovadas(checked === true)}
                    />
                    Somente demandas aprovadas
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportarConsolidadoXlsx}
                    disabled={resumoGeral.itensConsolidados.length === 0}
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Exportar XLSX
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {resumoGeral.itensConsolidados.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum item consolidado disponível para os critérios selecionados no exercício{" "}
                  {year}.
                </div>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Descrição do Item</TableHead>
                        <TableHead className="w-[110px]">Unidade</TableHead>
                        <TableHead className="w-[150px] text-right">
                          Qtd. Consolidada
                        </TableHead>
                        <TableHead className="w-[150px] text-right">
                          Valor Estimado
                        </TableHead>
                        <TableHead className="w-[150px] text-right">
                          Unidades / Demandas
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumoGeral.itensConsolidados.map((item) => (
                        <TableRow key={`${item.descricaoNormalizada}__${item.unidade}`}>
                          <TableCell className="font-medium text-xs">
                            {item.descricaoOriginal}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[11px]">
                              {item.unidade}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-xs tabular-nums text-primary">
                            {item.quantidadeTotal.toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {item.valorEstimadoTotal > 0
                              ? formatarMoeda(item.valorEstimadoTotal)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                            {item.totalDemandasOrigem} demanda(s)
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal: Nova / Editar Demanda PCA */}
      <Dialog
        open={formAberto}
        onOpenChange={(open) => {
          if (!busy) {
            setFormAberto(open);
            if (!open) {
              setEditandoDemanda(null);
              setFormState(emptyDemandForm());
            }
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editandoDemanda
                ? `Editar Demanda no PCA ${year}`
                : `Registrar Nova Demanda no PCA ${year}`}
            </DialogTitle>
            <DialogDescription>
              Dados mínimos do DFD/PCA conforme art. 8º do Decreto nº 10.947/2022.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSalvarDemanda} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pca-title" className="text-xs">
                  Objeto da Demanda *
                </Label>
                <Input
                  id="pca-title"
                  value={formState.title}
                  onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                  required
                  minLength={3}
                  maxLength={300}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pca-unit" className="text-xs">
                  Unidade Requisitante / Setor
                </Label>
                <Input
                  id="pca-unit"
                  value={formState.requesting_unit}
                  onChange={(e) => setFormState({ ...formState, requesting_unit: e.target.value })}
                  maxLength={180}
                  placeholder="Ex: Coordenação de Atenção Básica"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pca-resp" className="text-xs">
                  Responsável pela Demanda
                </Label>
                <Input
                  id="pca-resp"
                  value={formState.responsible_name}
                  onChange={(e) =>
                    setFormState({ ...formState, responsible_name: e.target.value })
                  }
                  maxLength={180}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Categoria do Objeto</Label>
                <Select
                  value={formState.category}
                  onValueChange={(v) =>
                    setFormState({ ...formState, category: v as DemandaFormState["category"] })
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORIAS_PCA).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Prioridade</Label>
                  <Select
                    value={formState.priority}
                    onValueChange={(v) =>
                      setFormState({ ...formState, priority: v as DemandaFormState["priority"] })
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORIDADES_PCA).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pca-desired-date" className="text-xs">
                    Previsão da Contratação
                  </Label>
                  <Input
                    id="pca-desired-date"
                    type="date"
                    value={formState.desired_date}
                    onChange={(e) => setFormState({ ...formState, desired_date: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pca-justification" className="text-xs">
                Justificativa da Necessidade *
              </Label>
              <Textarea
                id="pca-justification"
                value={formState.justification}
                onChange={(e) => setFormState({ ...formState, justification: e.target.value })}
                required
                minLength={3}
                maxLength={5000}
                rows={3}
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Itens da Demanda</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || formState.items.length >= 200}
                  onClick={() =>
                    setFormState({ ...formState, items: [...formState.items, novoItemRascunho()] })
                  }
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar item
                </Button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {formState.items.map((item, idx) => (
                  <div
                    key={item.key}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-12 items-end bg-muted/20"
                  >
                    <div className="sm:col-span-4 space-y-1">
                      <Label className="text-[11px]">Descrição (Item {idx + 1}) *</Label>
                      <Input
                        value={item.description}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            items: formState.items.map((row) =>
                              row.key === item.key ? { ...row, description: e.target.value } : row,
                            ),
                          })
                        }
                        required
                        minLength={3}
                        maxLength={500}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <Label className="text-[11px]">Unidade *</Label>
                      <Input
                        value={item.unit}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            items: formState.items.map((row) =>
                              row.key === item.key ? { ...row, unit: e.target.value } : row,
                            ),
                          })
                        }
                        required
                        minLength={1}
                        maxLength={30}
                        placeholder="UN/CX"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <Label className="text-[11px]">Qtd. *</Label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            items: formState.items.map((row) =>
                              row.key === item.key ? { ...row, quantity: e.target.value } : row,
                            ),
                          })
                        }
                        required
                        min="0.0001"
                        step="0.0001"
                        max="9999999999.9999"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <Label className="text-[11px]">Valor Unit. Est.</Label>
                      <Input
                        type="number"
                        value={item.estimated_unit_price}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            items: formState.items.map((row) =>
                              row.key === item.key
                                ? { ...row, estimated_unit_price: e.target.value }
                                : row,
                            ),
                          })
                        }
                        min="0"
                        step="0.0001"
                        max="9999999999"
                        placeholder="Opcional"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-1 space-y-1">
                      <Label className="text-[11px]">CATMAT</Label>
                      <Input
                        value={item.catmat_code}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            items: formState.items.map((row) =>
                              row.key === item.key ? { ...row, catmat_code: e.target.value } : row,
                            ),
                          })
                        }
                        maxLength={30}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      {formState.items.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() =>
                            setFormState({
                              ...formState,
                              items: formState.items.filter((row) => row.key !== item.key),
                            })
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFormAberto(false);
                  setEditandoDemanda(null);
                  setFormState(emptyDemandForm());
                }}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy
                  ? "Salvando..."
                  : editandoDemanda
                    ? "Salvar Alterações"
                    : "Enviar Demanda para Aprovação"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Converter Demanda em Processo */}
      <Dialog open={!!convertendoDemanda} onOpenChange={(o) => !o && !busy && setConvertendoDemanda(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Criar Processo a partir do PCA</DialogTitle>
            <DialogDescription>
              Converter a demanda aprovada "{convertendoDemanda?.title}" em um novo processo de
              contratação e DFD.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConverterDemanda} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="proc-number" className="text-xs">
                Número do Processo *
              </Label>
              <Input
                id="proc-number"
                value={numeroProcesso}
                onChange={(e) => setNumeroProcesso(e.target.value)}
                required
                minLength={1}
                maxLength={60}
                placeholder="Ex: PROC-045/2026"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-modality" className="text-xs">
                Modalidade *
              </Label>
              <Select value={modalidadeProcesso} onValueChange={setModalidadeProcesso} required>
                <SelectTrigger id="proc-modality" className="text-xs">
                  <SelectValue placeholder="Selecione a modalidade" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MODALIDADES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConvertendoDemanda(null)}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !numeroProcesso.trim() || !modalidadeProcesso}
              >
                {busy ? "Criando..." : "Criar Processo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Devolver Demanda para Ajuste */}
      <Dialog open={!!devolvendoDemanda} onOpenChange={(o) => !o && !busy && setDevolvendoDemanda(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Devolver Demanda para Ajuste</DialogTitle>
            <DialogDescription>
              Informe o motivo para que a unidade requisitante corrija a demanda "{devolvendoDemanda?.title}".
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleDevolverDemanda} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason" className="text-xs">
                Justificativa da devolução * (mín. 10 caracteres)
              </Label>
              <Textarea
                id="reject-reason"
                value={motivoDevolucao}
                onChange={(e) => setMotivoDevolucao(e.target.value)}
                required
                minLength={10}
                maxLength={1000}
                rows={3}
                className="text-xs"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDevolvendoDemanda(null)}
                disabled={busy}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={busy || motivoDevolucao.trim().length < 10}
              >
                {busy ? "Devolvendo..." : "Confirmar Devolução"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Cancelar Demanda */}
      <Dialog open={!!cancelandoDemanda} onOpenChange={(o) => !o && !busy && setCancelandoDemanda(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Cancelar Demanda no PCA</DialogTitle>
            <DialogDescription>
              Confirma o cancelamento da demanda "{cancelandoDemanda?.title}"? Ela permanecerá no
              histórico do exercício, mas será removida do quadro consolidado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCancelandoDemanda(null)}
              disabled={busy}
            >
              Voltar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!cancelandoDemanda) return;
                const ok = await executarAcao("cancel", cancelandoDemanda.id, {});
                if (ok) setCancelandoDemanda(null);
              }}
            >
              {busy ? "Cancelando..." : "Confirmar Cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
