import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  FileCheck2,
  Mail,
  ShieldAlert,
  Bot,
  User,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";

interface SupplierAiCopilotProps {
  tenantId: string;
  supplierId: string;
  supplierName: string;
  supplierCategory: string;
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const ACOES_RAPIDAS = [
  {
    id: "diagnostico",
    label: "Diagnóstico de Conformidade",
    icon: FileCheck2,
    prompt:
      "Faça um diagnóstico completo da conformidade deste fornecedor. Analise os documentos cadastrados, validades, histórico de regularidade oficial e sanções. Aponte claramente o que está regular e quais são as pendências críticas.",
  },
  {
    id: "parecer",
    label: "Minutar Parecer de Habilitação",
    icon: Sparkles,
    prompt:
      "Elabore uma minuta de parecer técnico e fundamentado para subsidiar a decisão da comissão/agente de contratação sobre a habilitação deste fornecedor. Destaque os fundamentos atendidos e as ressalvas pertinentes.",
  },
  {
    id: "complementacao",
    label: "Minutar Pedido de Complementação",
    icon: Mail,
    prompt:
      "Redija uma minuta formal de notificação/solicitação institucional para que a empresa regularize suas pendências documentais, especificando os itens ausentes ou vencidos e concedendo prazo razoável.",
  },
  {
    id: "riscos",
    label: "Mapeamento de Riscos e Regularidade",
    icon: ShieldAlert,
    prompt:
      "Identifique os principais riscos operacionais e jurídicos relacionados a este fornecedor com base nas consultas oficiais e certidões registradas na Secretaria.",
  },
];

export function SupplierAiCopilot({
  tenantId,
  supplierId,
  supplierName,
  supplierCategory,
}: SupplierAiCopilotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const enviarMensagem = async (texto: string) => {
    if (!texto.trim() || loading) return;
    setErro(null);

    const novoHistorico: ChatMessage[] = [...messages, { role: "user", content: texto.trim() }];
    setMessages(novoHistorico);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await db.functions.invoke<{ reply?: string; error?: string }>(
        "primus-ai",
        {
          body: {
            tenant_id: tenantId,
            feature: "supplier_documents",
            record_id: supplierId,
            messages: novoHistorico,
          },
        },
      );

      if (error) {
        throw new Error(error.message || "Erro ao consultar o copiloto inteligente.");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      const replyContent = data?.reply || "Nenhuma resposta retornada pelo modelo.";
      setMessages([...novoHistorico, { role: "assistant", content: replyContent }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao processar com IA.";
      setErro(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const copiarTexto = (texto: string, idx: number) => {
    navigator.clipboard.writeText(texto);
    setCopiedIndex(idx);
    toast.success("Texto copiado para a área de transferência!");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const limparConversa = () => {
    setMessages([]);
    setErro(null);
  };

  return (
    <Card className="border-primary/20 shadow-xs">
      <CardHeader className="p-4 pb-2 border-b bg-primary/5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-primary/10 p-1.5 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                Copiloto Inteligente Primus · {supplierName}
              </CardTitle>
              <CardDescription className="text-xs">
                Assistência contextual em conformidade, análise documental e minutas para a Secretaria.
              </CardDescription>
            </div>
          </div>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={limparConversa}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Limpar conversa
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {/* Aviso de governança e revisão humana */}
        <div className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-[11px] text-muted-foreground border">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
          <span>
            <strong>Governança de IA:</strong> As análises e minutas são estritamente orientativas e
            utilizam somente metadados oficiais autorizados desta Secretaria. A decisão final e a
            homologação cabem exclusivamente à autoridade e equipe competente.
          </span>
        </div>

        {/* Ações Rápidas em Pílulas */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Ações Rápidas com IA:</span>
          <div className="flex flex-wrap gap-1.5">
            {ACOES_RAPIDAS.map((acao) => {
              const Icon = acao.icon;
              return (
                <Button
                  key={acao.id}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-card hover:bg-primary/5 hover:border-primary/40"
                  disabled={loading}
                  onClick={() => void enviarMensagem(acao.prompt)}
                >
                  <Icon className="mr-1.5 h-3 w-3 text-primary" />
                  {acao.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Área de Mensagens */}
        <div
          ref={scrollRef}
          className="space-y-3 max-h-80 min-h-48 overflow-y-auto rounded-md border p-3 bg-background/50"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-muted-foreground">
              <Bot className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="font-medium text-foreground">Como o Copiloto pode ajudar neste cadastro?</p>
              <p className="text-[11px] max-w-sm mt-0.5">
                Clique em uma das ações rápidas acima para gerar um diagnóstico de certidões, minutar um
                parecer de habilitação ou redigir uma notificação de saneamento.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isAssistant = msg.role === "assistant";
              return (
                <div
                  key={idx}
                  className={`flex gap-2 text-xs ${isAssistant ? "justify-start" : "justify-end"}`}
                >
                  {isAssistant && (
                    <div className="mt-1 h-6 w-6 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg p-3 ${
                      isAssistant
                        ? "bg-muted/40 border text-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    {isAssistant && (
                      <div className="mt-2 flex items-center justify-end gap-1 pt-1 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => copiarTexto(msg.content, idx)}
                        >
                          {copiedIndex === idx ? (
                            <>
                              <Check className="mr-1 h-3 w-3 text-emerald-500" /> Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="mr-1 h-3 w-3" /> Copiar minuta
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                  {!isAssistant && (
                    <div className="mt-1 h-6 w-6 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                      <User className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Analisando conformidade e metadados estruturados...</span>
            </div>
          )}

          {erro && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        {/* Input e Envio Livre */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviarMensagem(input);
          }}
          className="flex gap-2"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviarMensagem(input);
              }
            }}
            placeholder="Faça uma pergunta sobre certidões, sanções ou solicite ajustes na minuta..."
            className="min-h-9 max-h-24 resize-none text-xs"
            rows={1}
            disabled={loading}
          />
          <Button type="submit" size="sm" className="h-auto px-3" disabled={loading || !input.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
