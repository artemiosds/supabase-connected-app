import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  FileDown,
  Link2,
  Loader2,
  Mail,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { SupplierSelect, type SupplierOption } from "@/components/supplier-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData, formatarMoeda } from "@/lib/contratacao";
import { db } from "@/lib/db";
import { carregarTimbradoSecretaria } from "@/lib/document-branding";
import { buildDocxFromText, docxToModel, renderPdf } from "@/lib/docx-engine";
import {
  buildFormalQuotePdfText,
  buildQuotePortalUrl,
  cancelarSolicitacaoCotacaoPortal,
  criarSolicitacaoCotacaoPortal,
  enviarConviteCotacaoEmail,
  marcarSolicitacaoCotacaoImportada,
  rotuloStatusSolicitacaoCotacao,
  type ProcurementQuoteRequestRow,
  type QuotePortalSubmittedPayload,
} from "@/lib/procurement-quote-portal";

type SupplierInfo = SupplierOption & {
  status?: string;
  contact_email?: string | null;
  contact_name?: string | null;
};

type Props = {
  tenantId: string;
  processId: string;
  processNumber: string;
  processTitle: string;
  userId: string;
  itemsCount: number;
  suppliers: SupplierInfo[];
  onSaved: () => Promise<void>;
};

function defaultDeadlineISO(daysAhead = 5): string {
  const target = new Date();
  target.setDate(target.getDate() + daysAhead);
  return target.toLocaleDateString("sv-SE");
}

export function SupplierQuotePortalDialog({
  tenantId,
  processId,
  processNumber,
  processTitle,
  userId,
  itemsCount,
  suppliers,
  onSaved,
}: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () => scope.current.tenant === tenantId && scope.current.user === userId;

  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<ProcurementQuoteRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [justification, setJustification] = useState("");
  const [deadline, setDeadline] = useState(() => defaultDeadlineISO(5));
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  const activeSuppliers = suppliers.filter((s) => !s.status || s.status === "active");

  // pré-preenche e-mail ao trocar fornecedor
  useEffect(() => {
    const found = suppliers.find((s) => s.id === supplierId);
    setEmailRecipient(found?.contact_email?.trim() ?? "");
  }, [supplierId, suppliers]);

  const carregarSolicitacoes = useCallback(async () => {
    if (!tenantId || !processId) return;
    setLoading(true);
    const { data, error } = await db
      .from("procurement_quote_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("process_id", processId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Não foi possível carregar as solicitações de cotação online.");
      setRequests([]);
    } else {
      setRequests(data ?? []);
    }
    setLoading(false);
  }, [tenantId, processId]);

  useEffect(() => {
    if (!open) return;
    void carregarSolicitacoes();
  }, [open, carregarSolicitacoes]);

  useEffect(() => {
    if (!tenantId || !processId) return;
    void carregarSolicitacoes();
  }, [tenantId, processId, carregarSolicitacoes]);

  const submittedCount = requests.filter((r) => r.status === "submitted").length;

  async function copiarTexto(value: string, id: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      toast.success(message);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      toast.error("Não foi possível copiar para a área de transferência.");
    }
  }

  async function handleCriarSolicitacao() {
    if (!inScope()) {
      toast.error("A sessão ou a Secretaria mudou. Reabra o processo.");
      return;
    }
    if (!supplierId) {
      toast.error("Selecione o fornecedor para gerar o link.");
      return;
    }
    if (justification.trim().length < 10) {
      toast.error("Informe a justificativa da escolha do fornecedor (mínimo de 10 caracteres).");
      return;
    }
    if (!deadline) {
      toast.error("Informe o prazo limite de resposta.");
      return;
    }

    setCreating(true);
    try {
      const created = await criarSolicitacaoCotacaoPortal({
        tenantId,
        processId,
        supplierId,
        selectionJustification: justification.trim(),
        responseDeadline: deadline,
        notes: notes.trim(),
      });
      await copiarTexto(
        created.url,
        created.id,
        "Link de cotação gerado e copiado para a área de transferência!",
      );
      setSupplierId("");
      setJustification("");
      setNotes("");
      await carregarSolicitacoes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar solicitação de cotação.");
    } finally {
      setCreating(false);
    }
  }

  async function handleEnviarEmail(req: ProcurementQuoteRequestRow, recipient: string) {
    if (!inScope()) {
      toast.error("A sessão ou a Secretaria mudou. Reabra o processo.");
      return;
    }
    const normalizedRecipient = recipient.trim().toLowerCase();
    if (!normalizedRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecipient)) {
      toast.error("Informe um endereço de e-mail válido do fornecedor.");
      return;
    }
    const token = session?.access_token;
    if (!token) {
      toast.error("Sessão expirada. Recarregue a página.");
      return;
    }

    setSendingEmailId(req.id);
    try {
      const result = await enviarConviteCotacaoEmail({
        tenantId,
        quoteRequestId: req.id,
        recipientEmail: normalizedRecipient,
        accessToken: token,
      });
      if (result.success) {
        toast.success(
          `Convite de cotação enviado para ${normalizedRecipient}${result.outcome === "accepted" ? " ✔" : ""}.`,
        );
        await carregarSolicitacoes();
      } else if (result.outcome === "uncertain") {
        toast.warning(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível enviar o convite por e-mail.",
      );
    } finally {
      setSendingEmailId(null);
    }
  }

  async function handleCancelar(requestId: string) {
    if (!inScope()) return;
    setBusyRequestId(requestId);
    try {
      await cancelarSolicitacaoCotacaoPortal(tenantId, requestId);
      toast.success("Solicitação cancelada.");
      await carregarSolicitacoes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar solicitação.");
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleImportarProposta(req: ProcurementQuoteRequestRow) {
    if (!inScope()) {
      toast.error("A sessão ou a Secretaria mudou. Reabra o processo.");
      return;
    }
    if (req.status !== "submitted" || !req.submitted_payload || !req.submission_protocol) {
      toast.error("Proposta inválida ou ainda não submetida pelo fornecedor.");
      return;
    }

    const payload = req.submitted_payload as unknown as QuotePortalSubmittedPayload;
    const quotedItems = (payload.items ?? []).filter(
      (item) => item.quoted && item.unit_price !== null && Number(item.unit_price) > 0,
    );
    if (quotedItems.length === 0) {
      toast.error("A proposta submetida não contém itens com preço válido.");
      return;
    }

    const supplier = suppliers.find((s) => s.id === req.supplier_id);
    const supplierName = supplier?.trade_name || supplier?.legal_name || payload.contact_name;
    const supplierCnpj = supplier?.cnpj || "";
    const tenantName = selecionado?.nome || "Secretaria Municipal de Saúde";

    setBusyRequestId(req.id);
    try {
      const formalText = buildFormalQuotePdfText({
        tenantName,
        processNumber,
        processTitle,
        supplierName,
        supplierCnpj,
        protocol: req.submission_protocol,
        sha256: req.submission_sha256 ?? "",
        sentAt: req.sent_at,
        responseDeadline: req.response_deadline,
        submittedAt: req.submitted_at ?? req.updated_at,
        payload,
      });

      const branding = await carregarTimbradoSecretaria(tenantId, tenantName);
      const docxBytes = await buildDocxFromText(
        formalText,
        `Proposta Eletrônica ${req.submission_protocol}`,
      );
      const model = await docxToModel(docxBytes);
      const pdfBytes = await renderPdf(model, {
        branding,
        title: `Proposta ${req.submission_protocol}`,
      });
      const pdfBlob = new Blob([pdfBytes.slice().buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const evidenceFileName = `Proposta-${req.submission_protocol}.pdf`;

      for (const item of quotedItems) {
        const quotedAtDate = (req.submitted_at ?? new Date().toISOString()).slice(0, 10);
        const { data: savedQuote, error: insertError } = await db
          .from("procurement_price_quotes")
          .insert({
            tenant_id: tenantId,
            procurement_item_id: item.item_id,
            supplier_id: req.supplier_id,
            source_name: supplier?.legal_name || supplierName,
            source_type: "fornecedor",
            supplier_selection_justification: req.selection_justification,
            reference_identifier: req.submission_protocol,
            quoted_at: quotedAtDate,
            supplier_consultation_sent_at: req.sent_at,
            supplier_consultation_response_deadline: req.response_deadline,
            source_tax_id: supplierCnpj,
            source_contact_name: payload.contact_name,
            source_contact_email: payload.contact_email,
            source_contact_phone: payload.contact_phone,
            source_address: payload.address,
            brand_model: item.brand_model || null,
            delivery_term: payload.delivery_term,
            payment_terms: payload.payment_terms,
            warranty_terms: payload.warranty_terms || null,
            quantity: item.quantity,
            unit_price: Number(item.unit_price),
            delivery_cost: Number(item.delivery_cost || 0),
            notes: `Cotação eletrônica protocolada (${req.submission_protocol} · SHA-256: ${(req.submission_sha256 ?? "").slice(0, 12)}...)`,
            created_by: userId,
            updated_by: userId,
          })
          .select("id")
          .single();

        if (insertError || !savedQuote) {
          throw new Error(
            insertError?.message ?? `Erro ao gravar cotação do item ${item.line_number}.`,
          );
        }

        const storagePath = `${tenantId}/procurement-quotes/${item.item_id}/${savedQuote.id}/${crypto.randomUUID()}.pdf`;
        const { error: uploadError } = await db.storage
          .from("gfs-private-documents")
          .upload(storagePath, pdfBlob, { contentType: "application/pdf", upsert: false });

        if (uploadError) {
          throw new Error(
            `Cotação gravada, mas falhou anexo do comprovante PDF: ${uploadError.message}`,
          );
        }

        const { error: linkError } = await db
          .from("procurement_price_quotes")
          .update({
            evidence_storage_path: storagePath,
            evidence_file_name: evidenceFileName,
            evidence_mime_type: "application/pdf",
            evidence_file_size: pdfBlob.size,
            updated_by: userId,
          })
          .eq("tenant_id", tenantId)
          .eq("id", savedQuote.id);

        if (linkError) {
          await db.storage.from("gfs-private-documents").remove([storagePath]);
          throw new Error(`Falha ao vincular PDF da cotação: ${linkError.message}`);
        }
      }

      await marcarSolicitacaoCotacaoImportada(tenantId, req.id);
      toast.success(
        `Proposta ${req.submission_protocol} importada (${quotedItems.length} item(ns)) com comprovante PDF timbrado!`,
      );
      await carregarSolicitacoes();
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar proposta eletrônica.");
    } finally {
      setBusyRequestId(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={itemsCount === 0}
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-4 w-4" aria-hidden />
        Cotação Online (Fornecedor)
        {submittedCount > 0 && (
          <Badge variant="default" className="ml-1.5">
            {submittedCount} recebida(s)
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Cotação Eletrônica via Portal do Fornecedor</DialogTitle>
            <DialogDescription>
              Gere um link único com validade para que o fornecedor preencha preços unitários, frete
              e marca diretamente, gerando protocolo SHA-256 e comprovante em PDF timbrado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-semibold">Nova Solicitação de Orçamento</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Fornecedor convidado *</Label>
                  <SupplierSelect
                    suppliers={activeSuppliers}
                    value={supplierId}
                    onValueChange={setSupplierId}
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-req-deadline">Prazo limite para resposta *</Label>
                  <Input
                    id="qp-req-deadline"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-req-notes">Orientações ao fornecedor (opcional)</Label>
                  <Input
                    id="qp-req-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ex.: Entregar no Almoxarifado Central"
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="qp-req-just">
                    Justificativa da escolha do fornecedor (Lei nº 14.133/2021) *
                  </Label>
                  <Textarea
                    id="qp-req-just"
                    rows={2}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Ex.: Fornecedor regional do ramo pertinente com histórico de fornecimento regular."
                    disabled={creating}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={creating || itemsCount === 0}
                  onClick={() => void handleCriarSolicitacao()}
                >
                  {creating ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-4 w-4" />
                  )}
                  Gerar e Copiar Link de Cotação
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Solicitações Geradas ({requests.length})</p>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {requests.length === 0 ? (
                <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
                  Nenhuma solicitação online gerada para este processo até o momento.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {requests.map((req) => {
                    const supplier = suppliers.find((s) => s.id === req.supplier_id);
                    const badge = rotuloStatusSolicitacaoCotacao(req.status);
                    const url = buildQuotePortalUrl(req.token);
                    const payload = req.submitted_payload as QuotePortalSubmittedPayload | null;
                    const quotedItems =
                      payload?.items?.filter((i) => i.quoted && i.unit_price !== null) ?? [];
                    const totalProposta = quotedItems.reduce(
                      (acc, i) => acc + Number(i.total_price || 0),
                      0,
                    );
                    const isBusy = busyRequestId === req.id;

                    return (
                      <div key={req.id} className="space-y-2 rounded-lg border p-3.5 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">
                              {supplier?.trade_name || supplier?.legal_name || "Fornecedor"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {supplier?.cnpj ? `CNPJ: ${formatarCnpj(supplier.cnpj)} · ` : ""}
                              Enviada em {formatarData(req.sent_at)} · Prazo:{" "}
                              {formatarData(req.response_deadline)}
                            </p>
                          </div>
                          <Badge variant={badge.variante}>{badge.label}</Badge>
                        </div>

                        {req.submission_protocol && (
                          <div className="rounded border bg-muted/40 px-3 py-2 text-xs">
                            <p className="font-medium">
                              Protocolo {req.submission_protocol} · {quotedItems.length} item(ns)
                              cotado(s) · Total {formatarMoeda(totalProposta)}
                            </p>
                            {req.submission_sha256 && (
                              <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                                SHA-256: {req.submission_sha256}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          {req.status === "pending" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void copiarTexto(
                                    url,
                                    req.id,
                                    "Link copiado para a área de transferência!",
                                  )
                                }
                              >
                                {copiedId === req.id ? (
                                  <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="mr-1 h-3.5 w-3.5" />
                                )}
                                Copiar Link
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void copiarTexto(
                                    `Prezado(a), solicitamos cotação de preços para o Processo nº ${processNumber} (${processTitle}) até ${formatarData(req.response_deadline)}. Acesse o link seguro para informar os preços diretamente: ${url}`,
                                    `${req.id}-msg`,
                                    "Mensagem pronta para e-mail/WhatsApp copiada!",
                                  )
                                }
                              >
                                <Send className="mr-1 h-3.5 w-3.5" />
                                Copiar Convite (E-mail/WhatsApp)
                              </Button>

                              {/* ── ENVIO INSTITUCIONAL POR E-MAIL ── */}
                              <div className="flex w-full items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5">
                                <Mail
                                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                                <Input
                                  type="email"
                                  aria-label={`E-mail do fornecedor para enviar convite — ${supplier?.trade_name || supplier?.legal_name || "fornecedor"}`}
                                  placeholder="e-mail do fornecedor"
                                  className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                                  value={
                                    req.id === sendingEmailId || req.email_sent_at
                                      ? (req.email_sent_to ?? emailRecipient)
                                      : emailRecipient
                                  }
                                  onChange={(e) => setEmailRecipient(e.target.value)}
                                  disabled={sendingEmailId === req.id}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  className="h-7 shrink-0 px-2 text-xs"
                                  disabled={sendingEmailId === req.id}
                                  onClick={() => void handleEnviarEmail(req, emailRecipient)}
                                >
                                  {sendingEmailId === req.id ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Mail className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  Enviar por E-mail Institucional
                                </Button>
                              </div>
                              {req.email_sent_at && req.email_sent_to && (
                                <p className="w-full text-[11px] text-muted-foreground">
                                  ✔ Convite enviado em{" "}
                                  {new Date(req.email_sent_at).toLocaleString("pt-BR", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}{" "}
                                  para <span className="font-medium">{req.email_sent_to}</span>
                                  {req.email_provider ? ` (${req.email_provider})` : ""}
                                </p>
                              )}

                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isBusy}
                                onClick={() => void handleCancelar(req.id)}
                              >
                                {isBusy ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <XCircle className="mr-1 h-3.5 w-3.5 text-destructive" />
                                )}
                                Cancelar
                              </Button>
                            </>
                          )}

                          {req.status === "submitted" && (
                            <Button
                              type="button"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleImportarProposta(req)}
                            >
                              {isBusy ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                              ) : (
                                <FileDown className="mr-1.5 h-4 w-4" />
                              )}
                              Importar para Matriz (com PDF Timbrado)
                            </Button>
                          )}

                          {req.status === "imported" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Cotações e comprovante PDF já integrados à pesquisa de preços.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
