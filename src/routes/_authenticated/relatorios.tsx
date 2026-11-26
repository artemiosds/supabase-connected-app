import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Calendar,
  Coins,
  FileSpreadsheet,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
import { useTenant } from "@/hooks/use-tenant";
import { isCommercialModuleEnabled } from "@/lib/commercial-access";
import { dataHojeLocalISO, formatarData, formatarMoeda } from "@/lib/contratacao";
import type { CsvColumn } from "@/lib/csv-export";
import { bancoNaoConfigurado, carregarTodasAsPaginas, db } from "@/lib/db";
import {
  calcularMetricasBI,
  type ContratoResumo,
  type MetricasBI,
  type MovimentoOFResumo,
} from "@/lib/reports-metrics-helper";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios Executivos & BI — Primus Gestão" }] }),
  component: RelatoriosPage,
});

interface ContratoCompleto {
  id: string;
  number: string;
  object: string | null;
  instrument_type: string | null;
  total_value: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  supplier_id: string | null;
  supplier_name: string;
}

interface ItemContrato {
  id: string;
  contract_id: string;
  unit_value: number;
}

interface MovimentoBruto {
  id: string;
  contract_item_id: string;
  movement_type: string;
  quantity: number;
  unit_value_snapshot: number;
  created_at: string;
}

interface ContratoExportRow {
  numero: string;
  tipo: string;
  fornecedor: string;
  objeto: string;
  total: string;
  consumido: string;
  saldo: string;
  percentual: string;
  vigencia: string;
  status: string;
}

const CORES_GRAFICO = ["#0f766e", "#0284c7", "#6366f1", "#8b5cf6", "#ec4899"];

const STATUS_CONTRATO_ROTULOS: Record<string, string> = {
  active: "Vigente",
  vigente: "Vigente",
  encerrado: "Encerrado",
  rescindido: "Rescindido",
  suspenso: "Suspenso",
  arquivado: "Arquivado",
};

const INSTRUMENTO_ROTULOS: Record<string, string> = {
  contrato: "Contrato",
  ata_registro_precos: "Ata de Registro de Preços",
  termo_credenciamento: "Termo de Credenciamento",
  ordem_fornecimento: "Ordem de Fornecimento",
  outro: "Outro",
};

function RelatoriosPage() {
  const { selecionado, loading: carregandoTenant, bancoPendente, erro: erroTenant } = useTenant();
  const tenantId = selecionado?.id;

  const moduloRelatorios = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "relatorios")
    : false;
  const moduloContratos = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "contratos")
    : false;

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<"todos" | "ano_atual" | "12m">("todos");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroInstrumento, setFiltroInstrumento] = useState("todos");

  const [contratos, setContratos] = useState<ContratoCompleto[]>([]);
  const [movimentos, setMovimentos] = useState<MovimentoOFResumo[]>([]);
  const requisicaoRef = useRef(0);

  const carregarDados = useCallback(async () => {
    const req = ++requisicaoRef.current;

    if (!tenantId || !moduloRelatorios || !moduloContratos) {
      setContratos([]);
      setMovimentos([]);
      setErro(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErro(null);

      const [contractsData, suppliersData, itemsData, movementsData] = await Promise.all([
        carregarTodasAsPaginas<{
          id: string;
          number: string;
          object: string | null;
          instrument_type: string | null;
          total_value: number;
          status: string;
          start_date: string | null;
          end_date: string | null;
          supplier_id: string | null;
        }>((inicio, fim) =>
          db
            .from("contracts")
            .select(
              "id,number,object,instrument_type,total_value,status,start_date,end_date,supplier_id",
            )
            .eq("tenant_id", tenantId)
            .order("total_value", { ascending: false })
            .order("id", { ascending: true })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<{ id: string; legal_name: string; trade_name: string | null }>(
          (inicio, fim) =>
            db
              .from("suppliers")
              .select("id,legal_name,trade_name")
              .eq("tenant_id", tenantId)
              .order("id", { ascending: true })
              .range(inicio, fim),
        ),
        carregarTodasAsPaginas<ItemContrato>((inicio, fim) =>
          db
            .from("contract_items")
            .select("id,contract_id,unit_value")
            .eq("tenant_id", tenantId)
            .order("id", { ascending: true })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<MovimentoBruto>((inicio, fim) =>
          db
            .from("contract_item_movements")
            .select("id,contract_item_id,movement_type,quantity,unit_value_snapshot,created_at")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(inicio, fim),
        ),
      ]);

      if (req !== requisicaoRef.current) return;

      const supplierMap = new Map<string, string>();
      for (const s of suppliersData) {
        supplierMap.set(s.id, s.legal_name || s.trade_name || "Fornecedor");
      }

      const itemToContractMap = new Map<string, string>();
      for (const item of itemsData) {
        itemToContractMap.set(item.id, item.contract_id);
      }

      const contratosMapeados: ContratoCompleto[] = contractsData.map((c) => ({
        id: c.id,
        number: c.number,
        object: c.object,
        instrument_type: c.instrument_type,
        total_value: Number(c.total_value) || 0,
        status: c.status,
        start_date: c.start_date,
        end_date: c.end_date,
        supplier_id: c.supplier_id,
        supplier_name:
          (c.supplier_id && supplierMap.get(c.supplier_id)) || "Fornecedor não informado",
      }));

      const movimentosMapeados: MovimentoOFResumo[] = movementsData.map((m) => ({
        contract_id: itemToContractMap.get(m.contract_item_id) || "",
        quantity: Number(m.quantity) || 0,
        unit_price: Number(m.unit_value_snapshot) || 0,
        movement_type:
          m.movement_type === "consumption"
            ? "consumption"
            : m.movement_type === "reversal"
              ? "reversal"
              : "adjustment",
      }));

      setContratos(contratosMapeados);
      setMovimentos(movimentosMapeados);
    } catch (err: unknown) {
      if (req !== requisicaoRef.current) return;
      const msg = err instanceof Error ? err.message : "Erro ao carregar dados de BI";
      const textoErro = bancoNaoConfigurado(msg)
        ? "A estrutura de contratos ainda está pendente nesta base."
        : msg;
      setContratos([]);
      setMovimentos([]);
      setErro(textoErro);
      toast.error("Falha ao carregar relatórios", { description: textoErro });
    } finally {
      if (req === requisicaoRef.current) setLoading(false);
    }
  }, [tenantId, moduloRelatorios, moduloContratos]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  const contratosFiltrados = useMemo(() => {
    const anoAtual = new Date().getFullYear();
    const limiteAnoAtual = `${anoAtual}-01-01`;
    const limite12m = dataHojeLocalISO(new Date(Date.now() - 365 * 86_400_000));
    const termo = busca.trim().toLocaleLowerCase("pt-BR");

    return contratos.filter((c) => {
      if (periodo === "ano_atual" && c.start_date && c.start_date < limiteAnoAtual) return false;
      if (periodo === "12m" && c.start_date && c.start_date < limite12m) return false;

      if (filtroStatus === "vigentes") {
        if (c.status !== "active" && c.status !== "vigente") return false;
      } else if (filtroStatus !== "todos" && c.status !== filtroStatus) {
        return false;
      }

      if (filtroInstrumento !== "todos" && c.instrument_type !== filtroInstrumento) return false;

      if (!termo) return true;
      return [c.number, c.supplier_name, c.object]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase("pt-BR").includes(termo));
    });
  }, [contratos, periodo, filtroStatus, filtroInstrumento, busca]);

  const movimentosFiltrados = useMemo(() => {
    const idsValidos = new Set(contratosFiltrados.map((c) => c.id));
    return movimentos.filter((m) => idsValidos.has(m.contract_id));
  }, [contratosFiltrados, movimentos]);

  const metricasBI: MetricasBI = useMemo(() => {
    const contratosResumo: ContratoResumo[] = contratosFiltrados.map((c) => ({
      id: c.id,
      supplier_name: c.supplier_name,
      total_value: c.total_value,
      status: c.status,
    }));

    return calcularMetricasBI(contratosResumo, movimentosFiltrados);
  }, [contratosFiltrados, movimentosFiltrados]);

  const consumoPorContrato = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of movimentosFiltrados) {
      const subtotal =
        m.total_value != null
          ? Number(m.total_value)
          : (Number(m.quantity) || 0) * (Number(m.unit_price) || 0);
      if (!Number.isFinite(subtotal)) continue;
      const atual = map.get(m.contract_id) || 0;
      if (m.movement_type === "consumption" || m.movement_type === "adjustment") {
        map.set(m.contract_id, atual + subtotal);
      } else if (m.movement_type === "reversal") {
        map.set(m.contract_id, atual - subtotal);
      }
    }
    for (const [k, v] of map.entries()) {
      map.set(k, Math.max(0, Math.round((v + Number.EPSILON) * 100) / 100));
    }
    return map;
  }, [movimentosFiltrados]);

  const topContratosVigentes = useMemo(() => {
    return contratosFiltrados
      .filter((c) => c.status === "active" || c.status === "vigente")
      .sort((a, b) => b.total_value - a.total_value)
      .slice(0, 5)
      .map((c) => {
        const consumido = consumoPorContrato.get(c.id) || 0;
        const saldo = Math.max(0, c.total_value - consumido);
        const percentual = c.total_value > 0 ? Math.min(100, (consumido / c.total_value) * 100) : 0;
        return {
          ...c,
          consumido,
          saldo,
          percentual: Number(percentual.toFixed(1)),
        };
      });
  }, [contratosFiltrados, consumoPorContrato]);

  const dadosGrafico = useMemo(() => {
    return metricasBI.rankingFornecedores.map((item, index) => ({
      name:
        item.fornecedor.length > 20 ? `${item.fornecedor.slice(0, 18)}…` : item.fornecedor,
      nomeCompleto: item.fornecedor,
      valor: item.valorTotal,
      contratos: item.qtdContratos,
      fill: CORES_GRAFICO[index % CORES_GRAFICO.length],
    }));
  }, [metricasBI.rankingFornecedores]);

  const linhasExportacao: ContratoExportRow[] = useMemo(() => {
    return contratosFiltrados.map((c) => {
      const consumido = consumoPorContrato.get(c.id) || 0;
      const saldo = Math.max(0, c.total_value - consumido);
      const percentual = c.total_value > 0 ? (consumido / c.total_value) * 100 : 0;

      return {
        numero: c.number,
        tipo: c.instrument_type
          ? (INSTRUMENTO_ROTULOS[c.instrument_type] ?? c.instrument_type)
          : "Contrato",
        fornecedor: c.supplier_name,
        objeto: c.object || "Não especificado",
        total: c.total_value.toFixed(2),
        consumido: consumido.toFixed(2),
        saldo: saldo.toFixed(2),
        percentual: `${percentual.toFixed(1)}%`,
        vigencia: c.end_date ? formatarData(c.end_date) : "—",
        status: STATUS_CONTRATO_ROTULOS[c.status] ?? c.status,
      };
    });
  }, [contratosFiltrados, consumoPorContrato]);

  const colunasExportacao: CsvColumn<ContratoExportRow>[] = [
    { header: "Número", value: (r) => r.numero },
    { header: "Instrumento", value: (r) => r.tipo },
    { header: "Fornecedor", value: (r) => r.fornecedor },
    { header: "Objeto", value: (r) => r.objeto },
    { header: "Valor Total (R$)", value: (r) => r.total },
    { header: "Consumido em OF (R$)", value: (r) => r.consumido },
    { header: "Saldo Restante (R$)", value: (r) => r.saldo },
    { header: "% Executado", value: (r) => r.percentual },
    { header: "Vigência", value: (r) => r.vigencia },
    { header: "Status", value: (r) => r.status },
  ];

  if (carregandoTenant) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (bancoPendente) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Estrutura pendente</AlertTitle>
        <AlertDescription>O banco ainda não está disponível para esta conta.</AlertDescription>
      </Alert>
    );
  }

  if (erroTenant) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Falha ao carregar organizações</AlertTitle>
        <AlertDescription>{erroTenant}</AlertDescription>
      </Alert>
    );
  }

  if (!selecionado) {
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>
          Os indicadores executivos e relatórios financeiros são isolados por Secretaria.
        </AlertDescription>
      </Alert>
    );
  }

  if (!moduloRelatorios || !moduloContratos) {
    return (
      <Alert>
        <AlertTitle>Módulo indisponível no plano atual</AlertTitle>
        <AlertDescription>
          Esta página requer os módulos de Relatórios Executivos e Contratos habilitados para{" "}
          {selecionado.nome}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Central de Inteligência e Relatórios Executivos
            </h1>
            <Badge
              variant="outline"
              className="text-xs bg-primary/5 text-primary border-primary/20"
            >
              BI & Indicadores
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Visão gerencial consolidada de contratações, ordens de fornecimento, consumo de saldo e
            concentração de mercado em {selecionado.nome}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void carregarDados()}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <ReportExportActions
            title={`Relatório Executivo de Contratos — ${selecionado.nome}`}
            filename={`relatorio-executivo-contratos-${dataHojeLocalISO()}`}
            columns={colunasExportacao}
            rows={linhasExportacao}
            disabled={loading}
          />
        </div>
      </div>

      {/* Barra de Filtros */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar contrato, objeto ou fornecedor…"
                className="h-9 pl-8 text-xs"
              />
            </div>

            <Select
              value={periodo}
              onValueChange={(val) => setPeriodo(val as "todos" | "ano_atual" | "12m")}
            >
              <SelectTrigger className="h-9 text-xs">
                <Calendar className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo o Histórico</SelectItem>
                <SelectItem value="ano_atual">
                  Exercício Atual ({new Date().getFullYear()})
                </SelectItem>
                <SelectItem value="12m">Últimos 12 meses</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Situação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as situações</SelectItem>
                <SelectItem value="vigentes">Somente vigentes</SelectItem>
                <SelectItem value="encerrado">Encerrado</SelectItem>
                <SelectItem value="rescindido">Rescindido</SelectItem>
                <SelectItem value="suspenso">Suspenso</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filtroInstrumento} onValueChange={setFiltroInstrumento}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Instrumento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os instrumentos</SelectItem>
                {Object.entries(INSTRUMENTO_ROTULOS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Erro ao consultar indicadores</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/* Cards de KPIs Executivos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Contratado (Vigentes)
            </CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {loading ? "…" : formatarMoeda(metricasBI.totalContratado)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metricasBI.totalContratosAtivos} contrato(s) ativo(s)
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Executado em OFs (Líquido)
            </CardTitle>
            <Truck className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {loading ? "…" : formatarMoeda(metricasBI.totalExecutadoOF)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <strong>{metricasBI.percentualExecucao}%</strong> do valor contratado vigente
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Saldo Disponível
            </CardTitle>
            <Coins className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {loading ? "…" : formatarMoeda(metricasBI.saldoRestante)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Disponível para novas emissões de OF
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Instrumentos Filtrados
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {loading ? "…" : contratosFiltrados.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metricasBI.totalContratosAtivos} vigente(s) no recorte
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de Distribuição por Fornecedor & Painel Sintético */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Top 5 Maiores Fornecedores (Vigentes)
                </CardTitle>
                <CardDescription className="text-xs">
                  Concentração de contratações vigentes por fornecedor no recorte selecionado.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {dadosGrafico.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Nenhum contrato vigente para exibição no gráfico.
              </div>
            ) : (
              <div className="h-72 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dadosGrafico}
                    margin={{ top: 10, right: 10, left: 10, bottom: 25 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                    />
                    <YAxis
                      tickFormatter={(val: number) => `R$ ${(val / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(val: number) => [formatarMoeda(val), "Valor Contratado"]}
                      labelFormatter={(_, payload) =>
                        (payload?.[0]?.payload as { nomeCompleto?: string } | undefined)
                          ?.nomeCompleto || ""
                      }
                      contentStyle={{
                        backgroundColor: "var(--background)",
                        borderColor: "var(--border)",
                        fontSize: "12px",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                      {dadosGrafico.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Detalhamento dos Maiores Fornecedores
            </CardTitle>
            <CardDescription className="text-xs">
              Valores acumulados e representatividade no volume de compras vigentes da Secretaria.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            {metricasBI.rankingFornecedores.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Nenhum registro para detalhamento.
              </div>
            ) : (
              <div className="space-y-3">
                {metricasBI.rankingFornecedores.map((item, idx) => {
                  const percentualDoTotal =
                    metricasBI.totalContratado > 0
                      ? (item.valorTotal / metricasBI.totalContratado) * 100
                      : 0;

                  return (
                    <div key={item.fornecedor} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground flex items-center gap-1.5 truncate max-w-[280px]">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                            style={{ backgroundColor: CORES_GRAFICO[idx % CORES_GRAFICO.length] }}
                          />
                          {item.fornecedor}
                        </span>
                        <span className="tabular-nums font-medium text-muted-foreground">
                          {formatarMoeda(item.valorTotal)} ({percentualDoTotal.toFixed(1)}%)
                        </span>
                      </div>
                      <Progress value={percentualDoTotal} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabela Sintética: 5 Maiores Contratos Vigentes */}
      <Card className="border-border shadow-xs">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Top 5 Maiores Contratos Vigentes e Execução de Saldo
              </CardTitle>
              <CardDescription className="text-xs">
                Acompanhamento do consumo líquido de saldo através das Ordens de Fornecimento.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/contratos" className="text-xs text-primary flex items-center gap-1">
                Ver todos os contratos <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {topContratosVigentes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum contrato vigente encontrado no recorte atual.
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[140px]">Contrato</TableHead>
                    <TableHead>Fornecedor e Objeto</TableHead>
                    <TableHead className="w-[130px] text-right">Valor Total</TableHead>
                    <TableHead className="w-[130px] text-right">Executado (OF)</TableHead>
                    <TableHead className="w-[130px] text-right">Saldo Restante</TableHead>
                    <TableHead className="w-[160px]">Consumo do Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topContratosVigentes.map((contrato) => (
                    <TableRow key={contrato.id} className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-semibold text-xs">
                        {contrato.number}
                        {contrato.end_date && (
                          <div className="text-[10px] text-muted-foreground font-normal">
                            Fim: {formatarData(contrato.end_date)}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-xs text-foreground">
                          {contrato.supplier_name}
                        </div>
                        {contrato.object && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1">
                            {contrato.object}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {formatarMoeda(contrato.total_value)}
                      </TableCell>

                      <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                        {formatarMoeda(contrato.consumido)}
                      </TableCell>

                      <TableCell className="text-right text-xs text-amber-600 dark:text-amber-400 font-medium tabular-nums">
                        {formatarMoeda(contrato.saldo)}
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>{contrato.percentual}%</span>
                            <span>{(100 - contrato.percentual).toFixed(1)}% disp.</span>
                          </div>
                          <Progress value={contrato.percentual} className="h-2" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
