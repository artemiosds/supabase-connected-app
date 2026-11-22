import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, FileText, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { AI_FEATURES, type AiFeatureKey } from "@/lib/ai-capabilities";
import { db } from "@/lib/db";

type Message = { role: "user" | "assistant"; content: string };
type Choice = { id: string; label: string; secondary?: string };
type Capabilities = { enabled: boolean; features: AiFeatureKey[] };
const NEEDS_RECORD = new Set<AiFeatureKey>([
  "documents",
  "price_research",
  "supplier_documents",
  "delivery_receiving",
]);

async function readFunctionError(
  error: { message: string; context?: unknown } | null,
): Promise<string> {
  if (!error) return "Não foi possível concluir a solicitação.";
  const context = error.context;
  if (context && typeof context === "object" && "json" in context) {
    try {
      const payload = await (context as { json: () => Promise<{ error?: string }> }).json();
      if (typeof payload.error === "string") return payload.error;
    } catch {
      /* Retorna mensagem neutra abaixo. */
    }
  }
  return "Não foi possível concluir a solicitação. Confira o acesso à Secretaria e tente novamente.";
}

export function PrimusAiAssistant() {
  const { session } = useAuth();
  const { selecionado, loading: tenantLoading, supportAccess } = useTenant();
  const [open, setOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [loadingCapabilities, setLoadingCapabilities] = useState(false);
  const [feature, setFeature] = useState<AiFeatureKey | "">("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [recordId, setRecordId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);

  const availableFeatures = useMemo(
    () => AI_FEATURES.filter((item) => capabilities?.features.includes(item.key)),
    [capabilities],
  );
  const currentFeature = availableFeatures.find((item) => item.key === feature);
  const isUnavailableDuringSupport = Boolean(supportAccess?.session_id);

  useEffect(() => {
    if (!open || !selecionado?.id || !session?.access_token) return;
    let cancelled = false;
    setLoadingCapabilities(true);
    setCapabilityError("");
    setCapabilities(null);
    setFeature("");
    setRecordId("");
    setChoices([]);
    setMessages([]);
    void db.functions
      .invoke<Capabilities>("primus-ai", {
        body: { action: "capabilities", tenant_id: selecionado.id },
      })
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setCapabilityError(await readFunctionError(error));
          return;
        }
        const safeFeatures = Array.isArray(data?.features)
          ? data.features.filter((key): key is AiFeatureKey =>
              AI_FEATURES.some((item) => item.key === key),
            )
          : [];
        setCapabilities({ enabled: data?.enabled === true, features: safeFeatures });
        setFeature(safeFeatures[0] ?? "");
        if (!safeFeatures.length)
          setCapabilityError(
            "A IA ainda não está habilitada para esta Secretaria. Solicite ao Administrador Master a configuração e a liberação dos recursos.",
          );
      })
      .catch(() =>
        setCapabilityError("Não foi possível verificar as permissões da IA nesta Secretaria."),
      )
      .finally(() => {
        if (!cancelled) setLoadingCapabilities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selecionado?.id, session?.access_token]);

  useEffect(() => {
    if (!open || !selecionado?.id || !feature || !NEEDS_RECORD.has(feature)) {
      setChoices([]);
      setRecordId("");
      return;
    }
    let cancelled = false;
    setLoadingChoices(true);
    setRecordId("");
    const loadChoices = async () => {
      if (feature === "documents" || feature === "price_research") {
        const { data, error } = await db
          .from("procurement_processes")
          .select("id,number,title")
          .eq("tenant_id", selecionado.id)
          .order("updated_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return (data ?? []).map((row) => ({ id: row.id, label: `${row.number} — ${row.title}` }));
      }
      if (feature === "supplier_documents") {
        const { data, error } = await db
          .from("suppliers")
          .select("id,legal_name,trade_name,cnpj")
          .eq("tenant_id", selecionado.id)
          .order("legal_name")
          .limit(100);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          label: row.trade_name || row.legal_name,
          secondary: row.cnpj ?? undefined,
        }));
      }
      const { data, error } = await db
        .from("contracts")
        .select("id,number,object,status")
        .eq("tenant_id", selecionado.id)
        .order("end_date", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        label: `${row.number} — ${row.object}`,
        secondary: row.status,
      }));
    };
    void loadChoices()
      .then((next) => {
        if (!cancelled) setChoices(next);
      })
      .catch(() => {
        if (!cancelled)
          toast.error("Não foi possível carregar os registros disponíveis para esta Secretaria.");
      })
      .finally(() => {
        if (!cancelled) setLoadingChoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selecionado?.id, feature]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !feature || !selecionado?.id || sending) return;
    if (messages.length >= 9) {
      toast.error("Esta conversa atingiu o limite. Limpe-a para começar outra.");
      return;
    }
    if (NEEDS_RECORD.has(feature) && !recordId) {
      toast.error("Selecione o registro que deseja analisar.");
      return;
    }
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setPrompt("");
    setSending(true);
    try {
      const { data, error } = await db.functions.invoke<{ text?: string }>("primus-ai", {
        body: {
          action: "assist",
          tenant_id: selecionado.id,
          feature,
          record_id: recordId || undefined,
          messages: nextMessages,
        },
      });
      if (error) throw new Error(await readFunctionError(error));
      if (!data?.text) throw new Error("A IA não retornou uma resposta válida.");
      setMessages((current) => [...current, { role: "assistant", content: data.text! }]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível gerar a resposta.");
    } finally {
      setSending(false);
    }
  }

  async function downloadDocumentDraft(content: string, format: "docx" | "pdf") {
    if (!selecionado) return;
    try {
      const [
        { assertPdfCompatible, buildDocxFromText, docxToModel, generateDocx, renderPdf },
        { carregarTimbradoSecretaria },
      ] = await Promise.all([import("@/lib/docx-engine"), import("@/lib/document-branding")]);
      const branding = await carregarTimbradoSecretaria(selecionado.id, selecionado.nome);
      if (!branding.footerText.trim())
        branding.footerText = "Rascunho gerado com apoio de IA — revisar antes de utilizar";
      const template = await buildDocxFromText(
        content,
        "RASCUNHO PARA REVISÃO — DOCUMENTO PREPARATÓRIO",
      );
      const generated = await generateDocx({ template, values: {}, items: [], branding });
      let bytes: Uint8Array = generated.bytes;
      let mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (format === "pdf") {
        assertPdfCompatible(generated.warnings);
        bytes = await renderPdf(await docxToModel(generated.bytes), {
          branding,
          title: "Rascunho para revisão",
        });
        mime = "application/pdf";
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Rascunho-IA-${feature || "documento"}.${format}`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`Rascunho timbrado baixado em ${format.toUpperCase()}. Revise antes de usar.`);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível gerar o arquivo do rascunho.",
      );
    }
  }

  function changeFeature(value: AiFeatureKey) {
    setFeature(value);
    setRecordId("");
    setChoices([]);
    setMessages([]);
    setPrompt("");
  }

  function changeRecord(value: string) {
    setRecordId(value);
    setMessages([]);
    setPrompt("");
  }

  if (tenantLoading || !selecionado || !session || isUnavailableDuringSupport) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-2 sm:px-3"
          aria-label="Abrir Assistente IA"
        >
          <Sparkles className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Assistente IA</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 p-0 sm:w-full">
        <DialogHeader className="border-b p-5 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Assistente Primus
          </DialogTitle>
          <DialogDescription>
            Secretaria ativa: {selecionado.nome}. A IA produz orientação e rascunhos para
            conferência; não executa ações no sistema.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 border-b p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Capacidade</Label>
            <Select
              value={feature}
              onValueChange={(value) => changeFeature(value as AiFeatureKey)}
              disabled={loadingCapabilities || availableFeatures.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingCapabilities ? "Verificando acesso…" : "Selecione a capacidade"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableFeatures.map((item) => (
                  <SelectItem value={item.key} key={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {feature && NEEDS_RECORD.has(feature) && (
            <div className="space-y-2">
              <Label>Registro</Label>
              <Select
                value={recordId}
                onValueChange={changeRecord}
                disabled={loadingChoices || choices.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingChoices
                        ? "Carregando registros…"
                        : choices.length
                          ? "Selecione"
                          : "Nenhum registro disponível"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem value={choice.id} key={choice.id}>
                      {choice.label}
                      {choice.secondary ? ` (${choice.secondary})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {currentFeature && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {currentFeature.description}
            </p>
          )}
        </div>
        {loadingCapabilities ? (
          <div className="flex min-h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : capabilityError ? (
          <div className="m-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            {capabilityError}
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-48 flex-1 p-5">
              <div className="space-y-4">
                {messages.length === 0 && (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    Pergunte sobre próximos passos, solicite um rascunho de documento, peça uma
                    leitura de preços ou um resumo de pendências. As respostas usam apenas os dados
                    autorizados da Secretaria selecionada e o contexto de registro escolhido.
                  </div>
                )}
                {messages.map((message, index) => (
                  <div
                    key={`${index}-${message.role}`}
                    className={`max-w-[95%] rounded-xl p-3 text-sm ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto border bg-muted/50"}`}
                  >
                    <p className="mb-1 text-xs font-medium opacity-70">
                      {message.role === "user" ? "Você" : "Assistente Primus — rascunho"}
                    </p>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {message.role === "assistant" && feature === "documents" && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void downloadDocumentDraft(message.content, "docx")}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          Baixar DOCX timbrado
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void downloadDocumentDraft(message.content, "pdf")}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Baixar PDF
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {sending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparando resposta…
                  </div>
                )}
              </div>
            </ScrollArea>
            <div className="border-t px-5 py-3 text-xs text-muted-foreground">
              A solicitação e o contexto selecionado são processados pelo provedor OpenAI
              configurado pela plataforma. Revise o resultado e confirme normas, valores e dados
              antes de usar.
            </div>
            <DialogFooter className="flex-col gap-2 border-t p-4 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!messages.length || sending}
                onClick={() => setMessages([])}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Limpar conversa
              </Button>
              <form
                onSubmit={(event) => void sendMessage(event)}
                className="flex w-full gap-2 sm:max-w-xl"
              >
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Descreva o que precisa…"
                  maxLength={3000}
                  rows={2}
                  className="min-h-10 resize-y"
                  disabled={!feature || sending}
                  aria-label="Mensagem para o assistente"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={
                    !prompt.trim() ||
                    !feature ||
                    sending ||
                    (NEEDS_RECORD.has(feature) && !recordId)
                  }
                  aria-label="Enviar mensagem"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
