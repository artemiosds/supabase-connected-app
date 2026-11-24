import { SupplierDocumentMonitor } from "@/components/supplier-document-monitor";
import { parseSupplierVerification } from "@/lib/supplier-verification";
import { useRef } from "react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  FileText,
  History,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData, formatarMoeda } from "@/lib/contratacao";
import {
  dataLocalIso,
  diasAteDataIso,
  resumirFichaFornecedor,
  situacaoDocumentoPerfil,
} from "@/lib/supplier-profile";
import { getSanctionDisplayStatus } from "@/lib/supplier-sanctions";
import { SupplierHomologationTab } from "./supplier-homologation-tab";
import { SupplierRegularityPanel } from "./supplier-regularity-panel";
import { SupplierAiCopilot } from "./supplier-ai-copilot";
import type { Tables } from "@/integrations/supabase/types";

type Fornecedor = Tables<"suppliers">;
type Documento = Pick<
  Tables<"supplier_documents">,
  | "id"
  | "title"
  | "document_type"
  | "status"
  | "issue_date"
  | "expires_at"
  | "notes"
  | "storage_path"
  | "external_url"
  | "storage_provider"
  | "file_name"
>;
type Cotacao = Pick<
  Tables<"procurement_price_quotes">,
  | "id"
  | "procurement_item_id"
  | "quoted_at"
  | "source_name"
  | "source_type"
  | "unit_price"
  | "quantity"
  | "total_price"
  | "selected_for_estimate"
  | "is_active"
>;
type ItemCotado = Pick<Tables<"procurement_items">, "id" | "description" | "process_id">;
type Processo = Pick<Tables<"procurement_processes">, "id" | "number" | "title">;
type Instrumento = Pick<
  Tables<"contracts">,
  | "id"
  | "number"
  | "instrument_type"
  | "object"
  | "status"
  | "start_date"
  | "end_date"
  | "total_value"
  | "process_id"
>;
type Sancao = Pick<
  Tables<"supplier_sanctions">,
  "id" | "measure" | "reason" | "reference_number" | "start_date" | "end_date" | "status"
>;

type EstadoSecao<T> = {
  status: "ready" | "error" | "disabled";
  rows: T[];
};

type Cotacoes = {
  quotes: Cotacao[];
  items: ItemCotado[];
  processes: Processo[];
  contextUnavailable: boolean;
};

type FichaDados = {
  documentos: EstadoSecao<Documento>;
  cotacoes: EstadoSecao<Cotacao>;
  cotacoesContexto: Cotacoes;
  instrumentos: EstadoSecao<Instrumento>;
  sancoes: EstadoSecao<Sancao>;
};

const SEM_COTACOES: Cotacoes = {
  quotes: [],
  items: [],
  processes: [],
  contextUnavailable: false,
};

function secao<T>(resultado: PromiseSettledResult<T[] | null>, enabled: boolean): EstadoSecao<T> {
  if (!enabled) return { status: "disabled", rows: [] };
  return resultado.status === "fulfilled" && resultado.value !== null
    ? { status: "ready", rows: resultado.value }
    : { status: "error", rows: [] };
}

function SituacaoSecao({
  status,
  empty,
  count,
}: {
  status: EstadoSecao<unknown>["status"];
  empty: string;
  count: number;
}) {
  if (status === "disabled") {
    return (
      <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        Módulo não habilitado para esta Secretaria.
      </p>
    );
  }
  if (status === "error") {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/30 p-4 text-sm text-destructive"
      >
        Dados indisponíveis para este perfil ou Secretaria. Não é possível confirmar a existência de
        registros.
      </p>
    );
  }
  if (count === 0)
    return (
      <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">{empty}</p>
    );
  return null;
}

function Metrica({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail?: string | undefined;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value === null ? "—" : value}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function RotuloDocumento({ documento, hoje }: { documento: Documento; hoje: string }) {
  const situacao = situacaoDocumentoPerfil(documento, hoje);
  const rotulos = {
    arquivado: "Arquivado",
    sem_vencimento: "Sem vencimento",
    vencido: "Vencido",
    vence_hoje: "Vence hoje",
    a_vencer: "A vencer em até 30 dias",
    em_dia: "Em dia",
  };
  return (
    <Badge variant={situacao === "vencido" ? "destructive" : "outline"}>{rotulos[situacao]}</Badge>
  );
}

async function buscarCotacoesVinculadas(tenantId: string, supplierId: string): Promise<Cotacoes> {
  // O vínculo formal é supplier_id. Não juntar por nomes nem deduzir vínculos por CNPJ.
  const quotes = await carregarTodasAsPaginas<Cotacao>((start, end) =>
    db
      .from("procurement_price_quotes")
      .select(
        "id,procurement_item_id,quoted_at,source_name,source_type,unit_price,quantity,total_price,selected_for_estimate,is_active",
      )
      .eq("tenant_id", tenantId)
      .eq("supplier_id", supplierId)
      .order("quoted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, end),
  );

  const items: ItemCotado[] = [];
  const processes: Processo[] = [];
  let contextUnavailable = false;

  try {
    const ids = [...new Set(quotes.map((quote) => quote.procurement_item_id))];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const found = await carregarTodasAsPaginas<ItemCotado>((start, end) =>
        db
          .from("procurement_items")
          .select("id,description,process_id")
          .eq("tenant_id", tenantId)
          .in("id", batch)
          .order("id")
          .range(start, end),
      );
      items.push(...found);
    }
    const processIds = [...new Set(items.map((item) => item.process_id))];
    for (let offset = 0; offset < processIds.length; offset += 100) {
      const batch = processIds.slice(offset, offset + 100);
      const found = await carregarTodasAsPaginas<Processo>((start, end) =>
        db
          .from("procurement_processes")
          .select("id,number,title")
          .eq("tenant_id", tenantId)
          .in("id", batch)
          .order("id")
          .range(start, end),
      );
      processes.push(...found);
    }
  } catch {
    // Falha no enriquecimento não apaga cotações acessíveis.
    contextUnavailable = true;
  }
  return { quotes, items, processes, contextUnavailable };
}

export function FichaFornecedor({
  fornecedor,
  tenantId,
  enabledModules,
  onClose,
  onManageSanctions,
}: {
  fornecedor: Fornecedor | null;
  tenantId: string;
  enabledModules: Record<string, boolean>;
  onClose: () => void;
  onManageSanctions: (supplier: Fornecedor) => void;
}) {
  const [dados, setDados] = useState<FichaDados | null>(null);
  const [recarregar, setRecarregar] = useState(0);
  const open = fornecedor !== null;
  const supplierId = fornecedor?.id ?? null;
  const documentosEnabled = enabledModules["documentos"] === true;
  const processosEnabled = enabledModules["processos"] === true;
  const contratosEnabled = enabledModules["contratos"] === true;
  const hoje = dataLocalIso();
  const active = useRef({ tenantId, supplierId });
  active.current = { tenantId, supplierId };
  const [opening, setOpening] = useState(false);
  async function openDocument(doc: Documento) {
    if (doc.status !== "active") return;
    if (doc.external_url && !doc.storage_path) {
      try {
        const url = new URL(doc.external_url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {
        toast.error("Endereço do arquivo inválido.");
      }
      return;
    }
    if (!doc.storage_path?.startsWith(tenantId + "/")) return;
    const request = { tenantId, supplierId };
    setOpening(true);
    try {
      const { data, error } = await db.storage
        .from("gfs-private-documents")
        .download(doc.storage_path);
      if (error || !data) throw new Error();
      if (
        active.current.tenantId !== request.tenantId ||
        active.current.supplierId !== request.supplierId
      )
        return;
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.file_name || doc.title;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      toast.error("Não foi possível abrir o arquivo com seu perfil.");
    } finally {
      setOpening(false);
    }
  }

  useEffect(() => {
    let active = true;
    setDados(null);
    if (!supplierId || !open)
      return () => {
        active = false;
      };

    async function carregar() {
      const [documentosResult, cotacoesResult, instrumentosResult, sancoesResult] =
        await Promise.allSettled([
          documentosEnabled
            ? carregarTodasAsPaginas<Documento>((start, end) =>
                db
                  .from("supplier_documents")
                  .select(
                    "id,title,document_type,status,issue_date,expires_at,notes,storage_path,external_url,storage_provider,file_name",
                  )
                  .eq("tenant_id", tenantId)
                  .eq("supplier_id", supplierId!)
                  .order("expires_at", { ascending: true, nullsFirst: false })
                  .order("id")
                  .range(start, end),
              )
            : Promise.resolve(null),
          processosEnabled
            ? buscarCotacoesVinculadas(tenantId, supplierId!)
            : Promise.resolve(null),
          contratosEnabled
            ? carregarTodasAsPaginas<Instrumento>((start, end) =>
                db
                  .from("contracts")
                  .select(
                    "id,number,instrument_type,object,status,start_date,end_date,total_value,process_id",
                  )
                  .eq("tenant_id", tenantId)
                  .eq("supplier_id", supplierId!)
                  .order("end_date", { ascending: true })
                  .order("id")
                  .range(start, end),
              )
            : Promise.resolve(null),
          carregarTodasAsPaginas<Sancao>((start, end) =>
            db
              .from("supplier_sanctions")
              .select("id,measure,reason,reference_number,start_date,end_date,status")
              .eq("tenant_id", tenantId)
              .eq("supplier_id", supplierId!)
              .order("start_date", { ascending: false })
              .order("id")
              .range(start, end),
          ),
        ]);

      if (!active) return;
      const cotacoesContexto =
        cotacoesResult.status === "fulfilled" && cotacoesResult.value
          ? cotacoesResult.value
          : SEM_COTACOES;
      setDados({
        documentos: secao(documentosResult, documentosEnabled),
        cotacoes: !processosEnabled
          ? { status: "disabled", rows: [] }
          : cotacoesResult.status === "fulfilled" && cotacoesResult.value
            ? { status: "ready", rows: cotacoesResult.value.quotes }
            : { status: "error", rows: [] },
        cotacoesContexto,
        instrumentos: secao(instrumentosResult, contratosEnabled),
        sancoes: secao(sancoesResult, true),
      });
    }

    void carregar();
    return () => {
      active = false;
    };
  }, [
    supplierId,
    tenantId,
    open,
    documentosEnabled,
    processosEnabled,
    contratosEnabled,
    recarregar,
  ]);

  const documentoRows = dados?.documentos.rows ?? [];
  const quoteRows = dados?.cotacoes.rows ?? [];
  const instrumentos = dados?.instrumentos.rows ?? [];
  const sancoes = dados?.sancoes.rows ?? [];
  const resumo = dados
    ? resumirFichaFornecedor(documentoRows, quoteRows, instrumentos, sancoes, hoje)
    : null;
  const itemById = new Map(dados?.cotacoesContexto.items.map((item) => [item.id, item]) ?? []);
  const processById = new Map(
    dados?.cotacoesContexto.processes.map((process) => [process.id, process]) ?? [],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ficha 360º do fornecedor</DialogTitle>
          <DialogDescription>
            Informações consolidadas exclusivamente da Secretaria selecionada, com acesso sujeito às
            permissões de cada módulo.
          </DialogDescription>
        </DialogHeader>
        {fornecedor && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/35 p-4">
              <div className="min-w-0 space-y-1">
                <h2 className="break-words text-lg font-semibold">{fornecedor.legal_name}</h2>
                {fornecedor.trade_name && (
                  <p className="text-sm text-muted-foreground">{fornecedor.trade_name}</p>
                )}
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4" aria-hidden />
                  CNPJ {formatarCnpj(fornecedor.cnpj)}
                  {fornecedor.city && (
                    <span>
                      · {fornecedor.city}
                      {fornecedor.state ? `/${fornecedor.state}` : ""}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={fornecedor.status === "active" ? "secondary" : "outline"}>
                  {fornecedor.status === "active" ? "Cadastro ativo" : "Cadastro inativo"}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRecarregar((value) => value + 1)}
                  disabled={!dados}
                >
                  <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
                  Atualizar
                </Button>
              </div>
            </div>

            {!dados ? (
              <p
                role="status"
                className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Consultando informações do fornecedor nesta Secretaria…
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Metrica
                    label="Documentos ativos"
                    value={dados.documentos.status === "ready" ? (resumo?.documentos ?? 0) : null}
                    detail={
                      dados.documentos.status === "ready"
                        ? `${resumo?.vencidos ?? 0} vencido(s) · ${resumo?.aVencer ?? 0} a vencer`
                        : "Consulta indisponível"
                    }
                  />
                  <Metrica
                    label="Cotações vinculadas"
                    value={dados.cotacoes.status === "ready" ? (resumo?.cotacoes ?? 0) : null}
                  />
                  <Metrica
                    label="Contratos / Atas"
                    value={
                      dados.instrumentos.status === "ready"
                        ? (resumo?.contratos ?? 0) + (resumo?.atas ?? 0)
                        : null
                    }
                    detail={
                      dados.instrumentos.status === "ready"
                        ? `${resumo?.contratos ?? 0} contrato(s) · ${resumo?.atas ?? 0} ata(s)`
                        : undefined
                    }
                  />
                  <Metrica
                    label="Sanções vigentes"
                    value={dados.sancoes.status === "ready" ? (resumo?.sancoesVigentes ?? 0) : null}
                    detail={
                      dados.sancoes.status !== "ready" ? "Situação não verificada" : undefined
                    }
                  />
                </div>

                {resumo &&
                (resumo.vencidos ||
                  resumo.aVencer ||
                  resumo.vencimentosContratuais ||
                  resumo.sancoesVigentes) ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/50 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                    <span>Itens que exigem acompanhamento:</span>
                    {Boolean(resumo.vencidos) && (
                      <Badge variant="destructive">{resumo.vencidos} documento(s) vencido(s)</Badge>
                    )}
                    {Boolean(resumo.aVencer) && (
                      <Badge variant="outline">{resumo.aVencer} documento(s) a vencer</Badge>
                    )}
                    {Boolean(resumo.vencimentosContratuais) && (
                      <Badge variant="outline">
                        {resumo.vencimentosContratuais} contrato(s)/ata(s) próximos do vencimento
                      </Badge>
                    )}
                    {Boolean(resumo.sancoesVigentes) && (
                      <Badge variant="destructive">
                        {resumo.sancoesVigentes} sanção(ões) vigente(s)
                      </Badge>
                    )}
                  </div>
                ) : null}

                <Tabs defaultValue="documentos" className="space-y-3">
                  <TabsList className="h-auto w-full flex-wrap justify-start">
                    <TabsTrigger value="documentos">Documentos</TabsTrigger>
                    <TabsTrigger value="homologacao">Homologação e Habilitação</TabsTrigger>
                    <TabsTrigger value="regularidade">Regularidade Oficial</TabsTrigger>
                    <TabsTrigger value="ia" className="gap-1 font-medium text-primary">
                      <Sparkles className="h-3.5 w-3.5" /> Copiloto IA
                    </TabsTrigger>
                    <TabsTrigger value="cotacoes">Cotações</TabsTrigger>
                    <TabsTrigger value="instrumentos">Contratos e atas</TabsTrigger>
                    <TabsTrigger value="sancoes">Sanções</TabsTrigger>
                    <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
                  </TabsList>

                  <TabsContent value="documentos" className="space-y-3">
                    {documentosEnabled && (
                      <SupplierDocumentMonitor
                        tenantId={tenantId}
                        supplierId={fornecedor.id}
                        category={fornecedor.category}
                      />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">Documentos e vencimentos</h3>
                      {documentosEnabled && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={"/documentos?fornecedor=" + encodeURIComponent(fornecedor.id)}>
                            <FileText className="mr-1 h-4 w-4" aria-hidden />
                            Abrir módulo <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden />
                          </a>
                        </Button>
                      )}
                    </div>
                    <SituacaoSecao
                      status={dados.documentos.status}
                      count={documentoRows.length}
                      empty="Nenhum documento vinculado a este fornecedor nesta Secretaria."
                    />
                    {dados.documentos.status === "ready" &&
                      documentoRows.map((doc) => (
                        <article key={doc.id} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{doc.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {doc.document_type.replaceAll("_", " ")}
                              </p>
                            </div>
                            <RotuloDocumento documento={doc} hoje={hoje} />
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Emissão:{" "}
                            {doc.issue_date ? formatarData(doc.issue_date) : "Não informada"}
                            {" · "}
                            Validade:{" "}
                            {doc.expires_at ? formatarData(doc.expires_at) : "Não informada"}
                          </p>
                          {doc.notes && <p className="mt-1 text-sm">{doc.notes}</p>}
                          {doc.status === "active" && (doc.storage_path || doc.external_url) && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={opening}
                              onClick={() => void openDocument(doc)}
                            >
                              Abrir arquivo
                            </Button>
                          )}
                        </article>
                      ))}
                  </TabsContent>

                  <TabsContent value="homologacao" className="space-y-3">
                    <SupplierHomologationTab
                      tenantId={tenantId}
                      supplierId={fornecedor.id}
                      supplierCategory={fornecedor.category}
                      canEdit={true}
                    />
                  </TabsContent>

                  <TabsContent value="regularidade" className="space-y-3">
                    <SupplierRegularityPanel
                      tenantId={tenantId}
                      supplierId={fornecedor.id}
                      supplierCnpj={fornecedor.cnpj}
                      canEdit={true}
                    />
                  </TabsContent>

                  <TabsContent value="ia" className="space-y-3">
                    <SupplierAiCopilot
                      tenantId={tenantId}
                      supplierId={fornecedor.id}
                      supplierName={fornecedor.legal_name}
                      supplierCategory={fornecedor.category}
                    />
                  </TabsContent>

                  <TabsContent value="cotacoes" className="space-y-3">
                    <h3 className="font-semibold">Cotações vinculadas ao cadastro</h3>
                    <p className="text-xs text-muted-foreground">
                      Cada registro é uma cotação de item. Não representa uma contratação ou soma de
                      propostas distintas.
                    </p>
                    <SituacaoSecao
                      status={dados.cotacoes.status}
                      count={quoteRows.length}
                      empty="Nenhuma cotação vinculada pelo cadastro do fornecedor."
                    />
                    {dados.cotacoes.status === "ready" &&
                      dados.cotacoesContexto.contextUnavailable && (
                        <p
                          role="status"
                          className="rounded-md border p-2 text-sm text-muted-foreground"
                        >
                          As cotações foram carregadas, mas algumas informações de itens ou
                          processos estão indisponíveis.
                        </p>
                      )}
                    {dados.cotacoes.status === "ready" &&
                      quoteRows.map((quote) => {
                        const item = itemById.get(quote.procurement_item_id);
                        const process = item ? processById.get(item.process_id) : undefined;
                        return (
                          <article key={quote.id} className="rounded-md border p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-medium">
                                  {item?.description ?? "Item da cotação"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {process
                                    ? `Processo ${process.number} · ${process.title}`
                                    : quote.source_name}
                                </p>
                              </div>
                              <Badge variant={quote.is_active ? "outline" : "secondary"}>
                                {!quote.is_active
                                  ? "Inativa"
                                  : quote.selected_for_estimate
                                    ? "Selecionada para estimativa"
                                    : "Registrada"}
                              </Badge>
                            </div>
                            <p className="mt-2 text-sm">
                              Data: {formatarData(quote.quoted_at)} · Unitário:{" "}
                              {formatarMoeda(Number(quote.unit_price))}
                              {" · "}Qtd.: {Number(quote.quantity).toLocaleString("pt-BR")}
                              {quote.total_price != null &&
                                ` · Total do item: ${formatarMoeda(Number(quote.total_price))}`}
                            </p>
                            {process && (
                              <a
                                className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
                                href={`/processos?processo=${encodeURIComponent(process.id)}`}
                              >
                                Abrir processo <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                              </a>
                            )}
                          </article>
                        );
                      })}
                  </TabsContent>

                  <TabsContent value="instrumentos" className="space-y-3">
                    <h3 className="font-semibold">Contratos e atas de registro de preços</h3>
                    <SituacaoSecao
                      status={dados.instrumentos.status}
                      count={instrumentos.length}
                      empty="Nenhum contrato ou ata vinculado a este fornecedor."
                    />
                    {dados.instrumentos.status === "ready" &&
                      instrumentos.map((instrumento) => {
                        const dias = diasAteDataIso(instrumento.end_date, hoje);
                        return (
                          <article key={instrumento.id} className="rounded-md border p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium">
                                  {instrumento.instrument_type === "ata_registro_precos"
                                    ? "Ata"
                                    : "Contrato"}{" "}
                                  {instrumento.number}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {instrumento.object}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline">{instrumento.status}</Badge>
                                {instrumento.status === "vigente" &&
                                  dias !== null &&
                                  dias >= 0 &&
                                  dias <= 30 && (
                                    <Badge variant="secondary">Vence em {dias} dia(s)</Badge>
                                  )}
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              Vigência: {formatarData(instrumento.start_date)} a{" "}
                              {formatarData(instrumento.end_date)}
                              {" · "}Valor: {formatarMoeda(Number(instrumento.total_value))}
                            </p>
                            <p className="text-sm">
                              {dias === null
                                ? "Vigência não informada"
                                : dias < 0
                                  ? "Vencido há " + -dias + " dia(s)"
                                  : dias + " dia(s) até o vencimento"}
                            </p>
                            <a
                              className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
                              href={`/contratos?contrato=${encodeURIComponent(instrumento.id)}`}
                            >
                              Abrir instrumento <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                            </a>
                          </article>
                        );
                      })}
                  </TabsContent>

                  <TabsContent value="sancoes" className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">Sanções e impedimentos</h3>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onClose();
                          onManageSanctions(fornecedor);
                        }}
                        disabled={dados.sancoes.status !== "ready"}
                      >
                        <History className="mr-1 h-4 w-4" aria-hidden />
                        Consultar histórico completo
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Histórico registrado nesta Secretaria; não substitui consultas oficiais às
                      bases nacionais de impedimentos.
                    </p>
                    <SituacaoSecao
                      status={dados.sancoes.status}
                      count={sancoes.length}
                      empty="Nenhuma sanção registrada para este fornecedor nesta Secretaria."
                    />
                    {dados.sancoes.status === "ready" &&
                      sancoes.map((sancao) => {
                        const situacao = getSanctionDisplayStatus(sancao, hoje);
                        return (
                          <article key={sancao.id} className="rounded-md border p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-medium">{sancao.measure}</p>
                              <Badge variant={situacao === "vigente" ? "destructive" : "outline"}>
                                {situacao}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm">{sancao.reason}</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {formatarData(sancao.start_date)} a{" "}
                              {sancao.end_date
                                ? formatarData(sancao.end_date)
                                : "prazo indeterminado"}
                              {sancao.reference_number ? ` · Ref. ${sancao.reference_number}` : ""}
                            </p>
                          </article>
                        );
                      })}
                  </TabsContent>

                  <TabsContent value="cadastro" className="space-y-3">
                    {parseSupplierVerification(fornecedor.notes).verification && (
                      <Badge variant="outline">
                        Última consulta:{" "}
                        {formatarData(
                          parseSupplierVerification(fornecedor.notes).verification?.consultado_em,
                        )}{" "}
                        · {parseSupplierVerification(fornecedor.notes).verification?.situacao}
                      </Badge>
                    )}
                    <h3 className="font-semibold">Dados cadastrais</h3>
                    <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Razão social:</span>{" "}
                        {fornecedor.legal_name}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Nome fantasia:</span>{" "}
                        {fornecedor.trade_name || "Não informado"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">CNPJ:</span>{" "}
                        {formatarCnpj(fornecedor.cnpj)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Município/UF:</span>{" "}
                        {[fornecedor.city, fornecedor.state].filter(Boolean).join("/") ||
                          "Não informado"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Contato:</span>{" "}
                        {fornecedor.contact_name || "Não informado"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Telefone:</span>{" "}
                        {fornecedor.contact_phone || "Não informado"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">E-mail:</span>{" "}
                        {fornecedor.contact_email || "Não informado"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Situação:</span>{" "}
                        {fornecedor.status === "active" ? "Ativo" : "Inativo"}
                      </p>
                    </div>
                    {parseSupplierVerification(fornecedor.notes).notes && (
                      <div className="rounded-md border p-3 text-sm">
                        <p className="font-medium">Observações cadastrais</p>
                        <p className="mt-1 whitespace-pre-wrap">
                          {parseSupplierVerification(fornecedor.notes).notes}
                        </p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />A ausência de
                  registros só é confirmada para seções carregadas. O acesso é controlado por
                  permissões e políticas de cada Secretaria.
                </p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
