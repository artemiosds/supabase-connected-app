import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  AlertTriangle,
  Loader2,
  Calendar,
  UserCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  validarTransicaoEtapa,
  type ItemChecklistEtapa,
  type ProcessoTransicao,
} from "@/lib/process-stage-transition-helper";
import type { EtapaId } from "@/lib/contratacao";

interface StageTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processo: ProcessoTransicao | null;
  itensChecklist: ItemChecklistEtapa[];
  totalItensProcesso: number;
  onConfirm: (dados: {
    destino: EtapaId;
    responsible_name: string | null;
    due_date: string | null;
  }) => Promise<void>;
}

export function StageTransitionDialog({
  open,
  onOpenChange,
  processo,
  itensChecklist,
  totalItensProcesso,
  onConfirm,
}: StageTransitionDialogProps) {
  const [responsibleName, setResponsibleName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const initializedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !processo) {
      initializedForRef.current = null;
      return;
    }
    const key = `${processo.id}:${processo.stage}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;
    setResponsibleName(processo.responsible_name ?? "");
    setDueDate(processo.due_date ?? "");
  }, [open, processo]);

  if (!processo) return null;

  const validacao = validarTransicaoEtapa(processo, itensChecklist, totalItensProcesso);

  const handleConfirm = async () => {
    if (!validacao.podeAvancar || !validacao.proximaEtapa || submittingRef.current) return;

    submittingRef.current = true;
    try {
      setSubmitting(true);
      await onConfirm({
        destino: validacao.proximaEtapa,
        responsible_name: responsibleName.trim() || null,
        due_date: dueDate || null,
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Assistente de Transição de Fase (Lei 14.133)</DialogTitle>
          <DialogDescription>
            Conferência de conformidade documental e material antes do encaminhamento para a próxima etapa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Fluxo Visual */}
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border bg-muted/40 p-3">
            <Badge variant="outline" className="text-xs font-medium px-2.5 py-1">
              {validacao.etapaAtualNome}
            </Badge>
            <ArrowRight className="h-4 w-4 text-primary shrink-0" aria-hidden />
            <Badge variant="default" className="text-xs font-medium px-2.5 py-1">
              {validacao.proximaEtapaNome ?? "Fim do Fluxo"}
            </Badge>
          </div>

          {/* Checklist da Etapa Atual */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Checklist da Etapa Atual
            </p>
            {validacao.itensObrigatorios.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-md border p-3 bg-muted/20">
                Nenhum item de checklist cadastrado para esta etapa.
              </p>
            ) : (
              <div className="space-y-1.5 rounded-md border p-3 bg-card max-h-48 overflow-y-auto">
                {validacao.itensObrigatorios.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {item.concluido ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden />
                    ) : (
                      <CircleAlert className="h-4 w-4 text-destructive shrink-0" aria-hidden />
                    )}
                    <span className={item.concluido ? "text-foreground" : "text-destructive font-medium"}>
                      {item.titulo}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bloqueios */}
          {!validacao.podeAvancar && (
            <Alert variant="destructive">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Bloqueios impeditivos para avanço</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-1 space-y-1 text-xs">
                  {validacao.bloqueios.map((bloqueio, idx) => (
                    <li key={idx}>{bloqueio}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Avisos não bloqueantes */}
          {validacao.avisos.length > 0 && (
            <Alert className="border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-xs font-semibold">Pontos de atenção</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-1 space-y-1 text-xs">
                  {validacao.avisos.map((aviso, idx) => (
                    <li key={idx}>{aviso}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Campos de Encaminhamento (quando apto a avançar) */}
          {validacao.podeAvancar && (
            <div className="space-y-3 rounded-lg border p-3.5 bg-muted/20">
              <p className="text-xs font-semibold text-foreground">
                Despacho e Encaminhamento da Próxima Fase
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="transition-responsible" className="text-xs flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    Novo Responsável da Etapa
                  </Label>
                  <Input
                    id="transition-responsible"
                    value={responsibleName}
                    onChange={(e) => setResponsibleName(e.target.value)}
                    placeholder="Nome do servidor / comissão"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transition-due-date" className="text-xs flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    Novo Prazo da Etapa
                  </Label>
                  <Input
                    id="transition-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={!validacao.podeAvancar || submitting}
          >
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {validacao.proximaEtapaNome
              ? `Avançar para ${validacao.proximaEtapaNome}`
              : "Avançar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
