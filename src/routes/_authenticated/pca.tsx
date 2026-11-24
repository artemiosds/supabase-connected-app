import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  FilePlus2,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useTenant } from "@/hooks/use-tenant";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { formatarData, MODALIDADES } from "@/lib/contratacao";
import { exportToXlsx } from "@/lib/xlsx-export";
import {
  consolidarDemandasPCA,
  type DemandaPCARow,
  type ItemConsolidadoPCA,
} from "@/lib/pca-consolidation-helper";
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

function PcaPage() {
  const { selecionado } = useTenant();
  const tenantId = selecionado?.id;

  const [year, setYear] = useState(new Date().getFullYear());
  const [demandas, setDemandas] = useState<DemandaPCARow[]>([]);
  const [capabilities, setCapabilities] = useState<DemandCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Modal de nova demanda
  const [novaAberta, setNovaAberta] = useState(false);
  const [rows, setRows] = useState<string[]>([crypto.randomUUID()]);

  // Modal de conversão em processo
  const [convertendoDemanda, setConvertendoDemanda] = useState<DemandaPCARow | null>(null);
  const [numeroProcesso, setNumeroProcesso] = useState("");
  const [modalidadeProcesso, setModalidadeProcesso] = useState("");

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
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
            .select("id,plan_year,title,justification,approved_at,process_id,items,submitted_at")
            .eq("tenant_id", tenantId)
            .eq("plan_year", year)
            .order("submitted_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
        db.rpc("annual_demand_capabilities", { p_tenant_id: tenantId }),
      ]);

      if (capsRes.error) throw new Error(capsRes.error.message);

      setDemandas(demandsRows);
      setCapabilities((capsRes.data?.[0] as DemandCapabilities) ?? null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao consultar o PCA.";
      setErro(
        bancoNaoConfigurado(msg) ? "PCA pendente de implantação nesta base." : msg,
      );
      toast.error("Falha ao carregar PCA", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [tenantId, year]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  const resumo = useMemo(() => consolidarDemandasPCA(demandas), [demandas]);

  async function executarAcao(action: "submit" | "approve" | "convert", id: string, data: Json) {
    if (!tenantId) return false;
    setBusy(true);
    try {
      const result = await db.rpc("manage_annual_demand", {
        p_tenant_id: tenantId,
        p_action: action,
        p_id: id,
        p_data: data,
      });
      if (result.error) throw new Error(result.error.message);

      toast.success(
        action === "convert"
          ? "Processo criado com os itens do PCA."
          : action === "approve"
            ? "Demanda aprovada para compra."
            : "Demanda enviada para aprovação.",
      );

      await carregarDados();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gravar a demanda.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCriarDemanda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const items = rows.map((key) => ({
      description: String(values.get("description-" + key) || "").trim(),
      unit: String(values.get("unit-" + key) || "").trim(),
      quantity: Number(values.get("quantity-" + key)) || 0,
    }));

    const ok = await executarAcao("submit", crypto.randomUUID(), {
      year,
      title: String(values.get("title") || "").trim(),
      justification: String(values.get("justification") || "").trim(),
      items,
    });

    if (ok) {
      form.reset();
      setRows([crypto.randomUUID()]);
      setNovaAberta(false);
    }
  }

  async function handleConverterDemanda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!convertendoDemanda) return;

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

  async function handleExportarConsolidadoXlsx() {
    try {
      const columns = [
        { header: "Descrição do Item", value: (r: ItemConsolidadoPCA) => r.descricaoOriginal },
        { header: "Unidade", value: (r: ItemConsolidadoPCA) => r.unidade },
        { header: "Quantidade Total Consolidada", value: (r: ItemConsolidadoPCA) => r.quantidadeTotal },
        { header: "Demandas / Unidades Solicitantes", value: (r: ItemConsolidadoPCA) => r.totalDemandasOrigem },
      ];

      await exportToXlsx(`pca-consolidado-${year}`, columns, resumo.itensConsolidados);
      toast.success("Quadro consolidado do PCA exportado em XLSX!");
    } catch (error) {
      toast.error("Erro ao exportar XLSX", {
        description: error instanceof Error ? error.message : "Falha desconhecida",
      });
    }
  }

  const anosDisponiveis = Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i);

  return (
    <div className="space-y-6 pb-12">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Plano de Contratações Anual (PCA)
            </h1>
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
            Central de planejamento anual, consolidação de compras em escala e conversão direta em DFD / Processos (Lei nº 14.133/2021).
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

          <Button variant="outline" size="sm" onClick={() => void carregarDados()} disabled={loading || busy}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          {capabilities?.can_create && (
            <Button size="sm" onClick={() => setNovaAberta(true)} disabled={busy}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Nova Demanda
            </Button>
          )}
        </div>
      </div>

      {/* Cards de Indicadores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total de Demandas
            </CardTitle>
            <Layers className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{resumo.totalDemandas}</div>
            <p className="text-xs text-muted-foreground mt-1">no exercício {year}</p>
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
              {resumo.demandasAguardando}
            </div>
            <p className="text-xs text-muted-foreground mt-1">em análise da gestão</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Aprovadas p/ Compra
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {resumo.demandasAprovadas}
            </div>
            <p className="text-xs text-muted-foreground mt-1">prontas para virar processo</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Vinculadas a Processos
            </CardTitle>
            <FilePlus2 className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              {resumo.demandasConvertidas}
            </div>
            <p className="text-xs text-muted-foreground mt-1">DFDs e processos gerados</p>
          </CardContent>
        </Card>
      </div>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {erro}
        </div>
      )}

      {/* Abas Principais */}
      <Tabs defaultValue="demandas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="demandas">
            Demandas Cadastradas ({demandas.length})
          </TabsTrigger>
          <TabsTrigger value="consolidado">
            Quadro Consolidado de Itens ({resumo.itensConsolidados.length})
          </TabsTrigger>
        </TabsList>

        {/* Aba 1: Demandas Cadastradas */}
        <TabsContent value="demandas" className="space-y-4">
          {loading ? (
            <div className="py-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando demandas do PCA {year}…
            </div>
          ) : demandas.length === 0 ? (
            <Card className="border-dashed py-12 text-center">
              <CardContent className="space-y-2">
                <p className="font-medium text-sm">Nenhuma demanda registrada para o exercício {year}.</p>
                <p className="text-xs text-muted-foreground">
                  As unidades podem registrar suas necessidades anuais clicando em "Nova Demanda".
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {demandas.map((demand) => {
                const itemsList = Array.isArray(demand.items) ? demand.items : [];
                return (
                  <Card key={demand.id} className="border-border shadow-xs">
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <CardTitle className="text-base">{demand.title}</CardTitle>
                          <CardDescription className="text-xs">
                            Enviada em {formatarData(demand.submitted_at)} · {itemsList.length} item(ns)
                          </CardDescription>
                        </div>
                        <Badge
                          variant={
                            demand.process_id
                              ? "default"
                              : demand.approved_at
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {demand.process_id
                            ? "Processo vinculado"
                            : demand.approved_at
                              ? "Demanda aprovada"
                              : "Aguardando aprovação"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground">{demand.justification}</p>

                      {itemsList.length > 0 && (
                        <div className="rounded-md border bg-muted/20 p-3">
                          <ul className="space-y-1 text-xs">
                            {itemsList.map(
                              (item, idx) =>
                                item &&
                                typeof item === "object" &&
                                !Array.isArray(item) && (
                                  <li key={idx} className="flex items-center justify-between">
                                    <span>{String((item as Record<string, unknown>)["description"])}</span>
                                    <span className="font-semibold tabular-nums">
                                      {String((item as Record<string, unknown>)["quantity"])}{" "}
                                      {String((item as Record<string, unknown>)["unit"])}
                                    </span>
                                  </li>
                                ),
                            )}
                          </ul>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {!demand.approved_at && capabilities?.can_approve && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void executarAcao("approve", demand.id, {})}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                            Aprovar demanda
                          </Button>
                        )}

                        {demand.approved_at && !demand.process_id && capabilities?.can_create && (
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
                          <Button variant="link" size="sm" asChild className="px-0 h-auto">
                            <a
                              href={`/processos?processo=${encodeURIComponent(demand.process_id)}`}
                              className="text-xs flex items-center gap-1"
                            >
                              Abrir processo vinculado <ArrowUpRight className="w-3.5 h-3.5" />
                            </a>
                          </Button>
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
                    Agrupamento automático de itens idênticos solicitados por diferentes unidades no exercício {year}.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportarConsolidadoXlsx}
                  disabled={resumo.itensConsolidados.length === 0}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Exportar XLSX
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {resumo.itensConsolidados.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum item consolidado disponível para o exercício {year}.
                </div>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Descrição do Item</TableHead>
                        <TableHead className="w-[110px]">Unidade</TableHead>
                        <TableHead className="w-[180px] text-right">Qtd. Total Consolidada</TableHead>
                        <TableHead className="w-[180px] text-right">Unidades Solicitantes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumo.itensConsolidados.map((item) => (
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

      {/* Modal: Nova Demanda PCA */}
      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Nova Demanda no PCA {year}</DialogTitle>
            <DialogDescription>
              Informe o objeto, justificativa e os itens necessários para compor o planejamento anual da Secretaria.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCriarDemanda} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pca-title" className="text-xs">Objeto da Demanda *</Label>
              <Input id="pca-title" name="title" required minLength={3} maxLength={300} className="text-xs" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pca-justification" className="text-xs">Justificativa *</Label>
              <Input id="pca-justification" name="justification" required minLength={3} maxLength={5000} className="text-xs" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Itens da Demanda</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || rows.length >= 200}
                  onClick={() => setRows([...rows, crypto.randomUUID()])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar item
                </Button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {rows.map((key, idx) => (
                  <div key={key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-12 items-end bg-muted/20">
                    <div className="sm:col-span-6 space-y-1">
                      <Label className="text-[11px]">Descrição (Item {idx + 1}) *</Label>
                      <Input name={"description-" + key} required minLength={3} maxLength={500} className="h-8 text-xs" />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <Label className="text-[11px]">Unidade *</Label>
                      <Input name={"unit-" + key} required maxLength={30} placeholder="UN/CX" className="h-8 text-xs" />
                    </div>
                    <div className="sm:col-span-3 space-y-1">
                      <Label className="text-[11px]">Quantidade *</Label>
                      <Input
                        name={"quantity-" + key}
                        type="number"
                        required
                        min="0.0001"
                        step="0.0001"
                        max="9999999999.9999"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      {rows.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setRows(rows.filter((r) => r !== key))}
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
              <Button type="button" variant="outline" size="sm" onClick={() => setNovaAberta(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Enviando..." : "Enviar Demanda para Aprovação"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Converter Demanda em Processo */}
      <Dialog open={!!convertendoDemanda} onOpenChange={(o) => !o && setConvertendoDemanda(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Criar Processo a partir do PCA</DialogTitle>
            <DialogDescription>
              Converter a demanda aprovada "{convertendoDemanda?.title}" em um novo processo de contratação e DFD.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConverterDemanda} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="proc-number" className="text-xs">Número do Processo *</Label>
              <Input
                id="proc-number"
                value={numeroProcesso}
                onChange={(e) => setNumeroProcesso(e.target.value)}
                required
                maxLength={60}
                placeholder="Ex: PROC-045/2026"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-modality" className="text-xs">Modalidade *</Label>
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
              <Button type="submit" size="sm" disabled={busy || !modalidadeProcesso}>
                {busy ? "Criando..." : "Criar Processo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
