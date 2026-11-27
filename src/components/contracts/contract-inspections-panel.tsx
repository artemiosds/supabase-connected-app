import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Loader2,
  Plus,
  Printer,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { dataHojeLocalISO, formatarData } from "@/lib/contratacao";
import type { CsvColumn } from "@/lib/csv-export";
import {
  avaliarUrgenciaPrazoDefesa,
  calcularPrazoDefesaUtil,
  FUNDAMENTOS_LEGAIS_PADRAO,
  gerarHtmlNotificacaoFormal,
  ROTULOS_SEVERIDADE_FISCALIZACAO,
  ROTULOS_STATUS_FISCALIZACAO,
  ROTULOS_TIPO_FISCALIZACAO,
  sugerirProximoNumeroFiscalizacao,
  validarRegistroFiscalizacao,
  type SeveridadeFiscalizacao,
  type StatusFiscalizacao,
  type TipoRegistroFiscalizacao,
} from "@/lib/contract-inspections-helper";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";

export interface ContratoFiscalizacaoItem {
  id: string;
  number: string;
  object_description: string;
  supplier_name: string;
  responsible_name: string | null;
  status: string;
}

interface RegistroFiscalizacao {
  id: string;
  contract_id: string;
  record_number: string;
  record_type: TipoRegistroFiscalizacao;
  severity: SeveridadeFiscalizacao;
  status: StatusFiscalizacao;
  title: string;
  description: string;
  legal_basis: string | null;
  occurred_at: string;
  inspector_name: string;
  defense_deadline: string | null;
  supplier_response: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

interface Props {
  tenantId: string;
  userId?: string | undefined;
  userName?: string | null | undefined;
  orgaoNome: string;
  municipioUf?: string | undefined;
  contratos: ContratoFiscalizacaoItem[];
  busca: string;
}

export function ContractInspectionsPanel(props: Props) {
  const [registros, setRegistros] = useState<RegistroFiscalizacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroContrato, setFiltroContrato] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");

  const [novoAberto, setNovoAberto] = useState(false);
  const [contratoId, setContratoId] = useState("");
  const [recordType, setRecordType] = useState<TipoRegistroFiscalizacao>("vistoria");
  const [recordNumber, setRecordNumber] = useState("");
  const [severity, setSeverity] = useState<SeveridadeFiscalizacao>("informativa");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [legalBasis, setLegalBasis] = useState(FUNDAMENTOS_LEGAIS_PADRAO.vistoria);
  const [occurredAt, setOccurredAt] = useState(() => dataHojeLocalISO());
  const [inspectorName, setInspectorName] = useState("");
  const [defenseDeadline, setDefenseDeadline] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [editandoDesfecho, setEditandoDesfecho] = useState<RegistroFiscalizacao | null>(null);
  const [desfechoStatus, setDesfechoStatus] = useState<StatusFiscalizacao>("regularizada");
  const [supplierResponse, setSupplierResponse] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [salvandoDesfecho, setSalvandoDesfecho] = useState(false);

  const hoje = dataHojeLocalISO();

  const carregar = useCallback(async () => {
    if (!db || !props.tenantId) return;
    setLoading(true);
    setErro(null);
    try {
      const rows = await carregarTodasAsPaginas((inicio, fim) =>
        db!
          .from("contract_inspection_records")
          .select(
            "id, contract_id, record_number, record_type, severity, status, title, description, legal_basis, occurred_at, inspector_name, defense_deadline, supplier_response, resolved_at, resolution_notes, created_at",
          )
          .eq("tenant_id", props.tenantId)
          .order("occurred_at", { ascending: false })
          .order("created_at", { ascending: false })
          .range(inicio, fim),
      );
      setRegistros(rows as unknown as RegistroFiscalizacao[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar o Livro de Fiscalização.");
    } finally {
      setLoading(false);
    }
  }, [props.tenantId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const contratosPorId = useMemo(
    () => new Map(props.contratos.map((c) => [c.id, c])),
    [props.contratos],
  );

  function abrirNovo(contratoPreSelecionado?: string) {
    const cid = contratoPreSelecionado || props.contratos[0]?.id || "";
    const contrato = contratosPorId.get(cid);
    const tipoInicial: TipoRegistroFiscalizacao = "vistoria";
    const ano = Number(hoje.slice(0, 4)) || new Date().getFullYear();
    const registrosContrato = registros.filter((r) => r.contract_id === cid);

    setContratoId(cid);
    setRecordType(tipoInicial);
    setRecordNumber(sugerirProximoNumeroFiscalizacao(registrosContrato, tipoInicial, ano));
    setSeverity("informativa");
    setTitle("");
    setDescription("");
    setLegalBasis(FUNDAMENTOS_LEGAIS_PADRAO[tipoInicial]);
    setOccurredAt(hoje);
    setInspectorName(contrato?.responsible_name?.trim() || props.userName?.trim() || "");
    setDefenseDeadline("");
    setNovoAberto(true);
  }

  function aoTrocarTipo(proximoTipo: TipoRegistroFiscalizacao) {
    setRecordType(proximoTipo);
    setLegalBasis(FUNDAMENTOS_LEGAIS_PADRAO[proximoTipo]);
    const ano = Number(occurredAt.slice(0, 4)) || new Date().getFullYear();
    const registrosContrato = registros.filter((r) => r.contract_id === contratoId);
    setRecordNumber(sugerirProximoNumeroFiscalizacao(registrosContrato, proximoTipo, ano));
    if (proximoTipo === "notificacao") {
      setSeverity("atencao");
      if (!defenseDeadline) {
        setDefenseDeadline(calcularPrazoDefesaUtil(occurredAt, 5) ?? "");
      }
    } else if (proximoTipo === "penalidade") {
      setSeverity("critica");
    }
  }

  async function salvarNovo(e: FormEvent) {
    e.preventDefault();
    if (!db || !props.userId) {
      toast.error("Sessão inválida para registrar fiscalização.");
      return;
    }
    if (!contratoId) {
      toast.error("Selecione o contrato fiscalizado.");
      return;
    }

    const validacao = validarRegistroFiscalizacao(
      {
        record_number: recordNumber,
        record_type: recordType,
        title,
        description,
        occurred_at: occurredAt,
        inspector_name: inspectorName,
        defense_deadline: defenseDeadline || null,
      },
      hoje,
    );
    if (!validacao.valido) {
      toast.error(validacao.erro ?? "Revise os dados do registro.");
      return;
    }

    const statusInicial: StatusFiscalizacao =
      recordType === "notificacao"
        ? "aguardando_defesa"
        : recordType === "penalidade"
          ? "encaminhada_sancao"
          : "registrada";

    setSalvando(true);
    const { error } = await db.from("contract_inspection_records").insert({
      tenant_id: props.tenantId,
      contract_id: contratoId,
      record_number: recordNumber.trim(),
      record_type: recordType,
      severity,
      status: statusInicial,
      title: title.trim(),
      description: description.trim(),
      legal_basis: legalBasis.trim() || null,
      occurred_at: occurredAt,
      inspector_name: inspectorName.trim(),
      defense_deadline: defenseDeadline || null,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSalvando(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Registro lavrado no Livro Digital de Fiscalização (Art. 117).");
    setNovoAberto(false);
    await carregar();
  }

  function abrirDesfecho(item: RegistroFiscalizacao) {
    setEditandoDesfecho(item);
    setDesfechoStatus(
      item.status === "aguardando_defesa" || item.status === "registrada"
        ? "regularizada"
        : item.status,
    );
    setSupplierResponse(item.supplier_response ?? "");
    setResolutionNotes(item.resolution_notes ?? "");
  }

  async function salvarDesfecho(e: FormEvent) {
    e.preventDefault();
    if (!db || !props.userId || !editandoDesfecho) return;
    setSalvandoDesfecho(true);
    const resolvido =
      desfechoStatus === "regularizada" ||
      desfechoStatus === "encerrada" ||
      desfechoStatus === "encaminhada_sancao";
    const { error } = await db
      .from("contract_inspection_records")
      .update({
        status: desfechoStatus,
        supplier_response: supplierResponse.trim() || null,
        resolution_notes: resolutionNotes.trim() || null,
        resolved_at: resolvido ? new Date().toISOString() : null,
        updated_by: props.userId,
      })
      .eq("id", editandoDesfecho.id)
      .eq("tenant_id", props.tenantId);
    setSalvandoDesfecho(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Desfecho registrado no Livro de Fiscalização.");
    setEditandoDesfecho(null);
    await carregar();
  }

  function imprimirNotificacao(item: RegistroFiscalizacao) {
    const contrato = contratosPorId.get(item.contract_id);
    if (!contrato) {
      toast.error("Contrato vinculado não encontrado.");
      return;
    }
    const html = gerarHtmlNotificacaoFormal({
      orgaoNome: props.orgaoNome,
      ...(props.municipioUf ? { municipioUf: props.municipioUf } : {}),
      contratoNumero: contrato.number,
      contratoObjeto: contrato.object_description,
      fornecedorNome: contrato.supplier_name,
      registroNumero: item.record_number,
      tipo: item.record_type,
      titulo: item.title,
      descricao: item.description,
      fundamentoLegal: item.legal_basis || FUNDAMENTOS_LEGAIS_PADRAO[item.record_type],
      dataOcorrencia: item.occurred_at,
      prazoDefesa: item.defense_deadline,
      fiscalNome: item.inspector_name,
      manifestacaoFornecedor: item.supplier_response,
      observacaoResolucao: item.resolution_notes,
    });
    const janela = window.open("", "_blank", "noopener,noreferrer");
    if (!janela) {
      toast.error("Permita pop-ups para imprimir ou gerar PDF da notificação.");
      return;
    }
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 250);
  }

  const metricas = useMemo(() => {
    let aguardandoDefesa = 0;
    let vencidas = 0;
    let regularizadas = 0;
    for (const r of registros) {
      if (r.status === "aguardando_defesa") aguardandoDefesa += 1;
      if (r.status === "regularizada" || r.status === "encerrada") regularizadas += 1;
      if (avaliarUrgenciaPrazoDefesa(r.status, r.defense_deadline, hoje) === "vencida") {
        vencidas += 1;
      }
    }
    return {
      total: registros.length,
      aguardandoDefesa,
      vencidas,
      regularizadas,
    };
  }, [registros, hoje]);

  const filtrados = useMemo(() => {
    const q = props.busca.trim().toLowerCase();
    return registros.filter((r) => {
      if (filtroContrato !== "todos" && r.contract_id !== filtroContrato) return false;
      if (filtroTipo !== "todos" && r.record_type !== filtroTipo) return false;
      if (filtroStatus !== "todos" && r.status !== filtroStatus) return false;
      if (!q) return true;
      const contrato = contratosPorId.get(r.contract_id);
      return [
        r.record_number,
        r.title,
        r.description,
        r.inspector_name,
        contrato?.number,
        contrato?.supplier_name,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [registros, filtroContrato, filtroTipo, filtroStatus, props.busca, contratosPorId]);

  const colunasCsv: CsvColumn<RegistroFiscalizacao>[] = [
    { header: "Registro", value: (r) => r.record_number },
    { header: "Contrato", value: (r) => contratosPorId.get(r.contract_id)?.number ?? "" },
    { header: "Fornecedor", value: (r) => contratosPorId.get(r.contract_id)?.supplier_name ?? "" },
    { header: "Tipo", value: (r) => ROTULOS_TIPO_FISCALIZACAO[r.record_type] ?? r.record_type },
    { header: "Gravidade", value: (r) => ROTULOS_SEVERIDADE_FISCALIZACAO[r.severity] ?? r.severity },
    { header: "Status", value: (r) => ROTULOS_STATUS_FISCALIZACAO[r.status] ?? r.status },
    { header: "Data ocorrência", value: (r) => formatarData(r.occurred_at) },
    { header: "Prazo defesa", value: (r) => (r.defense_deadline ? formatarData(r.defense_deadline) : "") },
    { header: "Fiscal", value: (r) => r.inspector_name },
    { header: "Assunto", value: (r) => r.title },
    { header: "Relato", value: (r) => r.description },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Registros no livro (Art. 117)</CardDescription>
            <CardTitle className="text-2xl">{metricas.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Notificações aguardando defesa</CardDescription>
            <CardTitle className="text-2xl">{metricas.aguardandoDefesa}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={metricas.vencidas > 0 ? "border-destructive/40 bg-destructive/5" : ""}>
          <CardHeader className="pb-2">
            <CardDescription>Prazos de regularização vencidos</CardDescription>
            <CardTitle className={`text-2xl ${metricas.vencidas > 0 ? "text-destructive" : ""}`}>
              {metricas.vencidas}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Regularizadas / Encerradas</CardDescription>
            <CardTitle className="text-2xl">{metricas.regularizadas}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroContrato} onValueChange={setFiltroContrato}>
            <SelectTrigger className="w-[220px]" aria-label="Filtrar por contrato">
              <SelectValue placeholder="Contrato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os contratos</SelectItem>
              {props.contratos.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.number} — {c.supplier_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger className="w-[200px]" aria-label="Filtrar por tipo">
              <SelectValue placeholder="Tipo de registro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {Object.entries(ROTULOS_TIPO_FISCALIZACAO).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="w-[200px]" aria-label="Filtrar por status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {Object.entries(ROTULOS_STATUS_FISCALIZACAO).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ReportExportActions<RegistroFiscalizacao>
            filename="livro-fiscalizacao-contratos"
            title="Livro Digital de Fiscalização Contratual (Lei nº 14.133/2021, art. 117)"
            rows={filtrados}
            columns={colunasCsv}
          />
          <Button
            onClick={() => abrirNovo(filtroContrato !== "todos" ? filtroContrato : undefined)}
            disabled={props.contratos.length === 0}
          >
            <Plus className="h-4 w-4" /> Registrar ocorrência / notificação
          </Button>
        </div>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Falha ao carregar Livro de Fiscalização</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando registros de fiscalização...
        </div>
      ) : filtrados.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
            Nenhum registro encontrado no Livro de Fiscalização para os filtros selecionados.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtrados.map((item) => {
            const contrato = contratosPorId.get(item.contract_id);
            const urgencia = avaliarUrgenciaPrazoDefesa(item.status, item.defense_deadline, hoje);
            return (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-xs">
                          {item.record_number}
                        </Badge>
                        <Badge variant={item.record_type === "notificacao" ? "default" : "secondary"}>
                          {ROTULOS_TIPO_FISCALIZACAO[item.record_type]}
                        </Badge>
                        <Badge
                          variant={
                            item.severity === "critica"
                              ? "destructive"
                              : item.severity === "atencao"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {ROTULOS_SEVERIDADE_FISCALIZACAO[item.severity]}
                        </Badge>
                        <Badge variant="outline">{ROTULOS_STATUS_FISCALIZACAO[item.status]}</Badge>
                        {urgencia === "vencida" && (
                          <Badge variant="destructive">
                            <ShieldAlert className="mr-1 h-3 w-3" /> Prazo vencido
                          </Badge>
                        )}
                        {urgencia === "vence_em_breve" && (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-600">
                            <FileWarning className="mr-1 h-3 w-3" /> Vence em breve
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-base">{item.title}</CardTitle>
                      <CardDescription>
                        Contrato <strong>{contrato?.number ?? "—"}</strong> ·{" "}
                        {contrato?.supplier_name ?? "Fornecedor"} · Ocorrência em{" "}
                        <strong>{formatarData(item.occurred_at)}</strong> · Fiscal:{" "}
                        <strong>{item.inspector_name}</strong>
                        {item.defense_deadline && (
                          <>
                            {" "}
                            · Prazo de defesa: <strong>{formatarData(item.defense_deadline)}</strong>
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => imprimirNotificacao(item)}
                      >
                        <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => abrirDesfecho(item)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Registrar desfecho
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="whitespace-pre-wrap text-foreground/90">{item.description}</p>
                  {item.legal_basis && (
                    <p className="text-xs text-muted-foreground">
                      Fundamento legal: {item.legal_basis}
                    </p>
                  )}
                  {item.supplier_response && (
                    <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
                      <strong>Manifestação do contratado:</strong> {item.supplier_response}
                    </div>
                  )}
                  {item.resolution_notes && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
                      <strong>Despacho de encerramento:</strong> {item.resolution_notes}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog: Novo registro no Livro de Fiscalização */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Livro Digital de Fiscalização (Lei nº 14.133/2021, art. 117)</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarNovo} className="grid gap-3.5">
            <div className="grid gap-1.5">
              <Label>Contrato fiscalizado *</Label>
              <Select
                value={contratoId}
                onValueChange={(cid) => {
                  setContratoId(cid);
                  const c = contratosPorId.get(cid);
                  if (c?.responsible_name && !inspectorName) {
                    setInspectorName(c.responsible_name);
                  }
                  const ano = Number(occurredAt.slice(0, 4)) || new Date().getFullYear();
                  setRecordNumber(
                    sugerirProximoNumeroFiscalizacao(
                      registros.filter((r) => r.contract_id === cid),
                      recordType,
                      ano,
                    ),
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o contrato" />
                </SelectTrigger>
                <SelectContent>
                  {props.contratos.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.number} — {c.supplier_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Espécie do registro *</Label>
                <Select
                  value={recordType}
                  onValueChange={(v) => aoTrocarTipo(v as TipoRegistroFiscalizacao)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROTULOS_TIPO_FISCALIZACAO).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Número de controle *</Label>
                <Input
                  required
                  value={recordNumber}
                  onChange={(e) => setRecordNumber(e.target.value)}
                  placeholder="REG-001/2026"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Gravidade *</Label>
                <Select
                  value={severity}
                  onValueChange={(v) => setSeverity(v as SeveridadeFiscalizacao)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROTULOS_SEVERIDADE_FISCALIZACAO).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Data da ocorrência *</Label>
                <Input
                  type="date"
                  required
                  max={hoje}
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>
                  Prazo defesa {recordType === "notificacao" ? "*" : "(opcional)"}
                </Label>
                <Input
                  type="date"
                  required={recordType === "notificacao"}
                  min={occurredAt}
                  value={defenseDeadline}
                  onChange={(e) => setDefenseDeadline(e.target.value)}
                />
              </div>
            </div>

            {recordType === "notificacao" && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Atalhos de prazo legal (dias úteis):</span>
                {[5, 10, 15].map((dias) => (
                  <Button
                    key={dias}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setDefenseDeadline(calcularPrazoDefesaUtil(occurredAt, dias) ?? "")}
                  >
                    +{dias} dias úteis
                  </Button>
                ))}
              </div>
            )}

            <div className="grid gap-1.5">
              <Label>Fiscal responsável *</Label>
              <Input
                required
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                placeholder="Nome completo do fiscal do contrato"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Assunto / Título *</Label>
              <Input
                required
                minLength={3}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Atraso parcial na entrega da Ordem de Fornecimento nº 14/2026"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Relato fático detalhado *</Label>
              <Textarea
                required
                minLength={10}
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva os fatos apurados, quantitativos divergentes, cláusulas descumpridas ou conformidades atestadas..."
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Fundamentação legal</Label>
              <Input
                value={legalBasis}
                onChange={(e) => setLegalBasis(e.target.value)}
                placeholder="Lei nº 14.133/2021, art. 117, § 1º"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovoAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lavrar no Livro de Fiscalização
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Registrar manifestação do fornecedor e desfecho */}
      <Dialog open={!!editandoDesfecho} onOpenChange={(o) => !o && setEditandoDesfecho(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Desfecho da Fiscalização — {editandoDesfecho?.record_number}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarDesfecho} className="grid gap-3.5">
            <div className="grid gap-1.5">
              <Label>Situação atualizada *</Label>
              <Select
                value={desfechoStatus}
                onValueChange={(v) => setDesfechoStatus(v as StatusFiscalizacao)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROTULOS_STATUS_FISCALIZACAO).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Manifestação / Defesa prévia do contratado</Label>
              <Textarea
                rows={3}
                value={supplierResponse}
                onChange={(e) => setSupplierResponse(e.target.value)}
                placeholder="Resumo da justificativa ou protocolo apresentado pela empresa..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Despacho conclusivo da fiscalização</Label>
              <Textarea
                rows={3}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Decisão do fiscal / gestor do contrato sobre regularização ou encaminhamento..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditandoDesfecho(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoDesfecho}>
                {salvandoDesfecho && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar desfecho
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
