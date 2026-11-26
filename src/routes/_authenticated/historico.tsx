import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Filter, Loader2, ShieldCheck } from "lucide-react";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { isCommercialModuleEnabled } from "@/lib/commercial-access";
import {
  resumirDetalhesAuditoria,
  rotuloAcaoAuditoria,
  rotuloEntidadeAuditoria,
  type AuditEventRowLike,
} from "@/lib/audit-history-helper";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import type { CsvColumn } from "@/lib/csv-export";
import { dataHojeLocalISO } from "@/lib/contratacao";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({ meta: [{ title: "Histórico e auditoria — Gestão de Fornecedores da Saúde" }] }),
  component: Historico,
});

function Historico() {
  const { selecionado } = useTenant();
  const [eventos, setEventos] = useState<AuditEventRowLike[]>([]);
  const [atores, setAtores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroEntidade, setFiltroEntidade] = useState("todas");
  const [filtroAcao, setFiltroAcao] = useState("todas");
  const [filtroPeriodo, setFiltroPeriodo] = useState<"todos" | "7d" | "30d" | "ano_atual">("30d");

  const requisicaoRef = useRef(0);
  const moduloAuditoriaAtivo = selecionado
    ? isCommercialModuleEnabled(selecionado.enabled_modules, "auditoria")
    : false;

  useEffect(() => {
    const req = ++requisicaoRef.current;

    async function carregar() {
      if (!selecionado?.id || !moduloAuditoriaAtivo) {
        if (req === requisicaoRef.current) {
          setEventos([]);
          setAtores({});
          setErro(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setErro(null);
      try {
        const rows = await carregarTodasAsPaginas<AuditEventRowLike>((from, to) =>
          db
            .from("audit_events")
            .select("id,action,actor_id,created_at,details,entity,entity_id")
            .eq("tenant_id", selecionado.id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        );

        if (req !== requisicaoRef.current) return;
        setEventos(rows);

        const actorIds = Array.from(
          new Set(rows.map((e) => e.actor_id).filter((id): id is string => Boolean(id))),
        );
        const actorMap: Record<string, string> = {};
        for (let i = 0; i < actorIds.length; i += 100) {
          const chunk = actorIds.slice(i, i + 100);
          const { data: profilesData } = await db
            .from("profiles")
            .select("id,full_name")
            .in("id", chunk);
          for (const p of profilesData ?? []) {
            if (p.full_name?.trim()) actorMap[p.id] = p.full_name.trim();
          }
        }
        if (req === requisicaoRef.current) setAtores(actorMap);
      } catch (error) {
        if (req !== requisicaoRef.current) return;
        setEventos([]);
        setErro(error instanceof Error ? error.message : String(error));
      } finally {
        if (req === requisicaoRef.current) setLoading(false);
      }
    }

    void carregar();
  }, [selecionado?.id, moduloAuditoriaAtivo]);

  const entidadesDisponiveis = useMemo(
    () => Array.from(new Set(eventos.map((e) => e.entity))).sort(),
    [eventos],
  );
  const acoesDisponiveis = useMemo(
    () => Array.from(new Set(eventos.map((e) => e.action))).sort(),
    [eventos],
  );

  const eventosFiltrados = useMemo(() => {
    const hoje = dataHojeLocalISO();
    const anoAtual = new Date().getFullYear();
    const limite7d = dataHojeLocalISO(new Date(Date.now() - 7 * 86_400_000));
    const limite30d = dataHojeLocalISO(new Date(Date.now() - 30 * 86_400_000));
    const termo = busca.trim().toLocaleLowerCase("pt-BR");

    return eventos.filter((e) => {
      if (filtroEntidade !== "todas" && e.entity !== filtroEntidade) return false;
      if (filtroAcao !== "todas" && e.action !== filtroAcao) return false;

      const eventDate = e.created_at.slice(0, 10);
      if (filtroPeriodo === "7d" && eventDate < limite7d) return false;
      if (filtroPeriodo === "30d" && eventDate < limite30d) return false;
      if (filtroPeriodo === "ano_atual" && (eventDate < `${anoAtual}-01-01` || eventDate > hoje))
        return false;

      if (!termo) return true;
      const atorNome = e.actor_id ? (atores[e.actor_id] ?? e.actor_id) : "sistema";
      const { camposAlterados, destaques } = resumirDetalhesAuditoria(e.details);
      const texto = [
        rotuloEntidadeAuditoria(e.entity),
        rotuloAcaoAuditoria(e.action),
        e.entity_id ?? "",
        atorNome,
        ...camposAlterados,
        ...destaques,
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      return texto.includes(termo);
    });
  }, [eventos, filtroEntidade, filtroAcao, filtroPeriodo, busca, atores]);

  const colunasExportacao: CsvColumn<AuditEventRowLike>[] = [
    {
      header: "Data/Hora",
      value: (e) => new Date(e.created_at).toLocaleString("pt-BR"),
    },
    { header: "Entidade", value: (e) => rotuloEntidadeAuditoria(e.entity) },
    { header: "Operação", value: (e) => rotuloAcaoAuditoria(e.action) },
    { header: "Registro", value: (e) => e.entity_id ?? "—" },
    {
      header: "Ator",
      value: (e) => (e.actor_id ? (atores[e.actor_id] ?? e.actor_id) : "Sistema"),
    },
    {
      header: "Detalhes",
      value: (e) => {
        const { destaques, camposAlterados } = resumirDetalhesAuditoria(e.details);
        return [
          ...destaques,
          camposAlterados.length ? `Campos: ${camposAlterados.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
      },
    },
  ];

  if (!selecionado)
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>O histórico é isolado por Secretaria.</AlertDescription>
      </Alert>
    );

  if (!moduloAuditoriaAtivo)
    return (
      <Alert>
        <AlertTitle>Módulo de auditoria indisponível</AlertTitle>
        <AlertDescription>
          O plano ativo desta Secretaria não habilita a consulta de histórico e trilha de auditoria.
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Histórico e auditoria</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Trilha completa de alterações e operações de {selecionado.nome}.
          </p>
        </div>
        <ReportExportActions
          title={`Histórico e auditoria — ${selecionado.nome}`}
          filename={`auditoria-${dataHojeLocalISO()}`}
          columns={colunasExportacao}
          rows={eventosFiltrados}
          disabled={loading}
        />
      </div>

      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Atividade registrada{" "}
              <Badge variant="secondary">{eventosFiltrados.length}</Badge>
              {eventosFiltrados.length !== eventos.length && (
                <span className="text-xs font-normal text-muted-foreground">
                  de {eventos.length} no total
                </span>
              )}
            </CardTitle>
            {(busca ||
              filtroEntidade !== "todas" ||
              filtroAcao !== "todas" ||
              filtroPeriodo !== "30d") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBusca("");
                  setFiltroEntidade("todas");
                  setFiltroAcao("todas");
                  setFiltroPeriodo("30d");
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar ator, registro, motivo…"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Select value={filtroEntidade} onValueChange={setFiltroEntidade}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Entidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as entidades</SelectItem>
                {entidadesDisponiveis.map((entity) => (
                  <SelectItem key={entity} value={entity}>
                    {rotuloEntidadeAuditoria(entity)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroAcao} onValueChange={setFiltroAcao}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Operação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as operações</SelectItem>
                {acoesDisponiveis.map((action) => (
                  <SelectItem key={action} value={action}>
                    {rotuloAcaoAuditoria(action)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filtroPeriodo}
              onValueChange={(value) =>
                setFiltroPeriodo(value as "todos" | "7d" | "30d" | "ano_atual")
              }
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="ano_atual">Exercício {new Date().getFullYear()}</SelectItem>
                <SelectItem value="todos">Todo o histórico</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : erro ? (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível consultar o histórico</AlertTitle>
              <AlertDescription>
                {erro.includes("permission") || erro.includes("policy")
                  ? "Seu perfil não possui permissão de auditoria nesta Secretaria."
                  : erro}
              </AlertDescription>
            </Alert>
          ) : eventosFiltrados.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum evento encontrado com os filtros aplicados.
            </div>
          ) : (
            <div className="divide-y">
              {eventosFiltrados.map((e) => {
                const { camposAlterados, destaques } = resumirDetalhesAuditoria(e.details);
                const atorRotulo = e.actor_id
                  ? (atores[e.actor_id] ?? `Usuário (${e.actor_id.slice(0, 8)}…)`)
                  : "Sistema";
                return (
                  <div
                    key={e.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {rotuloEntidadeAuditoria(e.entity)}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {rotuloAcaoAuditoria(e.action)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Ator: <span className="font-medium text-foreground">{atorRotulo}</span> ·
                        Registro: {e.entity_id ?? "—"}
                      </p>
                      {destaques.length > 0 && (
                        <p className="text-xs text-muted-foreground">{destaques.join(" · ")}</p>
                      )}
                      {camposAlterados.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Campos alterados: {camposAlterados.join(", ")}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> A consulta respeita a permissão de auditoria e o
        isolamento da Secretaria no banco de dados.
      </p>
    </div>
  );
}
