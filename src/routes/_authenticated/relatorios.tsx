import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileSpreadsheet,
  Truck,
  Coins,
  ShieldCheck,
  Download,
  RefreshCw,
  BarChart3,
  TrendingUp,
  Calendar,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { formatarMoeda, formatarData } from "@/lib/contratacao";
import { exportToXlsx } from "@/lib/xlsx-export";
import {
  calcularMetricasBI,
  type ContratoResumo,
  type MovimentoOFResumo,
  type MetricasBI,
} from "@/lib/reports-metrics-helper";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios Executivos & BI — Primus Gestão" }] }),
  component: RelatoriosPage,
});

interface ContratoCompleto {
  id: string;
  number: string;
  object: string | null;
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

const CORES_GRAFICO = ["#0f766e", "#0284c7", "#6366f1", "#8b5cf6", "#ec4899"];

function RelatoriosPage() {
  const { selecionado } = useTenant();
  const tenantId = selecionado?.id;

  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<"todos" | "ano_atual" | "12m">("todos");

  const [contratos, setContratos] = useState<ContratoCompleto[]>([]);
  const [movimentos, setMovimentos] = useState<MovimentoOFResumo[]>([]);

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [contractsData, suppliersData, itemsData, movementsData] = await Promise.all([
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("contracts")
            .select("id,number,object,total_value,status,start_date,end_date,supplier_id")
            .eq("tenant_id", tenantId)
            .order("total_value", { ascending: false })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("suppliers")
            .select("id,legal_name,trade_name,cnpj")
            .eq("tenant_id", tenantId)
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("contract_items")
            .select("id,contract_id,unit_value")
            .eq("tenant_id", tenantId)
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("contract_item_movements")
            .select("id,contract_item_id,movement_type,quantity,unit_value_snapshot,created_at")
            .eq("tenant_id", tenantId)
            .range(inicio, fim),
        ),
      ]);

      // Mapear fornecedores
      const supplierMap = new Map<string, string>();
      for (const s of suppliersData as Array<{ id: string; legal_name: string; trade_name: string | null }>) {
        supplierMap.set(s.id, s.legal_name || s.trade_name || "Fornecedor");
      }

      // Mapear itens para contratos
      const itemToContractMap = new Map<string, string>();
      for (const item of itemsData as ItemContrato[]) {
        itemToContractMap.set(item.id, item.contract_id);
      }

      // Montar contratos enriquecidos
      const contratosMapeados: ContratoCompleto[] = (contractsData as any[]).map((c) => ({
        id: c.id,
        number: c.number,
        object: c.object,
        total_value: Number(c.total_value) || 0,
        status: c.status,
        start_date: c.start_date,
        end_date: c.end_date,
        supplier_id: c.supplier_id,
        supplier_name: (c.supplier_id && supplierMap.get(c.supplier_id)) || "Fornecedor não informado",
      }));

      // Montar movimentos enriquecidos
      const movimentosMapeados: MovimentoOFResumo[] = (movementsData as MovimentoBruto[]).map((m) => ({
        contract_id: itemToContractMap.get(m.contract_item_id) || "",
        quantity: Number(m.quantity) || 0,
        unit_price: Number(m.unit_value_snapshot) || 0,
        movement_type: m.movement_type === "consumption" ? "consumption" : "adjustment",
      }));

      setContratos(contratosMapeados);
      setMovimentos(movimentosMapeados);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar dados de BI";
      toast.error("Falha ao carregar relatórios", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Filtragem por período
  const contratosFiltrados = useMemo(() => {
    if (periodo === "todos") return contratos;

    const anoAtual = new Date().getFullYear();
    const dataLimite =
      periodo === "ano_atual"
        ? new Date(anoAtual, 0, 1)
        : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    return contratos.filter((c) => {
      if (!c.start_date) return true;
      return new Date(c.start_date) >= dataLimite;
    });
  }, [contratos, periodo]);

  // Movimentos filtrados por contratos correspondentes
  const movimentosFiltrados = useMemo(() => {
    const idsValidos = new Set(contratosFiltrados.map((c) => c.id));
    return movimentos.filter((m) => idsValidos.has(m.contract_id));
  }, [contratosFiltrados, movimentos]);

  // Cálculo das Métricas de BI
  const metricasBI: MetricasBI = useMemo(() => {
    const contratosResumo: ContratoResumo[] = contratosFiltrados.map((c) => ({
      id: c.id,
      supplier_name: c.supplier_name,
      total_value: c.total_value,
      status: c.status,
    }));

    return calcularMetricasBI(contratosResumo, movimentosFiltrados);
  }, [contratosFiltrados, movimentosFiltrados]);

  // Cálculo de consumo por contrato para a tabela sintética
  const consumoPorContrato = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of movimentosFiltrados) {
      if (m.movement_type === "consumption") {
        const atual = map.get(m.contract_id) || 0;
        map.set(m.contract_id, atual + m.quantity * m.unit_price);
      }
    }
    return map;
  }, [movimentosFiltrados]);

  // Top 5 Maiores Contratos Vigentes
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

  // Dados para o Gráfico de Barras (Ranking de Fornecedores)
  const dadosGrafico = useMemo(() => {
    return metricasBI.rankingFornecedores.map((item, index) => ({
      name:
        item.fornecedor.length > 20
          ? `${item.fornecedor.slice(0, 18)}…`
          : item.fornecedor,
      nomeCompleto: item.fornecedor,
      valor: item.valorTotal,
      contratos: item.qtdContratos,
      fill: CORES_GRAFICO[index % CORES_GRAFICO.length],
    }));
  }, [metricasBI.rankingFornecedores]);

  // Exportação XLSX
  const handleExportXlsx = async () => {
    try {
      const rows = contratosFiltrados.map((c) => {
        const consumido = consumoPorContrato.get(c.id) || 0;
        const saldo = Math.max(0, c.total_value - consumido);
        const percentual = c.total_value > 0 ? (consumido / c.total_value) * 100 : 0;

        return {
          numero: c.number,
          fornecedor: c.supplier_name,
          objeto: c.object || "Não especificado",
          total: c.total_value,
          consumido,
          saldo,
          percentual: `${percentual.toFixed(1)}%`,
          vigencia: c.end_date ? formatarData(c.end_date) : "—",
          status: c.status === "active" || c.status === "vigente" ? "Vigente" : c.status,
        };
      });

      const columns = [
        { header: "Número do Contrato", value: (r: any) => r.numero },
        { header: "Fornecedor", value: (r: any) => r.fornecedor },
        { header: "Objeto", value: (r: any) => r.objeto },
        { header: "Valor Total (R$)", value: (r: any) => r.total },
        { header: "Consumido em OF (R$)", value: (r: any) => r.consumido },
        { header: "Saldo Restante (R$)", value: (r: any) => r.saldo },
        { header: "% Executado", value: (r: any) => r.percentual },
        { header: "Vigência", value: (r: any) => r.vigencia },
        { header: "Status", value: (r: any) => r.status },
      ];

      await exportToXlsx("relatorio-executivo-contratos-bi", columns, rows);
      toast.success("Relatório XLSX exportado com sucesso!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao exportar arquivo";
      toast.error("Falha ao exportar XLSX", { description: msg });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Central de Inteligência e Relatórios Executivos
            </h1>
            <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
              BI & Indicadores
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Visão gerencial consolidada de contratações, ordens de fornecimento, consumo de saldo e concentração de mercado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={periodo}
            onValueChange={(val) => setPeriodo(val as any)}
          >
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <Calendar className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todo o Histórico</SelectItem>
              <SelectItem value="ano_atual">Exercício Atual ({new Date().getFullYear()})</SelectItem>
              <SelectItem value="12m">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => carregarDados()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          <Button size="sm" onClick={handleExportXlsx} disabled={loading || contratosFiltrados.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Exportar XLSX
          </Button>
        </div>
      </div>

      {/* Cards de KPIs Executivos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Contratado
            </CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {formatarMoeda(metricasBI.totalContratado)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metricasBI.totalContratosAtivos} contrato(s) ativo(s)
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Executado em OFs
            </CardTitle>
            <Truck className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatarMoeda(metricasBI.totalExecutadoOF)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <strong>{metricasBI.percentualExecucao}%</strong> do valor total contratado
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
              {formatarMoeda(metricasBI.saldoRestante)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Disponível para novas emissões de OF
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Contratos Vigentes
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {metricasBI.totalContratosAtivos}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Em monitoramento contínuo
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de Distribuição por Fornecedor & Painel Sintético */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gráfico de Barras: Ranking dos Maiores Fornecedores */}
        <Card className="border-border shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Top 5 Maiores Fornecedores (Valor Contratado)
                </CardTitle>
                <CardDescription className="text-xs">
                  Concentração de contratações por fornecedor no período selecionado.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {dadosGrafico.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Nenhum contrato ativo para exibição no gráfico.
              </div>
            ) : (
              <div className="h-72 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosGrafico} margin={{ top: 10, right: 10, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                    />
                    <YAxis
                      tickFormatter={(val) => `R$ ${(val / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(val: number) => [formatarMoeda(val), "Valor Contratado"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.nomeCompleto || ""}
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

        {/* Resumo da Concentração */}
        <Card className="border-border shadow-xs flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Detalhamento dos Maiores Fornecedores
            </CardTitle>
            <CardDescription className="text-xs">
              Valores acumulados e representatividade no volume de compras da Secretaria.
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

      {/* Tabela Sintética: 5 Maiores Contratos Vigentes com Consumo de Saldo */}
      <Card className="border-border shadow-xs">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Top 5 Maiores Contratos Vigentes e Execução de Saldo
              </CardTitle>
              <CardDescription className="text-xs">
                Acompanhamento em tempo real da queima de saldo através de Ordens de Fornecimento emitidas.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href="/contratos" className="text-xs text-primary flex items-center gap-1">
                Ver todos os contratos <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {topContratosVigentes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum contrato vigente registrado.
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
                            <span>{100 - contrato.percentual}% disp.</span>
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
