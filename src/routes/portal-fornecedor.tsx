import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Printer,
  ShieldCheck,
  Upload,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData } from "@/lib/contratacao";
import {
  enviarDocumentoPortal,
  obterDadosPortalFornecedor,
  resumirChecklistPortal,
  rotuloChecklistPortal,
  validarLinkDocumentoPortal,
  type PortalChecklistItem,
  type PortalResponseData,
} from "@/lib/supplier-portal";
import { rotuloStatusHomologacao, type HomologationStatus } from "@/lib/supplier-homologation";
import { QuotePortalView } from "@/components/suppliers/quote-portal-view";

export const Route = createFileRoute("/portal-fornecedor")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search["token"] as string) || "",
    cotacao: (search["cotacao"] as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Portal de Autoatendimento do Fornecedor — Primus Gestão" },
      {
        name: "description",
        content: "Envio de certidões, homologação cadastral e cotações eletrônicas.",
      },
    ],
  }),
  component: PortalFornecedorPage,
});

function PortalFornecedorPage() {
  const { token, cotacao } = Route.useSearch();

  if (cotacao) {
    return <QuotePortalView token={cotacao} />;
  }

  return <PortalHomologacaoView token={token} />;
}

function PortalHomologacaoView({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PortalResponseData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PortalChecklistItem | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("outros");
  const [docExpiresAt, setDocExpiresAt] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastProtocol, setLastProtocol] = useState<string | null>(null);

  const carregarDados = useCallback(async () => {
    if (!token) {
      setErrorMsg("Link de acesso inválido. Nenhum token de autenticação fornecido.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await obterDadosPortalFornecedor(token);
      if (!res.success) {
        setErrorMsg(res.error || "Acesso não autorizado ou link expirado.");
      } else {
        setData(res);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar dados";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  const handleOpenUpload = (item?: PortalChecklistItem) => {
    setSelectedItem(item ?? null);
    setDocTitle(item?.title ?? "");
    setDocType(item?.document_type ?? "outros");
    setDocExpiresAt("");
    setDocUrl("");
    setUploadModalOpen(true);
  };

  const handleEnviarDocumento = async () => {
    if (docTitle.trim().length < 2) {
      toast.error("Título obrigatório", {
        description: "Informe um título com pelo menos 2 caracteres.",
      });
      return;
    }

    const urlCheck = validarLinkDocumentoPortal(docUrl);
    if (!urlCheck.valid) {
      toast.error("Link do documento obrigatório", {
        description: urlCheck.error,
      });
      return;
    }

    try {
      setSubmitting(true);
      const res = await enviarDocumentoPortal({
        token,
        ...(selectedItem?.id ? { checklist_item_id: selectedItem.id } : {}),
        title: docTitle.trim(),
        document_type: selectedItem?.document_type || docType || "outros",
        external_url: urlCheck.url,
        ...(docExpiresAt ? { expires_at: docExpiresAt } : {}),
      });

      if (!res.success) {
        throw new Error(res.error || "Falha ao enviar documento");
      }

      setLastProtocol(res.protocol || "PROTO-REGISTRADO");
      toast.success("Documento enviado com sucesso!", {
        description: `Protocolo gerado: ${res.protocol}`,
      });

      setUploadModalOpen(false);
      await carregarDados();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro no envio";
      toast.error("Erro ao enviar documento", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Validando credencial do fornecedor…</p>
        </div>
      </div>
    );
  }

  if (errorMsg || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="max-w-md w-full border-destructive/30">
          <CardHeader className="text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-2" />
            <CardTitle className="text-lg">Acesso Indisponível</CardTitle>
            <CardDescription>
              {errorMsg || "Não foi possível carregar as informações."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-xs text-muted-foreground">
              Por favor, entre em contato com a equipe de compras e contratos da Secretaria
              responsável para solicitar um novo link de acesso.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { supplier, tenant, homologation, checklist_items = [], documents = [] } = data;
  const homologStatus = homologation
    ? rotuloStatusHomologacao(homologation.status as HomologationStatus)
    : null;
  const homologEncerrada =
    homologation?.status === "completed" || homologation?.status === "cancelled";
  const checklistResumo = resumirChecklistPortal(checklist_items);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-card border rounded-lg p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              {tenant?.name || "Secretaria Responsável"}
            </div>
            <h1 className="text-xl font-bold mt-1">Portal de Autoatendimento do Fornecedor</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Envio seguro de documentos, certidões e acompanhamento de homologação cadastral.
            </p>
          </div>
          <Badge
            variant="outline"
            className="self-start sm:self-auto py-1 px-3 text-xs border-primary/30"
          >
            Ambiente Seguro · Lei nº 14.133/2021
          </Badge>
        </div>

        {lastProtocol && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                  Documento recebido com fé pública!
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Comprovante / Protocolo: <strong>{lastProtocol}</strong>. O documento foi anexado
                  à fila de conferência dos servidores responsáveis.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="print:hidden"
              onClick={() => window.print()}
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              Imprimir Comprovante
            </Button>
          </div>
        )}

        <Card className="border-border shadow-sm">
          <CardHeader className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  {supplier?.legal_name}
                </CardTitle>
                <CardDescription className="text-xs">
                  CNPJ: {formatarCnpj(supplier?.cnpj || "")} · Ramo: {supplier?.category || "Geral"}
                </CardDescription>
              </div>
              <Badge
                variant={supplier?.status === "active" ? "secondary" : "outline"}
                className="self-start"
              >
                {supplier?.status === "active" ? "Cadastro Ativo" : "Cadastro Pendente"}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {homologation && homologStatus && (
          <Card className="border-border shadow-sm bg-muted/20">
            <CardHeader className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Processo de Habilitação e Homologação
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Iniciado em {formatarData(homologation.created_at)}
                  </CardDescription>
                </div>
                <Badge variant={homologStatus.variant} className="self-start sm:self-auto">
                  {homologStatus.label}
                </Badge>
              </div>
              {homologation.conclusion_notes && (
                <div className="mt-3 p-3 bg-card border rounded text-xs text-muted-foreground">
                  <strong>Orientações da Secretaria:</strong> {homologation.conclusion_notes}
                </div>
              )}
            </CardHeader>
          </Card>
        )}

        <Card className="border-border shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Documentos e Certidões Solicitadas
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {homologEncerrada
                    ? "Esta análise de homologação já foi encerrada; os documentos ficam disponíveis apenas para consulta."
                    : "Envie ou atualize os links oficiais abaixo para manter a habilitação regular na Secretaria."}
                </CardDescription>
              </div>
              {!homologEncerrada && (
                <Button
                  size="sm"
                  variant="outline"
                  className="print:hidden"
                  onClick={() => handleOpenUpload()}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Enviar Documento Avulso
                </Button>
              )}
            </div>
            {checklistResumo.total > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant="secondary" className="text-[11px]">
                  {checklistResumo.aprovados}/{checklistResumo.total} aprovado(s)
                </Badge>
                {checklistResumo.recebidos > 0 && (
                  <Badge variant="outline" className="text-[11px]">
                    {checklistResumo.recebidos} em conferência
                  </Badge>
                )}
                {checklistResumo.obrigatoriosPendentes > 0 && (
                  <Badge variant="destructive" className="text-[11px]">
                    {checklistResumo.obrigatoriosPendentes} obrigatório(s) pendente(s)
                  </Badge>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {checklist_items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhum item específico pendente no momento.
              </p>
            ) : (
              checklist_items.map((item) => {
                const statusMeta = rotuloChecklistPortal(item.verification_status);
                const pendente =
                  !homologEncerrada &&
                  (item.verification_status === "not_submitted" ||
                    item.verification_status === "pending_issue" ||
                    item.verification_status === "expired");

                return (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{item.title}</span>
                        {item.is_mandatory && (
                          <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                            Obrigatório
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      )}
                      {item.notes && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                          Observação: {item.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <Badge variant={statusMeta.variante} className="text-xs">
                        {statusMeta.label}
                      </Badge>
                      {pendente && (
                        <Button size="sm" onClick={() => handleOpenUpload(item)}>
                          <Upload className="w-3.5 h-3.5 mr-1.5" />
                          Enviar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {documents.length > 0 && (
          <Card className="border-border shadow-sm">
            <CardHeader className="py-4">
              <CardTitle className="text-sm">Documentos Registrados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {documents.map((doc) => (
                  <div key={doc.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium text-foreground">{doc.title}</p>
                      <p className="text-muted-foreground">
                        {doc.document_type.replaceAll("_", " ")}
                      </p>
                    </div>
                    <div className="text-right text-muted-foreground">
                      {doc.expires_at ? (
                        <span>Validade: {formatarData(doc.expires_at)}</span>
                      ) : (
                        <span>Sem validade</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-xs text-muted-foreground py-4">
          Primus Gestão · Gestão Pública de Contratações e Saúde · Todos os direitos reservados
        </div>
      </div>

      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Enviar Documento / Certidão</DialogTitle>
            <DialogDescription>
              Envie o comprovante para atendimento da exigência cadastral da Secretaria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title" className="text-xs">
                Título ou Identificação do Documento *
              </Label>
              <Input
                id="doc-title"
                required
                minLength={2}
                maxLength={180}
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Ex: Certidão Negativa de Débitos Relativos a Créditos Tributários"
                className="text-xs"
              />
            </div>

            {!selectedItem && (
              <div className="space-y-1.5">
                <Label htmlFor="doc-type" className="text-xs">
                  Tipo do Documento
                </Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger id="doc-type" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="certidao_federal">Certidão Federal</SelectItem>
                    <SelectItem value="certidao_estadual">Certidão Estadual</SelectItem>
                    <SelectItem value="certidao_municipal">Certidão Municipal</SelectItem>
                    <SelectItem value="fgts">Regularidade FGTS</SelectItem>
                    <SelectItem value="trabalhista">CNDT / Trabalhista</SelectItem>
                    <SelectItem value="sanitaria">Licença / Alvará Sanitário</SelectItem>
                    <SelectItem value="alvara">Alvará de Funcionamento</SelectItem>
                    <SelectItem value="proposta">Proposta / Catálogo</SelectItem>
                    <SelectItem value="outros">Outros Comprovantes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="doc-url" className="text-xs">
                Link Oficial da Certidão ou Arquivo (HTTPS) *
              </Label>
              <Input
                id="doc-url"
                type="url"
                required
                maxLength={2048}
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="https://..."
                className="text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Informe a URL http:// ou https:// do comprovante oficial ou documento em nuvem.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-expires" className="text-xs">
                Data de Validade (se houver)
              </Label>
              <Input
                id="doc-expires"
                type="date"
                value={docExpiresAt}
                onChange={(e) => setDocExpiresAt(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadModalOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void handleEnviarDocumento()} disabled={submitting}>
              {submitting ? "Transmitindo..." : "Confirmar Envio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
