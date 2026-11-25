import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileText, Printer, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface DocumentoParaVisualizar {
  id: string;
  title: string;
  status: string;
  created_at: string;
  document_type?: string | null | undefined;
  content?: string | null | undefined;
  content_snapshot?: string | null | undefined;
  signed_name?: string | null | undefined;
  signed_email?: string | null | undefined;
  signed_at?: string | null | undefined;
  signed_pdf_sha256?: string | null | undefined;
}

export interface DocumentViewerSheetProps<
  T extends DocumentoParaVisualizar = DocumentoParaVisualizar,
> {
  documento: T | null;
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  onImprimir?: ((documento: T) => void) | undefined;
  onBaixarDocx?: ((documento: T) => void) | undefined;
  onBaixarPdf?: ((documento: T) => void) | undefined;
  baixando?: boolean | undefined;
}

type StatusVisualConfig = {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
  className?: string;
};

const STATUS_DOCUMENTO: Record<string, StatusVisualConfig> = {
  signed: {
    label: "Assinado eletronicamente",
    variant: "outline",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  draft: {
    label: "Rascunho",
    variant: "secondary",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  cancelled: {
    label: "Cancelado",
    variant: "destructive",
  },
};

function formatDateTimePtBr(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function getStatusVisual(status: string): StatusVisualConfig {
  return (
    STATUS_DOCUMENTO[status] ?? {
      label: status || "Desconhecido",
      variant: "outline",
    }
  );
}

/**
 * Gaveta lateral para leitura rápida, cópia de conteúdo e conferência de metadados
 * de assinatura eletrônica sem tirar o servidor da página atual.
 */
export function DocumentViewerSheet<T extends DocumentoParaVisualizar = DocumentoParaVisualizar>({
  documento,
  aberto,
  onOpenChange,
  onImprimir,
  onBaixarDocx,
  onBaixarPdf,
  baixando = false,
}: DocumentViewerSheetProps<T>) {
  const [copiadoCampo, setCopiadoCampo] = useState<"conteudo" | "sha256" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limparTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return limparTimer;
  }, [limparTimer]);

  useEffect(() => {
    limparTimer();
    setCopiadoCampo(null);
  }, [aberto, documento?.id, limparTimer]);

  const copiarParaAreaDeTransferencia = useCallback(
    async (valor: string, campo: "conteudo" | "sha256", mensagemSucesso: string) => {
      if (!valor) return;
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("API de área de transferência indisponível.");
        }
        await navigator.clipboard.writeText(valor);
        limparTimer();
        setCopiadoCampo(campo);
        toast.success(mensagemSucesso);
        timerRef.current = setTimeout(() => {
          setCopiadoCampo((atual) => (atual === campo ? null : atual));
        }, 2000);
      } catch {
        toast.error("Não foi possível copiar para a área de transferência.");
      }
    },
    [limparTimer],
  );

  const statusConfig = documento ? getStatusVisual(documento.status) : null;
  const conteudoTexto = documento?.content_snapshot ?? documento?.content ?? "";
  const possuiConteudo = conteudoTexto.trim().length > 0;
  const possuiMetadadosAssinatura = Boolean(
    documento?.signed_name ||
    documento?.signed_email ||
    documento?.signed_at ||
    documento?.signed_pdf_sha256,
  );

  return (
    <Sheet open={aberto && Boolean(documento)} onOpenChange={onOpenChange}>
      {documento && statusConfig && (
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="space-y-3 border-b px-6 py-4 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusConfig.variant} className={statusConfig.className}>
                {statusConfig.label}
              </Badge>
              {documento.document_type && (
                <Badge variant="outline" className="font-normal">
                  <FileText className="mr-1 h-3 w-3" aria-hidden />
                  {documento.document_type}
                </Badge>
              )}
            </div>

            <div className="space-y-1">
              <SheetTitle className="leading-snug">{documento.title}</SheetTitle>
              <SheetDescription>
                Criado em {formatDateTimePtBr(documento.created_at)}
              </SheetDescription>
            </div>

            {documento.status === "signed" && possuiMetadadosAssinatura && (
              <div className="space-y-1 rounded-lg border bg-muted/50 p-3 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  <span>Dados da assinatura eletrônica</span>
                </div>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Assinante:</span>{" "}
                  {documento.signed_name || "Não informado"}
                  {documento.signed_email ? ` (${documento.signed_email})` : ""}
                </p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Assinado em:</span>{" "}
                  {formatDateTimePtBr(documento.signed_at)}
                </p>
                {documento.signed_pdf_sha256 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="min-w-0 flex-1 text-muted-foreground">
                      <span className="font-medium text-foreground">SHA-256:</span>{" "}
                      <code className="break-all font-mono text-[11px]">
                        {documento.signed_pdf_sha256}
                      </code>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        void copiarParaAreaDeTransferencia(
                          documento.signed_pdf_sha256 ?? "",
                          "sha256",
                          "Conteúdo copiado para a área de transferência.",
                        )
                      }
                    >
                      {copiadoCampo === "sha256" ? (
                        <Check className="mr-1 h-3 w-3 text-emerald-600" aria-hidden />
                      ) : (
                        <Copy className="mr-1 h-3 w-3" aria-hidden />
                      )}
                      {copiadoCampo === "sha256" ? "Copiado" : "Copiar SHA-256"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </SheetHeader>

          <div className="flex items-center justify-between gap-2 bg-muted/10 px-6 py-2.5">
            <span className="text-xs font-medium text-muted-foreground">
              Pré-visualização do conteúdo
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!possuiConteudo}
              onClick={() =>
                void copiarParaAreaDeTransferencia(
                  conteudoTexto,
                  "conteudo",
                  "Texto do documento copiado!",
                )
              }
            >
              {copiadoCampo === "conteudo" ? (
                <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" aria-hidden />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {copiadoCampo === "conteudo" ? "Texto copiado" : "Copiar Texto"}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto border-y bg-muted/20 p-6">
            {possuiConteudo ? (
              <div className="select-text whitespace-pre-wrap rounded-md border bg-background p-6 font-sans text-sm leading-relaxed shadow-sm">
                {conteudoTexto}
              </div>
            ) : (
              <div className="flex h-full min-h-40 items-center justify-center rounded-md border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
                Nenhum conteúdo registrado para este documento.
              </div>
            )}
          </div>

          <SheetFooter className="flex-wrap gap-2 px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            {onBaixarDocx && documento.status === "draft" && (
              <Button
                type="button"
                variant="outline"
                disabled={baixando}
                onClick={() => onBaixarDocx(documento)}
              >
                <Download className="mr-1.5 h-4 w-4" aria-hidden />
                Baixar Word
              </Button>
            )}
            {onBaixarPdf && (
              <Button
                type="button"
                variant="outline"
                disabled={baixando}
                onClick={() => onBaixarPdf(documento)}
              >
                <Download className="mr-1.5 h-4 w-4" aria-hidden />
                Baixar PDF
              </Button>
            )}
            {onImprimir && (
              <Button type="button" disabled={baixando} onClick={() => onImprimir(documento)}>
                <Printer className="mr-1.5 h-4 w-4" aria-hidden />
                Imprimir / Visualizar Impressão
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      )}
    </Sheet>
  );
}
