import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Printer,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData, formatarMoeda } from "@/lib/contratacao";
import {
  enviarPropostaPortalCotacao,
  montarEnderecoFornecedorPortal,
  obterDadosPortalCotacao,
  type QuotePortalData,
} from "@/lib/procurement-quote-portal";

type ItemDraft = {
  item_id: string;
  quoted: boolean;
  unitPriceText: string;
  deliveryCostText: string;
  brand_model: string;
};

function parseDecimalInput(raw: string): number {
  const normalized = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function QuotePortalView({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QuotePortalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryTerm, setDeliveryTerm] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [warrantyTerms, setWarrantyTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) {
      setErrorMsg("Link de cotação inválido. Nenhum token fornecido.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await obterDadosPortalCotacao(token);
      if (!res.success || !res.request || !res.supplier || !res.process || !res.tenant) {
        setErrorMsg(res.error || "Solicitação não encontrada ou expirada.");
        setData(null);
      } else {
        setData(res);
        setContactName(res.supplier.contact_name ?? "");
        setContactEmail(res.supplier.contact_email ?? "");
        setContactPhone(res.supplier.contact_phone ?? "");
        setAddress(montarEnderecoFornecedorPortal(res.supplier));

        const initialDrafts: Record<string, ItemDraft> = {};
        for (const item of res.items ?? []) {
          initialDrafts[item.id] = {
            item_id: item.id,
            quoted: true,
            unitPriceText: "",
            deliveryCostText: "0",
            brand_model: "",
          };
        }
        setItemDrafts(initialDrafts);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao carregar solicitação de cotação.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totalGlobal = useMemo(() => {
    const items = data?.items ?? [];
    return items.reduce((sum, item) => {
      const draft = itemDrafts[item.id];
      if (!draft?.quoted) return sum;
      const unitPrice = parseDecimalInput(draft.unitPriceText);
      const deliveryCost = parseDecimalInput(draft.deliveryCostText);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return sum;
      const safeDelivery = Number.isFinite(deliveryCost) && deliveryCost >= 0 ? deliveryCost : 0;
      return sum + item.quantity * unitPrice + safeDelivery;
    }, 0);
  }, [data?.items, itemDrafts]);

  function updateItemDraft(itemId: string, patch: Partial<ItemDraft>) {
    setItemDrafts((current) => {
      const prev = current[itemId] ?? {
        item_id: itemId,
        quoted: true,
        unitPriceText: "",
        deliveryCostText: "0",
        brand_model: "",
      };
      return { ...current, [itemId]: { ...prev, ...patch } };
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!data?.items?.length) return;

    if (!contactName.trim() || !contactEmail.trim() || !contactPhone.trim() || !address.trim()) {
      toast.error("Preencha responsável, e-mail, telefone e endereço completo da empresa.");
      return;
    }
    if (!deliveryTerm.trim() || !paymentTerms.trim()) {
      toast.error("Informe o prazo de entrega e as condições de pagamento.");
      return;
    }
    if (!confirmed) {
      toast.error("Confirme a declaração da proposta comercial antes de protocolar.");
      return;
    }

    const itemsPayload = [];
    let quotedCount = 0;

    for (const item of data.items) {
      const draft = itemDrafts[item.id];
      if (!draft?.quoted) {
        itemsPayload.push({ item_id: item.id, quoted: false });
        continue;
      }

      const unitPrice = parseDecimalInput(draft.unitPriceText);
      const deliveryCost = parseDecimalInput(draft.deliveryCostText || "0");
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        toast.error(`Informe um preço unitário válido para o item ${item.line_number}.`);
        return;
      }
      if (!Number.isFinite(deliveryCost) || deliveryCost < 0) {
        toast.error(`Frete inválido para o item ${item.line_number}.`);
        return;
      }

      quotedCount += 1;
      itemsPayload.push({
        item_id: item.id,
        quoted: true,
        unit_price: unitPrice,
        delivery_cost: deliveryCost,
        brand_model: draft.brand_model.trim() || null,
      });
    }

    if (quotedCount === 0) {
      toast.error("Cote pelo menos um item para protocolar a proposta.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await enviarPropostaPortalCotacao(token, {
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim(),
        address: address.trim(),
        delivery_term: deliveryTerm.trim(),
        payment_terms: paymentTerms.trim(),
        warranty_terms: warrantyTerms.trim() || null,
        notes: notes.trim() || null,
        items: itemsPayload,
      });

      if (!res.success) {
        throw new Error(res.error || "Não foi possível protocolar a proposta.");
      }

      toast.success(`Proposta protocolada com sucesso (${res.protocol})!`);
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao protocolar proposta.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">
            Validando solicitação de cotação eletrônica...
          </p>
        </div>
      </div>
    );
  }

  if (errorMsg || !data || !data.request || !data.supplier || !data.process || !data.tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <Card className="w-full max-w-md border-destructive/40 shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Link de Cotação Indisponível</CardTitle>
            <CardDescription className="pt-1 text-base">
              {errorMsg || "Este link é inválido ou expirou."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-xs text-muted-foreground">
            Caso precise responder à pesquisa de preços, solicite um novo link à Secretaria de
            Saúde.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { request, supplier, process, tenant, items = [] } = data;
  const jaProtocolada = request.status === "submitted" || request.status === "imported";

  return (
    <div className="min-h-screen bg-slate-50/70 pb-16 dark:bg-slate-950">
      <header className="border-b bg-white shadow-sm print:shadow-none dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl flex-col justify-between gap-4 px-4 py-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Cotação Eletrônica Oficial · Lei nº 14.133/2021
              </span>
              <h1 className="text-xl font-bold tracking-tight">{tenant.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground sm:text-right">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              Prazo limite: <strong>{formatarData(request.response_deadline)}</strong>
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-6 max-w-5xl space-y-6 px-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">Processo nº {process.number}</Badge>
              <Badge variant={jaProtocolada ? "default" : "secondary"}>
                {jaProtocolada ? "Proposta Protocolada" : "Aguardando Preenchimento"}
              </Badge>
            </div>
            <CardTitle className="text-lg">{process.title}</CardTitle>
            {process.description && <CardDescription>{process.description}</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-xs text-muted-foreground">Fornecedor Convidado</span>
              <p className="font-semibold">{supplier.trade_name || supplier.legal_name}</p>
              <p className="text-xs text-muted-foreground">CNPJ: {formatarCnpj(supplier.cnpj)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Solicitação Enviada em</span>
              <p className="font-medium">{formatarData(request.sent_at)}</p>
              {request.notes && (
                <p className="mt-1 text-xs text-muted-foreground">Obs.: {request.notes}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {jaProtocolada && request.submitted_payload ? (
          <Card className="border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                  <CardTitle className="text-base">
                    Proposta Protocolada — {request.submission_protocol}
                  </CardTitle>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="print:hidden"
                  onClick={() => window.print()}
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  Imprimir Comprovante
                </Button>
              </div>
              <CardDescription>
                Registrada em{" "}
                {request.submitted_at
                  ? new Date(request.submitted_at).toLocaleString("pt-BR")
                  : "—"}{" "}
                · Este protocolo bloqueia alterações posteriores para integridade da pesquisa de
                preços.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-md border bg-background p-3 text-xs">
                <p className="font-semibold text-foreground">Hash SHA-256 de Integridade:</p>
                <code className="mt-1 block break-all font-mono text-muted-foreground">
                  {request.submission_sha256}
                </code>
              </div>

              <div className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-2">
                <p>
                  <strong>Responsável:</strong> {request.submitted_payload.contact_name}
                </p>
                <p>
                  <strong>E-mail / Tel:</strong> {request.submitted_payload.contact_email} ·{" "}
                  {request.submitted_payload.contact_phone}
                </p>
                <p>
                  <strong>Prazo de entrega:</strong> {request.submitted_payload.delivery_term}
                </p>
                <p>
                  <strong>Pagamento:</strong> {request.submitted_payload.payment_terms}
                </p>
              </div>

              <div className="overflow-x-auto rounded-md border bg-background">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2.5">Item</th>
                      <th className="p-2.5">Descrição</th>
                      <th className="p-2.5">Qtd / Unid</th>
                      <th className="p-2.5">Marca / Modelo</th>
                      <th className="p-2.5 text-right">Unitário</th>
                      <th className="p-2.5 text-right">Frete</th>
                      <th className="p-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {request.submitted_payload.items.map((item) => (
                      <tr key={item.item_id} className="border-t">
                        <td className="p-2.5">{item.line_number}</td>
                        <td className="p-2.5 font-medium">{item.description}</td>
                        <td className="p-2.5">
                          {item.quantity} {item.unit}
                        </td>
                        <td className="p-2.5 text-muted-foreground">
                          {item.quoted ? item.brand_model || "—" : "Não cotado"}
                        </td>
                        <td className="p-2.5 text-right">
                          {item.quoted && item.unit_price !== null
                            ? formatarMoeda(Number(item.unit_price))
                            : "—"}
                        </td>
                        <td className="p-2.5 text-right">
                          {item.quoted ? formatarMoeda(Number(item.delivery_cost)) : "—"}
                        </td>
                        <td className="p-2.5 text-right font-semibold">
                          {item.quoted ? formatarMoeda(Number(item.total_price)) : "Não cotado"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  1. Dados do Proponente e Condições Comerciais
                </CardTitle>
                <CardDescription>
                  Obrigatório para formalização do Mapa Comparativo conforme Lei nº 14.133/2021.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="qp-contact-name">Responsável pela proposta *</Label>
                  <Input
                    id="qp-contact-name"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-contact-email">E-mail comercial *</Label>
                  <Input
                    id="qp-contact-email"
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="orcamento@empresa.com.br"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-contact-phone">Telefone / WhatsApp *</Label>
                  <Input
                    id="qp-contact-phone"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-address">Endereço completo da empresa *</Label>
                  <Input
                    id="qp-address"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Rua, número, bairro, cidade/UF, CEP"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-delivery">Prazo de entrega *</Label>
                  <Input
                    id="qp-delivery"
                    required
                    value={deliveryTerm}
                    onChange={(e) => setDeliveryTerm(e.target.value)}
                    placeholder="Ex.: Até 10 dias úteis após Ordem de Fornecimento"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-payment">Condições de pagamento *</Label>
                  <Input
                    id="qp-payment"
                    required
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="Ex.: 30 dias após atesto da nota fiscal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-warranty">Garantia / validade da proposta</Label>
                  <Input
                    id="qp-warranty"
                    value={warrantyTerms}
                    onChange={(e) => setWarrantyTerms(e.target.value)}
                    placeholder="Ex.: Proposta válida por 60 dias / Garantia 12 meses"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qp-notes">Observações adicionais</Label>
                  <Textarea
                    id="qp-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Informações complementares sobre entrega ou embalagem"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      2. Preenchimento dos Itens Solicitados
                    </CardTitle>
                    <CardDescription>
                      Informe o preço unitário e marca/modelo de cada item fornecido. Desmarque
                      itens que sua empresa não fornece.
                    </CardDescription>
                  </div>
                  <div className="rounded-lg border bg-muted/40 px-3 py-1.5 text-right">
                    <span className="block text-[11px] text-muted-foreground">
                      Total Global Cotado
                    </span>
                    <span className="text-base font-bold text-primary">
                      {formatarMoeda(totalGlobal)}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item) => {
                  const draft = itemDrafts[item.id] ?? {
                    item_id: item.id,
                    quoted: true,
                    unitPriceText: "",
                    deliveryCostText: "0",
                    brand_model: "",
                  };
                  const unitPriceNum = parseDecimalInput(draft.unitPriceText);
                  const deliveryNum = parseDecimalInput(draft.deliveryCostText);
                  const subtotal =
                    draft.quoted && Number.isFinite(unitPriceNum) && unitPriceNum > 0
                      ? item.quantity * unitPriceNum +
                        (Number.isFinite(deliveryNum) && deliveryNum >= 0 ? deliveryNum : 0)
                      : 0;

                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-4 transition-colors ${draft.quoted ? "bg-background" : "bg-muted/30 opacity-75"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">Item {item.line_number}</Badge>
                            <span className="text-xs font-medium text-muted-foreground">
                              Qtd: {item.quantity} {item.unit}
                            </span>
                          </div>
                          <p className="mt-1 font-semibold">{item.description}</p>
                          {item.technical_specification && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Especificação: {item.technical_specification}
                            </p>
                          )}
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                          <Checkbox
                            checked={draft.quoted}
                            onCheckedChange={(checked) =>
                              updateItemDraft(item.id, { quoted: checked === true })
                            }
                          />
                          Cotar este item
                        </label>
                      </div>

                      {draft.quoted && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-4">
                          <div className="space-y-1">
                            <Label htmlFor={`unit-${item.id}`} className="text-xs">
                              Preço unitário (R$) *
                            </Label>
                            <Input
                              id={`unit-${item.id}`}
                              inputMode="decimal"
                              required={draft.quoted}
                              value={draft.unitPriceText}
                              onChange={(e) =>
                                updateItemDraft(item.id, { unitPriceText: e.target.value })
                              }
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`freight-${item.id}`} className="text-xs">
                              Frete (R$)
                            </Label>
                            <Input
                              id={`freight-${item.id}`}
                              inputMode="decimal"
                              value={draft.deliveryCostText}
                              onChange={(e) =>
                                updateItemDraft(item.id, { deliveryCostText: e.target.value })
                              }
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`brand-${item.id}`} className="text-xs">
                              Marca / Modelo / Fabricante
                            </Label>
                            <Input
                              id={`brand-${item.id}`}
                              value={draft.brand_model}
                              onChange={(e) =>
                                updateItemDraft(item.id, { brand_model: e.target.value })
                              }
                              placeholder="Ex.: MedFarma"
                            />
                          </div>
                          <div className="flex flex-col justify-end rounded-md bg-muted/40 px-3 py-2 text-right">
                            <span className="text-[11px] text-muted-foreground">Subtotal</span>
                            <span className="text-sm font-bold">{formatarMoeda(subtotal)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 pt-6">
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(checked) => setConfirmed(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Declaro, para fins de pesquisa de preços nos termos da Lei nº 14.133/2021, que
                    as informações e valores unitários acima refletem proposta comercial formal
                    desta empresa, gerando protocolo eletrônico com hash SHA-256 após o envio.
                  </span>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    Envio único até {formatarData(request.response_deadline)}
                  </span>
                  <Button type="submit" disabled={submitting} size="lg">
                    {submitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    {submitting ? "Protocolando proposta..." : "Protocolar Proposta Oficial"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        )}

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground print:hidden">
          <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
          <span>Primus Gestão · Pesquisa Formal de Preços Auditável</span>
        </div>
      </main>
    </div>
  );
}
