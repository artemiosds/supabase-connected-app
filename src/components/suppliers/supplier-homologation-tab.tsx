import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  PlusCircle,
  FileCheck2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
  FileText,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
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
import {
  listarHomologacoesFornecedor,
  carregarItensChecklist,
  carregarEventosHomologacao,
  iniciarAnaliseHomologacao,
  atualizarItemChecklist,
  solicitarComplementacao,
  concluirAnaliseHomologacao,
  rotuloStatusHomologacao,
  rotuloConclusao,
  rotuloStatusChecklist,
  type SupplierHomologation,
  type HomologationChecklistItem,
  type HomologationEvent,
  type ConclusionStatus,
  type ChecklistVerificationStatus,
} from "@/lib/supplier-homologation";
import { formatarData } from "@/lib/contratacao";

interface SupplierHomologationTabProps {
  tenantId: string;
  supplierId: string;
  supplierCategory: string;
  canEdit?: boolean;
}

export function SupplierHomologationTab({
  tenantId,
  supplierId,
  supplierCategory,
  canEdit = true,
}: SupplierHomologationTabProps) {
  const [homologacoes, setHomologacoes] = useState<SupplierHomologation[]>([]);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<HomologationChecklistItem[]>([]);
  const [eventos, setEventos] = useState<HomologationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Modais
  const [modalNovaAberta, setModalNovaAberta] = useState(false);
  const [modalConclusaoAberta, setModalConclusaoAberta] = useState(false);
  const [modalComplementacaoAberta, setModalComplementacaoAberta] = useState(false);

  // Form Nova Análise
  const [novaCategoria, setNovaCategoria] = useState(supplierCategory || "geral");
  const [novoEscopo, setNovoEscopo] = useState("");
  const [salvandoNova, setSalvandoNova] = useState(false);

  // Form Conclusão
  const [conclusaoStatus, setConclusaoStatus] = useState<ConclusionStatus>("regular");
  const [conclusaoNotas, setConclusaoNotas] = useState("");
  const [salvandoConclusao, setSalvandoConclusao] = useState(false);

  // Form Complementação
  const [exigenciasComplementacao, setExigenciasComplementacao] = useState("");
  const [salvandoComplementacao, setSalvandoComplementacao] = useState(false);

  // Form Conferência de Item
  const [itemEmEdicao, setItemEmEdicao] = useState<HomologationChecklistItem | null>(null);
  const [statusConferencia, setStatusConferencia] = useState<ChecklistVerificationStatus>("verified");
  const [notasConferencia, setNotasConferencia] = useState("");
  const [salvandoItem, setSalvandoItem] = useState(false);

  const carregarLista = useCallback(async () => {
    try {
      setLoading(true);
      setErro(null);
      const lista = await listarHomologacoesFornecedor(tenantId, supplierId);
      setHomologacoes(lista);
      if (lista.length > 0 && (!selecionadaId || !lista.some((h) => h.id === selecionadaId))) {
        setSelecionadaId(lista[0].id);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar análises de homologação.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supplierId, selecionadaId]);

  const carregarDetalhes = useCallback(
    async (homologationId: string) => {
      try {
        setLoadingDetalhes(true);
        const [itens, logs] = await Promise.all([
          carregarItensChecklist(tenantId, homologationId),
          carregarEventosHomologacao(tenantId, homologationId),
        ]);
        setChecklist(itens);
        setEventos(logs);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar checklist e histórico.");
      } finally {
        setLoadingDetalhes(false);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);

  useEffect(() => {
    if (selecionadaId) {
      void carregarDetalhes(selecionadaId);
    } else {
      setChecklist([]);
      setEventos([]);
    }
  }, [selecionadaId, carregarDetalhes]);

  const handleIniciarNova = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoEscopo.trim()) return;
    try {
      setSalvandoNova(true);
      const id = await iniciarAnaliseHomologacao({
        tenantId,
        supplierId,
        category: novaCategoria,
        scopeDescription: novoEscopo.trim(),
      });
      setModalNovaAberta(false);
      setNovoEscopo("");
      await carregarLista();
      setSelecionadaId(id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao abrir análise de homologação.");
    } finally {
      setSalvandoNova(false);
    }
  };

  const handleConcluir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selecionadaId) return;
    try {
      setSalvandoConclusao(true);
      await concluirAnaliseHomologacao({
        tenantId,
        homologationId: selecionadaId,
        conclusionStatus: conclusaoStatus,
        conclusionNotes: conclusaoNotas.trim(),
      });
      setModalConclusaoAberta(false);
      setConclusaoNotas("");
      await carregarLista();
      await carregarDetalhes(selecionadaId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao concluir homologação.");
    } finally {
      setSalvandoConclusao(false);
    }
  };

  const handleSolicitarComplementacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selecionadaId || !exigenciasComplementacao.trim()) return;
    try {
      setSalvandoComplementacao(true);
      await solicitarComplementacao({
        tenantId,
        homologationId: selecionadaId,
        exigencias: exigenciasComplementacao.trim(),
      });
      setModalComplementacaoAberta(false);
      setExigenciasComplementacao("");
      await carregarLista();
      await carregarDetalhes(selecionadaId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao solicitar complementação.");
    } finally {
      setSalvandoComplementacao(false);
    }
  };

  const handleSalvarItemChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selecionadaId || !itemEmEdicao) return;
    try {
      setSalvandoItem(true);
      await atualizarItemChecklist({
        tenantId,
        homologationId: selecionadaId,
        itemId: itemEmEdicao.id,
        verificationStatus: statusConferencia,
        notes: notasConferencia.trim() || undefined,
        documentId: itemEmEdicao.document_id,
      });
      setItemEmEdicao(null);
      await carregarDetalhes(selecionadaId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao atualizar item do checklist.");
    } finally {
      setSalvandoItem(false);
    }
  };

  const analiseAtiva = homologacoes.find((h) => h.id === selecionadaId);

  return (
    <div className="space-y-4">
      {erro && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Cabeçalho com ações principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Homologação e Habilitação de Fornecedores</h3>
          <p className="text-xs text-muted-foreground">
            Fluxo formal de análise documental, conferência de certidões, exigências e parecer
            conclusivo com histórico imutável.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={carregarLista} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setModalNovaAberta(true)}>
              <PlusCircle className="mr-1.5 h-4 w-4" />
              Iniciar Análise
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Carregando análises...</div>
      ) : homologacoes.length === 0 ? (
        <Card className="border-dashed py-8 text-center">
          <CardContent className="space-y-3">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <div>
              <p className="font-medium">Nenhuma análise de homologação iniciada</p>
              <p className="text-xs text-muted-foreground">
                Inicie uma análise para aplicar o checklist documental inteligente, registrar conferências
                e emitir parecer de regularidade.
              </p>
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setModalNovaAberta(true)}>
                <PlusCircle className="mr-1.5 h-4 w-4" />
                Iniciar Análise de Habilitação
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Coluna 1: Lista de Análises Realizadas */}
          <Card className="lg:col-span-1">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Histórico de Análises</CardTitle>
              <CardDescription className="text-xs">
                Selecione uma análise para visualizar ou tramitar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-2">
              {homologacoes.map((h) => {
                const statusMeta = rotuloStatusHomologacao(h.status);
                const conclusaoMeta = rotuloConclusao(h.conclusion_status);
                const isSelected = h.id === selecionadaId;
                return (
                  <button
                    key={h.id}
                    onClick={() => setSelecionadaId(h.id)}
                    className={`w-full text-left rounded-lg border p-3 text-xs transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-xs"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold capitalize text-foreground">
                        {h.category}
                      </span>
                      <Badge variant={statusMeta.variant} className="text-[10px] px-1.5 py-0">
                        {statusMeta.label}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-muted-foreground mb-1.5">
                      {h.scope_description || "Sem objeto detalhado"}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{formatarData(h.opened_at)}</span>
                      {h.conclusion_status && (
                        <span
                          className={`rounded px-1 text-[10px] font-medium border ${conclusaoMeta.colorClass}`}
                        >
                          {conclusaoMeta.label}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Colunas 2 e 3: Detalhes da Análise Ativa */}
          <div className="space-y-4 lg:col-span-2">
            {analiseAtiva && (
              <>
                <Card>
                  <CardHeader className="p-4 pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm font-semibold capitalize">
                            Análise: {analiseAtiva.category}
                          </CardTitle>
                          <Badge variant={rotuloStatusHomologacao(analiseAtiva.status).variant}>
                            {rotuloStatusHomologacao(analiseAtiva.status).label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Aberta em {formatarData(analiseAtiva.opened_at)}
                        </p>
                      </div>

                      {canEdit && analiseAtiva.status !== "completed" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setModalComplementacaoAberta(true)}
                          >
                            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                            Pedir Complementação
                          </Button>
                          <Button size="sm" onClick={() => setModalConclusaoAberta(true)}>
                            <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />
                            Concluir com Parecer
                          </Button>
                        </div>
                      )}
                    </div>

                    {analiseAtiva.scope_description && (
                      <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                        <span className="font-medium text-foreground">Objeto da análise: </span>
                        <span className="text-muted-foreground">
                          {analiseAtiva.scope_description}
                        </span>
                      </div>
                    )}

                    {analiseAtiva.conclusion_status && (
                      <div
                        className={`mt-2 rounded border p-2.5 text-xs ${rotuloConclusao(analiseAtiva.conclusion_status).colorClass}`}
                      >
                        <div className="font-semibold flex items-center gap-1.5 mb-1">
                          {analiseAtiva.conclusion_status === "regular" ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <AlertTriangle className="h-4 w-4" />
                          )}
                          Parecer: {rotuloConclusao(analiseAtiva.conclusion_status).label}
                        </div>
                        <p>{analiseAtiva.conclusion_notes || "Nenhum parecer textual registrado."}</p>
                        {analiseAtiva.concluded_at && (
                          <p className="mt-1 text-[10px] opacity-80">
                            Concluído em: {formatarData(analiseAtiva.concluded_at)}
                          </p>
                        )}
                      </div>
                    )}
                  </CardHeader>

                  <CardContent className="p-4 pt-0 space-y-4">
                    {/* Checklist Inteligente */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <FileCheck2 className="h-3.5 w-3.5" /> Checklist Documental Aplicado
                      </h4>
                      {loadingDetalhes ? (
                        <p className="text-xs text-muted-foreground py-2">Carregando checklist...</p>
                      ) : checklist.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">Nenhum item carregado.</p>
                      ) : (
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="text-[11px] bg-muted/40">
                                <TableHead>Exigência Documental</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Situação da Conferência</TableHead>
                                <TableHead className="text-right">Ação</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {checklist.map((item) => {
                                const statusInfo = rotuloStatusChecklist(item.verification_status);
                                return (
                                  <TableRow key={item.id} className="text-xs">
                                    <TableCell className="font-medium">
                                      {item.title}
                                      {item.is_sanitary && (
                                        <Badge
                                          variant="secondary"
                                          className="ml-1.5 text-[9px] px-1 py-0"
                                        >
                                          Sanitário
                                        </Badge>
                                      )}
                                      {item.notes && (
                                        <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                                          Obs: {item.notes}
                                        </p>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-[11px]">
                                      {item.is_mandatory ? "Obrigatório" : "Opcional"}
                                    </TableCell>
                                    <TableCell>
                                      <span className={statusInfo.colorClass}>
                                        {statusInfo.label}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {canEdit && analiseAtiva.status !== "completed" && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 text-xs px-2"
                                          onClick={() => {
                                            setItemEmEdicao(item);
                                            setStatusConferencia(item.verification_status);
                                            setNotasConferencia(item.notes || "");
                                          }}
                                        >
                                          Conferir
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>

                    {/* Timeline de Eventos / Auditoria */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> Histórico de Decisões e Eventos
                      </h4>
                      {loadingDetalhes ? (
                        <p className="text-xs text-muted-foreground">Carregando histórico...</p>
                      ) : eventos.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nenhum evento registrado.</p>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {eventos.map((ev) => (
                            <div
                              key={ev.id}
                              className="rounded-md border p-2.5 text-xs bg-card/60 space-y-1"
                            >
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {ev.event_type === "opened" && "Análise Aberta"}
                                  {ev.event_type === "checklist_verified" && "Conferência Realizada"}
                                  {ev.event_type === "completion_requested" &&
                                    "Complementação Solicitada"}
                                  {ev.event_type === "concluded" && "Homologação Concluída"}
                                  {ev.event_type === "cancelled" && "Análise Cancelada"}
                                </span>
                                <span>{formatarData(ev.created_at)}</span>
                              </div>
                              <p className="text-muted-foreground">{ev.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Iniciar Nova Análise */}
      <Dialog open={modalNovaAberta} onOpenChange={setModalNovaAberta}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleIniciarNova}>
            <DialogHeader>
              <DialogTitle>Iniciar Análise de Habilitação</DialogTitle>
              <DialogDescription>
                Abre uma análise cadastral com checklist documental inteligente específico para a
                categoria.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="categoria">Ramo / Categoria de Fornecimento</Label>
                <Select value={novaCategoria} onValueChange={setNovaCategoria}>
                  <SelectTrigger id="categoria">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="geral">Geral / Ampla Concorrência</SelectItem>
                    <SelectItem value="medicamentos">Medicamentos (Exige Sanitários)</SelectItem>
                    <SelectItem value="materiais_hospitalares">
                      Materiais Hospitalares (Exige Sanitários)
                    </SelectItem>
                    <SelectItem value="servicos">Serviços de Saúde</SelectItem>
                    <SelectItem value="equipamentos">Equipamentos Médicos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="escopo">Objeto ou Processo da Contratação</Label>
                <Textarea
                  id="escopo"
                  required
                  placeholder="Ex: Habilitação jurídica e fiscal para fornecimento de insumos básicos conforme Pregão Eletrônico 012/2026."
                  value={novoEscopo}
                  onChange={(e) => setNovoEscopo(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalNovaAberta(false)}
                disabled={salvandoNova}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoNova || !novoEscopo.trim()}>
                {salvandoNova ? "Iniciando..." : "Iniciar Análise"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Concluir com Parecer */}
      <Dialog open={modalConclusaoAberta} onOpenChange={setModalConclusaoAberta}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleConcluir}>
            <DialogHeader>
              <DialogTitle>Concluir Homologação</DialogTitle>
              <DialogDescription>
                Emissão de parecer formal conclusivo sobre a habilitação do fornecedor para o objeto
                analisado.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="conclusaoStatus">Resultado da Análise</Label>
                <Select
                  value={conclusaoStatus}
                  onValueChange={(v) => setConclusaoStatus(v as ConclusionStatus)}
                >
                  <SelectTrigger id="conclusaoStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular para a Finalidade</SelectItem>
                    <SelectItem value="pending">Com Pendências Documentais</SelectItem>
                    <SelectItem value="rejected">Não Atende às Exigências</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conclusaoNotas">Parecer Fundamentado e Observações</Label>
                <Textarea
                  id="conclusaoNotas"
                  required
                  placeholder="Descreva a fundamentação técnica e jurídica do parecer de habilitação..."
                  value={conclusaoNotas}
                  onChange={(e) => setConclusaoNotas(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalConclusaoAberta(false)}
                disabled={salvandoConclusao}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoConclusao || !conclusaoNotas.trim()}>
                {salvandoConclusao ? "Registrando..." : "Registrar Parecer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Solicitar Complementação */}
      <Dialog open={modalComplementacaoAberta} onOpenChange={setModalComplementacaoAberta}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSolicitarComplementacao}>
            <DialogHeader>
              <DialogTitle>Solicitar Complementação Documental</DialogTitle>
              <DialogDescription>
                Registra exigências de regularização para saneamento de pendências no cadastro do
                fornecedor.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="exigencias">Exigências e Prazos</Label>
                <Textarea
                  id="exigencias"
                  required
                  placeholder="Ex: Apresentar CND Municipal atualizada e cópia autenticada do Alvará Sanitário no prazo de 3 dias úteis."
                  value={exigenciasComplementacao}
                  onChange={(e) => setExigenciasComplementacao(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalComplementacaoAberta(false)}
                disabled={salvandoComplementacao}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvandoComplementacao || !exigenciasComplementacao.trim()}
              >
                {salvandoComplementacao ? "Registrando..." : "Registrar Solicitação"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Conferência de Item do Checklist */}
      <Dialog open={Boolean(itemEmEdicao)} onOpenChange={(open) => !open && setItemEmEdicao(null)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSalvarItemChecklist}>
            <DialogHeader>
              <DialogTitle>Conferência Documental</DialogTitle>
              <DialogDescription>{itemEmEdicao?.title}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="statusItem">Situação da Conferência</Label>
                <Select
                  value={statusConferencia}
                  onValueChange={(v) => setStatusConferencia(v as ChecklistVerificationStatus)}
                >
                  <SelectTrigger id="statusItem">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verified">Conferido e Válido</SelectItem>
                    <SelectItem value="pending_issue">Com Pendência</SelectItem>
                    <SelectItem value="awaiting_review">Aguardando Conferência</SelectItem>
                    <SelectItem value="expired">Vencido</SelectItem>
                    <SelectItem value="replaced">Substituído</SelectItem>
                    <SelectItem value="not_submitted">Não Enviado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notasItem">Observações da Conferência</Label>
                <Input
                  id="notasItem"
                  placeholder="Ex: Certidão conferida no portal oficial em 23/11/2026."
                  value={notasConferencia}
                  onChange={(e) => setNotasConferencia(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setItemEmEdicao(null)}
                disabled={salvandoItem}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoItem}>
                {salvandoItem ? "Salvando..." : "Salvar Conferência"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
