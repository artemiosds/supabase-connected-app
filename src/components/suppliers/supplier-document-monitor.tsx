import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileClock, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { formatarData } from "@/lib/contratacao";
import { dataLocalIso } from "@/lib/supplier-profile";
import {
  necessitaAcompanhamentoDocumental,
  prioridadeDocumental,
  resumirMonitoramentoDocumental,
  type DocumentoMonitorado,
  type SituacaoMonitoramento,
} from "@/lib/supplier-document-monitor";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type FornecedorMonitorado = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  status: string;
};

type ResultadoConsulta = {
  tenantId: string;
  checkedAt: string;
  status: "ready" | "no_access" | "error";
  documentos: DocumentoMonitorado[];
};

type Filtro = "pendencias" | "todos" | "sem_documentos" | "sem_validade";

const ROTULOS: Record<
  SituacaoMonitoramento,
  { texto: string; variant: "destructive" | "secondary" | "outline" }
> = {
  vencido: { texto: "Documento vencido", variant: "destructive" },
  vence_hoje: { texto: "Vence hoje", variant: "secondary" },
  a_vencer: { texto: "Até 30 dias", variant: "secondary" },
  sem_documentos: { texto: "Sem documentos ativos", variant: "outline" },
  sem_validade: { texto: "Sem data de validade", variant: "outline" },
  sem_alerta: { texto: "Sem alerta de prazo", variant: "outline" },
};

export function MonitoramentoDocumentalFornecedores({
  tenantId,
  enabled,
  fornecedores,
  onAbrirFicha,
}: {
  tenantId: string;
  enabled: boolean;
  fornecedores: readonly FornecedorMonitorado[];
  onAbrirFicha: (supplierId: string) => void;
}) {
  const [consulta, setConsulta] = useState<ResultadoConsulta | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>("pendencias");
  const [mostrarTodos, setMostrarTodos] = useState(false);

  useEffect(() => {
    if (!enabled || !tenantId) return;
    // Revalida periodicamente a situação sem enviar e-mails nem modificar registros.
    let ultimaAtualizacao = Date.now();
    const tentarAtualizar = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimaAtualizacao < 5 * 60_000) return;
      ultimaAtualizacao = Date.now();
      setRefresh((valor) => valor + 1);
    };
    const timer = window.setInterval(tentarAtualizar, 60_000);
    window.addEventListener("focus", tentarAtualizar);
    document.addEventListener("visibilitychange", tentarAtualizar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tentarAtualizar);
      document.removeEventListener("visibilitychange", tentarAtualizar);
    };
  }, [enabled, tenantId]);

  useEffect(() => {
    let ativo = true;
    setConsulta(null);
    if (!tenantId || !enabled) {
      setLoading(false);
      return () => {
        ativo = false;
      };
    }

    setLoading(true);
    async function carregar() {
      try {
        // A RLS do banco protege cada linha; a permissão explícita distingue
        // "sem acesso" de "nenhum documento" (a RLS poderia retornar []).
        const { data: acesso, error: erroAcesso } = await db.rpc("get_document_capabilities", {
          p_tenant_id: tenantId,
        });
        if (erroAcesso) throw erroAcesso;
        if (!acesso?.[0]?.can_view) {
          if (ativo)
            setConsulta({
              tenantId,
              checkedAt: dataLocalIso(),
              status: "no_access",
              documentos: [],
            });
          return;
        }
        const documentos = await carregarTodasAsPaginas<DocumentoMonitorado>((inicio, fim) =>
          db
            .from("supplier_documents")
            .select("supplier_id,status,expires_at")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .order("supplier_id")
            .order("id")
            .range(inicio, fim),
        );
        if (ativo)
          setConsulta({
            tenantId,
            checkedAt: dataLocalIso(),
            status: "ready",
            documentos,
          });
      } catch {
        if (ativo)
          setConsulta({
            tenantId,
            checkedAt: dataLocalIso(),
            status: "error",
            documentos: [],
          });
      } finally {
        if (ativo) setLoading(false);
      }
    }

    void carregar();
    return () => {
      ativo = false;
    };
  }, [tenantId, enabled, refresh]);

  // Nenhum dado da Secretaria anterior aparece entre a troca e o novo carregamento.
  const atual = consulta?.tenantId === tenantId ? consulta : null;
  const hoje = dataLocalIso();
  const resumos = useMemo(
    () =>
      resumirMonitoramentoDocumental(
        fornecedores,
        atual?.status === "ready" ? atual.documentos : [],
        hoje,
      ),
    [fornecedores, atual, hoje],
  );
  const linhas = useMemo(
    () =>
      fornecedores
        .map((fornecedor) => ({ fornecedor, resumo: resumos.get(fornecedor.id)! }))
        .sort(
          (a, b) =>
            prioridadeDocumental(a.resumo.situacao) - prioridadeDocumental(b.resumo.situacao) ||
            a.fornecedor.legal_name.localeCompare(b.fornecedor.legal_name, "pt-BR"),
        ),
    [fornecedores, resumos],
  );
  const vencidos = linhas.filter((item) => item.resumo.vencidos > 0).length;
  const vencemHoje = linhas.filter((item) => item.resumo.vencemHoje > 0).length;
  const aVencer = linhas.filter((item) => item.resumo.aVencer > 0).length;
  const semDocumentos = linhas.filter((item) => item.resumo.total === 0).length;
  const filtradas = linhas.filter((item) => {
    if (filtro === "pendencias") return necessitaAcompanhamentoDocumental(item.resumo.situacao);
    if (filtro === "sem_documentos") return item.resumo.situacao === "sem_documentos";
    if (filtro === "sem_validade") return item.resumo.semValidade > 0;
    return true;
  });
  const exibidas = mostrarTodos ? filtradas : filtradas.slice(0, 12);

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="monitoramento-documental">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="monitoramento-documental" className="flex items-center gap-2 font-semibold">
            <FileClock className="h-4 w-4" aria-hidden />
            Monitoramento documental dos fornecedores
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prazos dos documentos cadastrados nesta Secretaria. Atualização periódica enquanto a página estiver aberta.
          </p>
        </div>
        {enabled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => setRefresh((valor) => valor + 1)}
          >
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
            )}
            Atualizar agora
          </Button>
        )}
      </div>

      {!enabled ? (
        <p className="text-sm text-muted-foreground">
          O módulo Documentos está desabilitado nesta Secretaria. Não é possível avaliar os prazos documentais.
        </p>
      ) : !atual || loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Verificando permissões e documentos…
        </p>
      ) : atual.status === "no_access" ? (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          Seu perfil não possui permissão para consultar documentos. A regularidade documental não foi verificada.
        </p>
      ) : atual.status === "error" ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Não foi possível consultar todos os documentos desta Secretaria. Nenhuma conclusão sobre vencimentos pode ser apresentada. Tente atualizar.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { titulo: "Fornecedores com vencidos", valor: vencidos },
              { titulo: "Com vencimento hoje", valor: vencemHoje },
              { titulo: "Com vencimento em até 30 dias", valor: aVencer },
              { titulo: "Sem documentos ativos", valor: semDocumentos },
            ].map((item) => (
              <div key={item.titulo} className="rounded-md border bg-muted/15 p-3">
                <p className="text-xs text-muted-foreground">{item.titulo}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{item.valor}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span>Exibir:</span>
              <select
                value={filtro}
                onChange={(event) => {
                  setFiltro(event.target.value as Filtro);
                  setMostrarTodos(false);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Filtrar monitoramento documental"
              >
                <option value="pendencias">Vencidos ou a vencer</option>
                <option value="sem_documentos">Sem documentos ativos</option>
                <option value="sem_validade">Com validade não informada</option>
                <option value="todos">Todos os fornecedores</option>
              </select>
            </label>
            <span className="text-xs text-muted-foreground">
              Conferido em {formatarData(atual.checkedAt)} · {filtradas.length} fornecedor(es) no filtro
            </span>
          </div>

          {filtradas.length === 0 ? (
            <p className="rounded-md border bg-muted/15 p-3 text-sm text-muted-foreground">
              {filtro === "pendencias"
                ? "Nenhum vencimento identificado nos próximos 30 dias ou já vencido, entre os documentos ativos acessíveis."
                : "Nenhum fornecedor encontrado neste filtro."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead className="hidden sm:table-cell">Documentos ativos</TableHead>
                    <TableHead className="hidden md:table-cell">Menor validade</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exibidas.map(({ fornecedor, resumo }) => (
                    <TableRow key={fornecedor.id}>
                      <TableCell>
                        <span className="font-medium">{fornecedor.legal_name}</span>
                        {fornecedor.status !== "active" && (
                          <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                        )}
                        {fornecedor.trade_name && (
                          <p className="text-xs text-muted-foreground">{fornecedor.trade_name}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ROTULOS[resumo.situacao].variant}>
                          {ROTULOS[resumo.situacao].texto}
                        </Badge>
                        {resumo.semValidade > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {resumo.semValidade} sem data de validade
                          </p>
                        )}
                        {resumo.vencidos > 0 && (
                          <p className="mt-1 text-xs text-destructive">
                            {resumo.vencidos} documento(s) vencido(s)
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{resumo.total}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {resumo.vencimentoMaisProximo
                          ? formatarData(resumo.vencimentoMaisProximo)
                          : "Não informada"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => onAbrirFicha(fornecedor.id)}>
                          Ficha 360º
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {filtradas.length > 12 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setMostrarTodos(!mostrarTodos)}>
              {mostrarTodos ? "Mostrar apenas 12" : "Mostrar todos os resultados"}
            </Button>
          )}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Monitoramento de prazos, não certidão de regularidade fiscal. A ausência de documentos,
            a falta de data de validade ou de acesso não comprova situação regular. Os e-mails
            automáticos dependem da configuração da rotina existente.
          </p>
        </>
      )}
    </section>
  );
}
