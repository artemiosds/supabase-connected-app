import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  ScrollText,
} from "lucide-react";
import {
  calcularMetricasCockpitVencimentos,
  compilarItensVencimentoUnificados,
  type ItemVencimentoUnificado,
  type NivelUrgenciaVencimento,
  type TipoItemVencimento,
} from "@/lib/document-expiry-cockpit-helper";
import { formatarData } from "@/lib/contratacao";
import type { CsvColumn } from "@/lib/csv-export";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  documentosFornecedor: Array<{
    id: string;
    title: string;
    document_type?: string | null | undefined;
    supplier_id: string;
    issue_date?: string | null | undefined;
    expires_at?: string | null | undefined;
    storage_provider?: string | null | undefined;
    external_url?: string | null | undefined;
  }>;
  contratos: Array<{
    id: string;
    number: string;
    object?: string | null | undefined;
    supplier_id?: string | null | undefined;
    status: string;
    instrument_type?: string | null | undefined;
    total_value?: number | null | undefined;
    start_date?: string | null | undefined;
    end_date?: string | null | undefined;
  }>;
  fornecedores: Array<{
    id: string;
    legal_name?: string | null | undefined;
    trade_name?: string | null | undefined;
    cnpj?: string | null | undefined;
  }>;
  busca: string;
  onFocarDocumento?: (documentoId: string) => void;
}

const COR_BADGE_URGENCIA: Record<
  NivelUrgenciaVencimento,
  "destructive" | "default" | "secondary" | "outline"
> = {
  critico: "destructive",
  urgente: "default",
  atencao: "secondary",
  planejamento: "outline",
  regular: "outline",
  indeterminado: "outline",
};

export function DocumentExpiryCockpit(props: Props) {
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoItemVencimento>("todos");
  const [filtroUrgencia, setFiltroUrgencia] = useState<"todos" | NivelUrgenciaVencimento>("todos");
  const [expandido, setExpandido] = useState(false);

  const itensUnificados = useMemo(
    () =>
      compilarItensVencimentoUnificados({
        documentosFornecedor: props.documentosFornecedor,
        contratos: props.contratos,
        fornecedores: props.fornecedores,
      }),
    [props.documentosFornecedor, props.contratos, props.fornecedores],
  );

  const metricas = useMemo(
    () => calcularMetricasCockpitVencimentos(itensUnificados),
    [itensUnificados],
  );

  const filtrados = useMemo(() => {
    const q = props.busca.trim().toLowerCase();
    return itensUnificados.filter((item) => {
      if (filtroTipo !== "todos" && item.tipo !== filtroTipo) return false;
      if (filtroUrgencia !== "todos" && item.nivelUrgencia !== filtroUrgencia) return false;
      if (!q) return true;
      return [item.identificador, item.titulo, item.fornecedorNome, item.rotuloStatus]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [itensUnificados, filtroTipo, filtroUrgencia, props.busca]);

  const visiveis = expandido ? filtrados : filtrados.slice(0, 8);

  const colunasCsv: CsvColumn<ItemVencimentoUnificado>[] = [
    {
      header: "Categoria",
      value: (i) => (i.tipo === "contrato_ata" ? "Contrato / Ata" : "Certidão Fornecedor"),
    },
    { header: "Identificador", value: (i) => i.identificador },
    { header: "Descrição / Objeto", value: (i) => i.titulo },
    { header: "Fornecedor", value: (i) => i.fornecedorNome },
    { header: "Emissão / Início", value: (i) => (i.dataEmissao ? formatarData(i.dataEmissao) : "—") },
    {
      header: "Vencimento / Término",
      value: (i) => (i.dataVencimento ? formatarData(i.dataVencimento) : "Sem prazo"),
    },
    { header: "Situação", value: (i) => i.rotuloStatus },
  ];

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-5 w-5 text-primary" />
              Cockpit Unificado de Vencimentos (Certidões + Contratos/Atas)
            </CardTitle>
            <CardDescription>
              Monitoramento integrado pela régua da Lei nº 14.133/2021 (120 / 60 / 30 dias),
              ordenado por criticidade.
            </CardDescription>
          </div>
          <ReportExportActions<ItemVencimentoUnificado>
            filename="cockpit-vencimentos-unificado"
            title="Cockpit Unificado de Vencimentos — Certidões e Contratos"
            columns={colunasCsv}
            rows={filtrados}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs clicáveis */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <button
            type="button"
            onClick={() =>
              setFiltroUrgencia((curr) => (curr === "critico" ? "todos" : "critico"))
            }
            className={`rounded-lg border p-3 text-left transition ${
              filtroUrgencia === "critico" ? "ring-2 ring-destructive" : ""
            } ${metricas.totalVencidos > 0 ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Já vencidos</span>
              <AlertOctagon
                className={`h-4 w-4 ${metricas.totalVencidos > 0 ? "text-destructive" : "text-muted-foreground"}`}
              />
            </div>
            <p
              className={`mt-1 text-2xl font-bold ${metricas.totalVencidos > 0 ? "text-destructive" : ""}`}
            >
              {metricas.totalVencidos}
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setFiltroUrgencia((curr) => (curr === "urgente" ? "todos" : "urgente"))
            }
            className={`rounded-lg border p-3 text-left transition ${
              filtroUrgencia === "urgente" ? "ring-2 ring-primary" : ""
            } bg-card`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Urgentes (≤ 30d)</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <p className="mt-1 text-2xl font-bold">{metricas.totalUrgentes30d}</p>
          </button>

          <button
            type="button"
            onClick={() =>
              setFiltroUrgencia((curr) => (curr === "atencao" ? "todos" : "atencao"))
            }
            className={`rounded-lg border p-3 text-left transition ${
              filtroUrgencia === "atencao" ? "ring-2 ring-primary" : ""
            } bg-card`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Atenção (31–60d)</span>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-2xl font-bold">{metricas.totalAtencao60d}</p>
          </button>

          <button
            type="button"
            onClick={() =>
              setFiltroUrgencia((curr) => (curr === "planejamento" ? "todos" : "planejamento"))
            }
            className={`rounded-lg border p-3 text-left transition ${
              filtroUrgencia === "planejamento" ? "ring-2 ring-primary" : ""
            } bg-card`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Planejamento (61–120d)</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-1 text-2xl font-bold">{metricas.totalPlanejamento120d}</p>
          </button>
        </div>

        {/* Pílulas de filtro */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={filtroTipo === "todos" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setFiltroTipo("todos")}
            >
              Todos ({metricas.totalItens})
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filtroTipo === "certidao_fornecedor" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setFiltroTipo("certidao_fornecedor")}
            >
              <FileCheck2 className="mr-1 h-3.5 w-3.5" /> Certidões ({metricas.totalCertidoes})
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filtroTipo === "contrato_ata" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setFiltroTipo("contrato_ata")}
            >
              <ScrollText className="mr-1 h-3.5 w-3.5" /> Contratos/Atas ({metricas.totalContratos})
            </Button>
          </div>
          {filtroUrgencia !== "todos" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setFiltroUrgencia("todos")}
            >
              Limpar filtro de urgência
            </Button>
          )}
        </div>

        {/* Lista consolidada */}
        {visiveis.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Nenhum contrato ou certidão encontrado para os filtros do cockpit.
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {visiveis.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs sm:px-3"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {item.tipo === "contrato_ata" ? "Contrato / Ata" : "Certidão"}
                    </Badge>
                    <span className="font-semibold text-foreground">{item.identificador}</span>
                    <span className="text-muted-foreground">· {item.fornecedorNome}</span>
                  </div>
                  <p className="truncate text-muted-foreground">{item.titulo}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">
                    {item.dataVencimento ? formatarData(item.dataVencimento) : "Sem prazo"}
                  </span>
                  <Badge variant={COR_BADGE_URGENCIA[item.nivelUrgencia]}>
                    {item.rotuloStatus}
                  </Badge>
                  {item.tipo === "contrato_ata" ? (
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
                      <Link to="/contratos">
                        <ExternalLink className="mr-1 h-3 w-3" /> Contratos
                      </Link>
                    </Button>
                  ) : (
                    props.onFocarDocumento && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => props.onFocarDocumento?.(item.origemId)}
                      >
                        Localizar
                      </Button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {filtrados.length > 8 && (
          <div className="flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setExpandido((v) => !v)}
            >
              {expandido
                ? "Mostrar apenas os 8 mais críticos"
                : `Ver todos os ${filtrados.length} itens no cockpit`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
