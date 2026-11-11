import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Building2, FileText, Loader2, Truck, Users, AlertTriangle, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { db } from "@/lib/db";
import {
  DIAS_PROCESSO_PARADO,
  listarProcessosParados,
  type ProcessoParado,
} from "@/lib/process-stagnation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({ meta: [{ title: "Painel — Gestão de Fornecedores da Saúde" }] }),
  component: Painel,
});

type Indicadores = {
  suppliers: number | null;
  documents: number | null;
  expired: number | null;
  expiring: number | null;
  members: number | null;
  generated: number | null;
  stalledProcesses: ProcessoParado[] | null;
};

function dataLocalISO(data: Date): string {
  return new Date(data.getTime() - data.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Painel() {
  const { session } = useAuth();
  const { selecionado, loading: carregandoTenant, bancoPendente, erro: erroTenant } = useTenant();
  const [indicadores, setIndicadores] = useState<Indicadores>({
    suppliers: null,
    documents: null,
    expired: null,
    expiring: null,
    members: null,
    generated: null,
    stalledProcesses: null,
  });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setIndicadores({
        suppliers: null,
        documents: null,
        expired: null,
        expiring: null,
        members: null,
        generated: null,
        stalledProcesses: null,
      });
      return;
    }
    setLoading(true);
    setErro(null);
    const agora = new Date();
    const dataLimite = new Date(agora);
    dataLimite.setDate(dataLimite.getDate() + 30);
    const hoje = dataLocalISO(agora);
    const limite = dataLocalISO(dataLimite);
    const cutoffParalisacao = new Date(
      agora.getTime() - DIAS_PROCESSO_PARADO * 86_400_000,
    ).toISOString();
    const [s, d, expired, expiring, m, g, processosParados] = await Promise.all([
      db
        .from("suppliers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", selecionado.id),
      db
        .from("supplier_documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", selecionado.id)
        .eq("status", "active"),
      db
        .from("supplier_documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", selecionado.id)
        .eq("status", "active")
        .not("expires_at", "is", null)
        .lt("expires_at", hoje),
      db
        .from("supplier_documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", selecionado.id)
        .eq("status", "active")
        .not("expires_at", "is", null)
        .gte("expires_at", hoje)
        .lte("expires_at", limite),
      db
        .from("tenant_memberships")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", selecionado.id)
        .eq("status", "active"),
      db
        .from("generated_documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", selecionado.id),
      db
        .from("procurement_processes")
        .select("id, number, title, stage, status, responsible_name, updated_at")
        .eq("tenant_id", selecionado.id)
        .neq("status", "concluido")
        .neq("status", "arquivado")
        .lt("updated_at", cutoffParalisacao)
        .order("updated_at", { ascending: true })
        .limit(100),
    ]);
    let stalledProcesses: ProcessoParado[] | null = null;
    let activityError: string | null = null;
    if (!processosParados.error) {
      const ids = (processosParados.data ?? []).map((processo) => processo.id);
      if (ids.length === 0) {
        stalledProcesses = [];
      } else {
        const atividades = await db
          .from("process_items")
          .select("process_id, updated_at")
          .eq("tenant_id", selecionado.id)
          .in("process_id", ids);
        activityError = atividades.error?.message ?? null;
        if (!atividades.error) {
          stalledProcesses = listarProcessosParados(
            processosParados.data ?? [],
            atividades.data ?? [],
            agora,
          );
        }
      }
    }
    const failures = [s, d, expired, expiring, m, g, processosParados]
      .filter((x) => x.error)
      .map((x) => x.error?.message ?? "");
    if (activityError) failures.push(activityError);
    setIndicadores({
      suppliers: s.error ? null : (s.count ?? 0),
      documents: d.error ? null : (d.count ?? 0),
      expired: expired.error ? null : (expired.count ?? 0),
      expiring: expiring.error ? null : (expiring.count ?? 0),
      members: m.error ? null : (m.count ?? 0),
      generated: g.error ? null : (g.count ?? 0),
      stalledProcesses,
    });
    if (failures.length)
      setErro("Alguns indicadores não puderam ser consultados com as permissões deste perfil.");
    setLoading(false);
  }, [selecionado?.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregandoTenant)
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Painel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selecionado
              ? `Visão geral de ${selecionado.nome}`
              : `Bem-vindo(a), ${session?.user.email}.`}
          </p>
        </div>
        {selecionado && <Badge variant="secondary">Secretaria selecionada</Badge>}
      </div>
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Fornecedores
                </CardTitle>
                <Truck className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {loading ? "…" : (indicadores.suppliers ?? "—")}
                </p>
                <Link to="/fornecedores" className="text-xs text-primary hover:underline">
                  Abrir cadastro
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Documentos ativos
                </CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {loading ? "…" : (indicadores.documents ?? "—")}
                </p>
                <Link to="/documentos" className="text-xs text-primary hover:underline">
                  Ver documentos
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Documentos vencidos
                </CardTitle>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-destructive">
                  {loading ? "…" : (indicadores.expired ?? "—")}
                </p>
                <Link to="/documentos" className="text-xs text-primary hover:underline">
                  Regularizar
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Vencem em 30 dias
                </CardTitle>
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {loading ? "…" : (indicadores.expiring ?? "—")}
                </p>
                <Link to="/documentos" className="text-xs text-primary hover:underline">
                  Ver prazos
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Usuários ativos
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {loading ? "…" : (indicadores.members ?? "—")}
                </p>
                <Link to="/usuarios" className="text-xs text-primary hover:underline">
                  Gerenciar acessos
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Documentos gerados
                </CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {loading ? "…" : (indicadores.generated ?? "—")}
                </p>
                <Link to="/documentos" className="text-xs text-primary hover:underline">
                  Abrir histórico
                </Link>
              </CardContent>
            </Card>
          </div>
          <section aria-labelledby="processos-parados-titulo">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="processos-parados-titulo" className="text-lg font-semibold">
                Processos sem movimentação
              </h2>
              <Badge variant="outline">Mais de {DIAS_PROCESSO_PARADO} dias</Badge>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Verificando a atividade dos processos…
              </p>
            ) : indicadores.stalledProcesses === null ? (
              <Alert>
                <AlertTitle>Alerta indisponível</AlertTitle>
                <AlertDescription>
                  Não foi possível consultar a atividade dos processos com as permissões atuais.
                </AlertDescription>
              </Alert>
            ) : indicadores.stalledProcesses.length === 0 ? (
              <Alert>
                <AlertTitle>Nenhum processo parado</AlertTitle>
                <AlertDescription>
                  Não há processos ativos sem atividade registrada há mais de {DIAS_PROCESSO_PARADO}{" "}
                  dias.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {indicadores.stalledProcesses.slice(0, 5).map((processo) => (
                  <Alert key={processo.id} variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      {"Processo nº " +
                        processo.number +
                        " parado há " +
                        processo.diasSemAtividade +
                        " dias"}
                    </AlertTitle>
                    <AlertDescription className="space-y-1">
                      <span className="block">{processo.title}</span>
                      <span className="block">
                        {"Etapa: " + processo.stage}
                        {processo.responsible_name
                          ? " · Responsável: " + processo.responsible_name
                          : ""}
                      </span>
                    </AlertDescription>
                  </Alert>
                ))}
                <Link
                  to="/processos"
                  className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
                >
                  Abrir processos
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
