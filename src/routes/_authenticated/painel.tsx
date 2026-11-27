import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { MyTasks } from "@/components/dashboard/my-tasks";
import { ExecutivePipelineCard } from "@/components/dashboard/executive-pipeline-card";
import {
  avaliarProntidaoSecretaria,
  resumirEsteiraProcessos,
  type ProcessoResumoPainel,
  type ResultadoProntidaoSecretaria,
  type ResumoEsteiraPainel,
} from "@/lib/executive-dashboard-helper";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { isCommercialModuleEnabled } from "@/lib/commercial-access";
import { dataHojeLocalISO } from "@/lib/contratacao";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import {
  DIAS_PROCESSO_PARADO,
  listarProcessosParados,
  type ProcessoParado,
} from "@/lib/process-stagnation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({ meta: [{ title: "Painel — Gestão de Fornecedores da Saúde" }] }),
  component: Painel,
});

type Indicadores = {
  suppliers: number | null;
  documents: number | null;
  expired: number | null;
  expiring: number | null;
  contractsExpired: number | null;
  contractsExpiring: number | null;
  members: number | null;
  generated: number | null;
  stalledProcesses: ProcessoParado[] | null;
  pipeline: ResumoEsteiraPainel | null;
  prontidao: ResultadoProntidaoSecretaria | null;
};

function Painel() {
  const { session } = useAuth();
  const { selecionado, loading: carregandoTenant, bancoPendente, erro: erroTenant } = useTenant();
  const [indicadores, setIndicadores] = useState<Indicadores>({
    suppliers: null,
    documents: null,
    expired: null,
    expiring: null,
    contractsExpired: null,
    contractsExpiring: null,
    members: null,
    generated: null,
    stalledProcesses: null,
    pipeline: null,
    prontidao: null,
  });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const requisicaoRef = useRef(0);

  const moduloFornecedores = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "fornecedores")
    : false;
  const moduloDocumentos = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "documentos")
    : false;
  const moduloProcessos = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "processos")
    : false;

  const carregar = useCallback(async () => {
    const req = ++requisicaoRef.current;
    if (!selecionado?.id) {
      setIndicadores({
        suppliers: null,
        documents: null,
        expired: null,
        expiring: null,
        contractsExpired: null,
        contractsExpiring: null,
        members: null,
        generated: null,
        stalledProcesses: null,
        pipeline: null,
        prontidao: null,
      });
      setErro(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErro(null);
    const agora = new Date();
    const dataLimite = new Date(agora);
    dataLimite.setDate(dataLimite.getDate() + 30);
    const hoje = dataHojeLocalISO(agora);
    const limite = dataHojeLocalISO(dataLimite);
    const cutoffParalisacao = new Date(
      agora.getTime() - DIAS_PROCESSO_PARADO * 86_400_000,
    ).toISOString();

    const okEmpty = Promise.resolve({ error: null, count: null as number | null });

    const [s, d, expired, expiring, cExpired, cExpiring, m, g, tenantRes, complianceRes] =
      await Promise.all([
        moduloFornecedores
          ? db
              .from("suppliers")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", selecionado.id)
          : okEmpty,
        moduloDocumentos
          ? db
              .from("supplier_documents")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", selecionado.id)
              .eq("status", "active")
          : okEmpty,
        moduloDocumentos
          ? db
              .from("supplier_documents")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", selecionado.id)
              .eq("status", "active")
              .not("expires_at", "is", null)
              .lt("expires_at", hoje)
          : okEmpty,
        moduloDocumentos
          ? db
              .from("supplier_documents")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", selecionado.id)
              .eq("status", "active")
              .not("expires_at", "is", null)
              .gte("expires_at", hoje)
              .lte("expires_at", limite)
          : okEmpty,
        db
          .from("contracts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", selecionado.id)
          .eq("status", "vigente")
          .lt("end_date", hoje),
        db
          .from("contracts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", selecionado.id)
          .eq("status", "vigente")
          .gte("end_date", hoje)
          .lte("end_date", limite),
        db
          .from("tenant_memberships")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", selecionado.id)
          .eq("status", "active"),
        moduloDocumentos
          ? db
              .from("generated_documents")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", selecionado.id)
          : okEmpty,
        db
          .from("tenants")
          .select("trade_name, manager_name, ibge_code")
          .eq("id", selecionado.id)
          .maybeSingle(),
        db
          .from("tenant_procurement_compliance")
          .select("id")
          .eq("tenant_id", selecionado.id)
          .maybeSingle(),
      ]);

    let stalledProcesses: ProcessoParado[] | null = null;
    let pipeline: ResumoEsteiraPainel | null = null;
    let processError: string | null = null;

    if (moduloProcessos) {
      try {
        const processosRows = await carregarTodasAsPaginas<ProcessoResumoPainel>((from, to) =>
          db
            .from("procurement_processes")
            .select(
              "id, number, title, stage, status, responsible_user_id, responsible_name, estimated_value, due_date, updated_at",
            )
            .eq("tenant_id", selecionado.id)
            .neq("status", "concluido")
            .neq("status", "arquivado")
            .order("updated_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        );

        if (req !== requisicaoRef.current) return;

        pipeline = resumirEsteiraProcessos(processosRows, session?.user.id);
        const processosParadosCandidatos = processosRows.filter(
          (p) => p.updated_at < cutoffParalisacao,
        );

        if (processosParadosCandidatos.length === 0) {
          stalledProcesses = [];
        } else {
          const atividades: Array<{ process_id: string; updated_at: string }> = [];
          for (let i = 0; i < processosParadosCandidatos.length; i += 100) {
            const idsChunk = processosParadosCandidatos.slice(i, i + 100).map((p) => p.id);
            const chunkRows = await carregarTodasAsPaginas<{
              process_id: string;
              updated_at: string;
            }>((from, to) =>
              db
                .from("process_items")
                .select("process_id, updated_at")
                .eq("tenant_id", selecionado.id)
                .in("process_id", idsChunk)
                .order("id")
                .range(from, to),
            );
            atividades.push(...chunkRows);
          }
          if (req !== requisicaoRef.current) return;
          stalledProcesses = listarProcessosParados(
            processosParadosCandidatos,
            atividades,
            agora,
          );
        }
      } catch (err) {
        processError = err instanceof Error ? err.message : String(err);
      }
    }

    if (req !== requisicaoRef.current) return;

    const failures = [s, d, expired, expiring, m, g]
      .filter((x) => x.error)
      .map((x) => x.error?.message ?? "");
    if (processError) failures.push(processError);

    const prontidao =
      !tenantRes.error && !complianceRes.error
        ? avaliarProntidaoSecretaria(tenantRes.data, Boolean(complianceRes.data))
        : null;

    setIndicadores({
      suppliers: !moduloFornecedores || s.error ? null : (s.count ?? 0),
      documents: !moduloDocumentos || d.error ? null : (d.count ?? 0),
      expired: !moduloDocumentos || expired.error ? null : (expired.count ?? 0),
      expiring: !moduloDocumentos || expiring.error ? null : (expiring.count ?? 0),
      contractsExpired: cExpired.error ? null : (cExpired.count ?? 0),
      contractsExpiring: cExpiring.error ? null : (cExpiring.count ?? 0),
      members: m.error ? null : (m.count ?? 0),
      generated: !moduloDocumentos || g.error ? null : (g.count ?? 0),
      stalledProcesses,
      pipeline,
      prontidao,
    });
    if (failures.length) {
      setErro("Alguns indicadores não puderam ser consultados com as permissões deste perfil.");
    }
    setLoading(false);
  }, [selecionado?.id, moduloFornecedores, moduloDocumentos, moduloProcessos, session?.user.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregandoTenant)
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  const metricas = [
    {
      label: "Fornecedores cadastrados",
      value: indicadores.suppliers,
      icon: Truck,
      href: "/fornecedores",
      action: "Ver fornecedores",
      helper: "Base cadastral da Secretaria",
    },
    {
      label: "Documentos ativos",
      value: indicadores.documents,
      icon: FileText,
      href: "/documentos",
      action: "Ver documentos",
      helper: "Registros disponíveis",
    },
    {
      label: "Servidores vinculados",
      value: indicadores.members,
      icon: Users,
      href: "/usuarios",
      action: "Ver equipe",
      helper: "Acessos ativos",
    },
    {
      label: "Documentos gerados",
      value: indicadores.generated,
      icon: ClipboardList,
      href: "/documentos",
      action: "Abrir histórico",
      helper: "Produção documental",
    },
  ] as const;

  return (
    <main className="mx-auto w-full max-w-[1480px] space-y-8 pb-10">
      <section className="relative isolate overflow-hidden rounded-[28px] border border-primary/30 bg-primary px-5 py-7 text-primary-foreground shadow-[0_22px_60px_-38px_rgba(0,0,0,0.5)] sm:px-8 sm:py-9 lg:px-10 lg:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-32 size-[340px] rounded-full border border-primary-foreground/15"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-20 size-[260px] rounded-full border border-primary-foreground/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-150px] right-1/4 size-[310px] rounded-full bg-primary-foreground/5 blur-3xl"
        />
        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(250px,0.6fr)] lg:items-end">
          <div className="max-w-2xl space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
              <Activity className="size-3.5" aria-hidden="true" />
              Central de operações
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-primary-foreground/75">
                Primus Gestão · Saúde Pública
              </p>
              <h1 className="max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-[2.65rem]">
                Seu trabalho, com mais clareza.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/85 sm:text-base">
                Acompanhe as prioridades do dia, os prazos e o andamento da gestão em um só lugar.
              </p>
            </div>
            <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-2 text-sm">
              <Building2 className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium">
                {selecionado?.nome ?? "Selecione uma Secretaria"}
              </span>
            </div>
          </div>
          {selecionado && (
            <div
              className="rounded-2xl border border-primary-foreground/20 bg-primary-foreground/10 p-4 backdrop-blur-sm sm:p-5"
              aria-label="Radar de prazos da Secretaria"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground/80">
                  Radar de prazos
                </p>
                <CalendarClock className="size-4 text-primary-foreground/75" aria-hidden="true" />
              </div>
              <div className="mt-4 grid grid-cols-2 divide-x divide-primary-foreground/20">
                <div className="pr-4">
                  <p className="text-3xl font-bold tabular-nums sm:text-4xl">
                    {loading
                      ? "…"
                      : indicadores.expired === null && indicadores.contractsExpired === null
                        ? "—"
                        : (indicadores.expired ?? 0) + (indicadores.contractsExpired ?? 0)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-primary-foreground/80">
                    Itens vencidos
                  </p>
                  <p className="text-[11px] text-primary-foreground/65">
                    {indicadores.expired ?? 0} cert. · {indicadores.contractsExpired ?? 0} contr.
                  </p>
                </div>
                <div className="pl-4">
                  <p className="text-3xl font-bold tabular-nums sm:text-4xl">
                    {loading
                      ? "…"
                      : indicadores.expiring === null && indicadores.contractsExpiring === null
                        ? "—"
                        : (indicadores.expiring ?? 0) + (indicadores.contractsExpiring ?? 0)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-primary-foreground/80">
                    Vencem em 30 dias
                  </p>
                  <p className="text-[11px] text-primary-foreground/65">
                    {indicadores.expiring ?? 0} cert. · {indicadores.contractsExpiring ?? 0} contr.
                  </p>
                </div>
              </div>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="mt-5 w-full justify-between rounded-xl bg-primary-foreground px-4 text-primary hover:bg-primary-foreground/95"
              >
                <Link to="/documentos">
                  Consultar vencimentos
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>

      {bancoPendente && (
        <Alert variant="destructive">
          <AlertTitle>Estrutura pendente</AlertTitle>
          <AlertDescription>O banco ainda não está disponível para esta conta.</AlertDescription>
        </Alert>
      )}
      {erroTenant && (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar organizações</AlertTitle>
          <AlertDescription>{erroTenant}</AlertDescription>
        </Alert>
      )}
      {!selecionado ? (
        <Alert>
          <AlertTitle>Nenhuma Secretaria selecionada</AlertTitle>
          <AlertDescription>
            O administrador global pode criar uma Secretaria em Organizações. O usuário municipal
            precisa ser vinculado para acessar os módulos.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {erro && (
            <Alert>
              <AlertTitle>Indicadores parciais</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}

          {indicadores.prontidao && !indicadores.prontidao.pronta && (
            <Alert className="border-amber-500/35 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Ficha da Secretaria pendente para a Lei nº 14.133/2021</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Faltando: {indicadores.prontidao.pendencias.join(", ")}.
                </span>
                <Link
                  to="/configuracoes"
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  Completar em Configurações <ArrowUpRight className="size-3.5" />
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {session?.user.id && <MyTasks tenantId={selecionado.id} userId={session.user.id} />}

          {moduloProcessos && indicadores.pipeline && indicadores.pipeline.totalAtivos > 0 && (
            <ExecutivePipelineCard resumo={indicadores.pipeline} />
          )}

          <section aria-labelledby="indicadores-titulo" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-primary">
                  Visão da Secretaria
                </p>
                <h2
                  id="indicadores-titulo"
                  className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl"
                >
                  Indicadores de gestão
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Os principais números da operação, organizados para consulta rápida.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                <Activity className="size-3.5" aria-hidden="true" />
                Dados da Secretaria ativa
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricas.map((metrica) => {
                const Icon = metrica.icon;
                return (
                  <Card
                    key={metrica.label}
                    className="group overflow-hidden rounded-2xl border-border/75 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
                  >
                    <CardContent className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex size-11 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary">
                          <Icon className="size-5" aria-hidden="true" />
                        </div>
                        <ArrowUpRight
                          className="size-4 text-muted-foreground/55 transition-colors group-hover:text-primary"
                          aria-hidden="true"
                        />
                      </div>
                      <p className="mt-5 text-xs font-medium text-muted-foreground">
                        {metrica.label}
                      </p>
                      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                        {loading ? "…" : (metrica.value ?? "—")}
                      </p>
                      <div className="mt-4 border-t border-border/70 pt-3">
                        <Link
                          to={metrica.href}
                          className="inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                        >
                          {metrica.action}
                          <ArrowRight className="size-3.5" aria-hidden="true" />
                        </Link>
                        <p className="text-[11px] text-muted-foreground">{metrica.helper}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="processos-parados-titulo"
            className="overflow-hidden rounded-2xl border border-border/75 bg-card shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-5 py-5 sm:px-7">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
                  <AlertTriangle className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Monitoramento de fluxo
                  </p>
                  <h2
                    id="processos-parados-titulo"
                    className="mt-0.5 text-lg font-semibold tracking-tight"
                  >
                    Processos sem movimentação
                  </h2>
                </div>
              </div>
              <Badge variant="outline" className="bg-card">
                Mais de {DIAS_PROCESSO_PARADO} dias
              </Badge>
            </div>
            <div className="px-5 py-5 sm:px-7">
              {loading ? (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Verificando a atividade dos processos…
                </div>
              ) : !moduloProcessos ? (
                <Alert>
                  <AlertTitle>Módulo de processos desativado</AlertTitle>
                  <AlertDescription>
                    Habilite o módulo de Processos no plano desta Secretaria para acompanhar a
                    esteira de contratações e alertas de estagnação.
                  </AlertDescription>
                </Alert>
              ) : indicadores.stalledProcesses === null ? (
                <Alert>
                  <AlertTitle>Alerta indisponível</AlertTitle>
                  <AlertDescription>
                    Não foi possível consultar a atividade dos processos com as permissões atuais.
                  </AlertDescription>
                </Alert>
              ) : indicadores.stalledProcesses.length === 0 ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-success/10 text-success">
                    <CheckCircle2 className="size-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Fluxo de processos em dia</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      Não foram identificados processos ativos sem movimentação registrada há mais
                      de {DIAS_PROCESSO_PARADO} dias.
                    </p>
                  </div>
                  <Link
                    to="/processos"
                    className="inline-flex min-h-10 shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    Ver processos <ArrowUpRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {indicadores.stalledProcesses.slice(0, 5).map((processo) => (
                    <div
                      key={processo.id}
                      className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">Processo nº {processo.number}</span>
                          <Badge
                            variant="outline"
                            className="border-destructive/25 bg-destructive/10 text-destructive"
                          >
                            {processo.diasSemAtividade} dias sem movimentação
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{processo.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Etapa: {processo.stage}
                          {processo.responsible_name
                            ? ` · Responsável: ${processo.responsible_name}`
                            : ""}
                        </p>
                      </div>
                      <Link
                        to="/processos"
                        search={{ processo: processo.id } as never}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline"
                      >
                        Ver processo <ArrowUpRight className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                  ))}
                  <Link
                    to="/processos"
                    className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    Todos os processos <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
              )}
            </div>
          </section>
          <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Informações restritas à Secretaria ativa e às permissões da sua conta. Os indicadores
            refletem os registros acessíveis no momento da consulta.
          </p>
        </>
      )}
    </main>
  );
}
