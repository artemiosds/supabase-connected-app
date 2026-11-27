import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { AssigneeSelect, type AssigneeMember } from "@/components/assignee-select";
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
import { Textarea } from "@/components/ui/textarea";
import { ETAPAS, proximaEtapa, type EtapaId } from "@/lib/contratacao";
import {
  validarTransicaoEtapa,
  type ContextoValidacaoExtra,
  type ItemChecklistEtapa,
  type ProcessoTransicao,
} from "@/lib/process-stage-transition-helper";

export interface ConfirmacaoTransicaoEtapa {
  destino: EtapaId;
  responsible_name: string | null;
  responsible_user_id: string | null;
  due_date: string | null;
  handoff_note: string | null;
}

interface StageTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processo: ProcessoTransicao | null;
  itensChecklist: readonly ItemChecklistEtapa[];
  totalItensProcesso?: number | undefined;
  members?: AssigneeMember[] | null | undefined;
  contextoExtra?: ContextoValidacaoExtra | undefined;
  onConfirm: (dados: ConfirmacaoTransicaoEtapa) => Promise<void>;
}

export function StageTransitionDialog({
  open,
  onOpenChange,
  processo,
  itensChecklist,
  totalItensProcesso = 0,
  members = [],
  contextoExtra,
  onConfirm,
}: StageTransitionDialogProps) {
  const [responsibleName, setResponsibleName] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
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
    setResponsibleUserId(processo.responsible_user_id ?? null);
    setDueDate(processo.due_date ?? "");
    setHandoffNote("");
  }, [open, processo]);

  if (!processo) return null;

  const destino = proximaEtapa(processo.stage);
  if (!destino) return null;

  const etapaAtualObj = ETAPAS.find((e) => e.id === processo.stage);
  const etapaDestinoObj = ETAPAS.find((e) => e.id === destino);

  const validacao = validarTransicaoEtapa(
    {
      ...processo,
      responsible_name: responsibleName.trim() || null,
      responsible_user_id: responsibleUserId,
      due_date: dueDate || null,
    },
    itensChecklist,
    totalItensProcesso,
    contextoExtra,
  );

  async function handleConfirm() {
    if (submittingRef.current || !validacao.podeAvancar || !destino) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm({
        destino,
        responsible_name: responsibleName.trim() || null,
        responsible_user_id: responsibleUserId,
        due_date: dueDate || null,
        handoff_note: handoffNote.trim() || null,
      });
      onOpenChange(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Avançar etapa e passar o bastão
          </DialogTitle>
          <DialogDescription>
            Movimentação controlada de fluxo conforme checklist e regras da Lei nº 14.133/2021.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Etapa atual
              </p>
              <p className="font-medium">{etapaAtualObj?.nome ?? processo.stage}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Próxima etapa
              </p>
              <p className="font-semibold text-primary">
                {etapaDestinoObj?.nome ?? destino}
              </p>
            </div>
          </div>

          {validacao.pendenciasBloqueantes.length > 0 && (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                Pendências obrigatórias para avançar
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {validacao.pendenciasBloqueantes.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {validacao.itensPendentesEtapaAtual.length > 0 && (
                <div className="rounded bg-background/70 p-2 text-xs text-foreground">
                  <p className="mb-1 font-medium">Itens abertos na etapa atual:</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {validacao.itensPendentesEtapaAtual.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {validacao.podeAvancar && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Checklist e requisitos mínimos da etapa "{validacao.etapaAtualNome}"
                atendidos.
              </span>
            </div>
          )}

          {validacao.avisos.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Alertas de conformidade e governança
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {validacao.avisos.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Passar o bastão para (membro da equipe)</Label>
              {members && members.length > 0 ? (
                <AssigneeSelect
                  label="Passar o bastão para (membro da equipe)"
                  value={responsibleUserId}
                  members={members}
                  onChange={(uid) => {
                    const cleanUid = uid || null;
                    setResponsibleUserId(cleanUid);
                    const membro = members.find((m) => m.user_id === cleanUid);
                    setResponsibleName(membro?.profiles?.full_name ?? "");
                  }}
                />
              ) : (
                <Input
                  id="transition-responsible"
                  placeholder="Ex.: Dr. Carlos (Jurídico) / Pregoeiro"
                  value={responsibleName}
                  onChange={(e) => {
                    setResponsibleUserId(null);
                    setResponsibleName(e.target.value);
                  }}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transition-due-date">Prazo da próxima etapa</Label>
              <Input
                id="transition-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transition-handoff-note">
              Nota de passagem de bastão (opcional)
            </Label>
            <Textarea
              id="transition-handoff-note"
              rows={2}
              placeholder="Ex.: Pesquisa de preços fechada. Segue para análise jurídica da minuta."
              value={handoffNote}
              onChange={(e) => setHandoffNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!validacao.podeAvancar || submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Confirmar avanço
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
