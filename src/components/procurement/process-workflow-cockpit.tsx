import { CheckCircle2, FileCheck2, HandHelping, UserCheck } from "lucide-react";
import {
  calcularProgressoFluxoProcesso,
  type ItemChecklistEtapa,
} from "@/lib/process-stage-transition-helper";
import type { EtapaId } from "@/lib/contratacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Props {
  stage: EtapaId;
  status: string;
  itensChecklist: readonly ItemChecklistEtapa[];
  responsibleName: string | null;
  responsibleUserId: string | null;
  currentUserId: string;
  canUpdate: boolean;
  docsSincronizaveisCount?: number;
  onAssumirProcesso?: () => void;
  onSincronizarDocs?: () => void;
}

export function ProcessWorkflowCockpit(props: Props) {
  const prog = calcularProgressoFluxoProcesso(props.stage, props.itensChecklist, props.status);
  const podeAssumir =
    props.canUpdate &&
    Boolean(props.currentUserId) &&
    props.responsibleUserId !== props.currentUserId &&
    Boolean(props.onAssumirProcesso);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
      {/* Barras de Progresso Dual */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              Avanço no fluxo ({prog.etapaAtualNumero}/{prog.totalEtapas})
            </span>
            <span className="font-semibold text-primary">{prog.percentualFluxo}%</span>
          </div>
          <Progress value={prog.percentualFluxo} className="h-2" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              Etapa atual ({prog.etapaAtualConcluidos}/{prog.etapaAtualTotal} itens)
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {prog.percentualEtapaAtual}%
            </span>
          </div>
          <Progress value={prog.percentualEtapaAtual} className="h-2" />
        </div>
      </div>

      {/* Stepper visual compacto das 10 etapas */}
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-10" aria-label="Etapas do processo">
        {prog.etapasStatus.map((etapa, idx) => (
          <div
            key={etapa.id}
            title={`${idx + 1}. ${etapa.nome}`}
            className={`flex items-center justify-center gap-1 rounded px-1 py-1 text-[10px] font-medium ${
              etapa.estado === "concluida"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : etapa.estado === "atual"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {etapa.estado === "concluida" ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" />
            ) : (
              <span>{idx + 1}</span>
            )}
          </div>
        ))}
      </div>

      {/* Faixa colaborativa: Na mesa de quem está + ações rápidas de equipe */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Na mesa de:</span>
          <Badge variant="outline" className="font-medium">
            {props.responsibleName?.trim() || "Aguardando definição"}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            · Checklist geral: {prog.percentualChecklistGeral}%
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(props.docsSincronizaveisCount ?? 0) > 0 && props.onSincronizarDocs && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              onClick={props.onSincronizarDocs}
            >
              <FileCheck2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
              Sincronizar {props.docsSincronizaveisCount} doc(s) assinado(s)
            </Button>
          )}
          {podeAssumir && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2.5 text-xs"
              onClick={props.onAssumirProcesso}
            >
              <HandHelping className="mr-1.5 h-3.5 w-3.5" />
              Assumir / Ajudar nesta etapa
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
