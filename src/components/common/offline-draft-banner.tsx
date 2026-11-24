import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WifiOff, FileClock, Check } from "lucide-react";

interface OfflineDraftBannerProps {
  isOnline: boolean;
  draftDate?: string | null;
  lastSavedAt?: string | null;
  onRestore?: () => void;
  onDiscard?: () => void;
}

export function OfflineDraftBanner({
  isOnline,
  draftDate,
  lastSavedAt,
  onRestore,
  onDiscard,
}: OfflineDraftBannerProps) {
  return (
    <div className="space-y-2 mb-3">
      {/* Aviso de Modo Offline */}
      {!isOnline && (
        <Alert
          variant="destructive"
          className="py-2.5 bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
        >
          <WifiOff className="h-4 w-4" />
          <AlertTitle className="text-xs font-semibold">Sem conexão com a internet</AlertTitle>
          <AlertDescription className="text-xs">
            Você está operando offline. As alterações estão sendo salvas localmente neste navegador e não serão perdidas.
          </AlertDescription>
        </Alert>
      )}

      {/* Alerta de Rascunho Encontrado */}
      {draftDate && onRestore && (
        <Alert className="py-2.5 bg-primary/10 border-primary/20">
          <FileClock className="h-4 w-4 text-primary" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
            <div>
              <AlertTitle className="text-xs font-semibold text-foreground">
                Rascunho não salvo encontrado
              </AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground">
                Existe um preenchimento anterior salvo em{" "}
                {new Date(draftDate).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                . Deseja recuperar os dados?
              </AlertDescription>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={onRestore}
              >
                Restaurar
              </Button>
              {onDiscard && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={onDiscard}
                >
                  Descartar
                </Button>
              )}
            </div>
          </div>
        </Alert>
      )}

      {/* Indicador sutil de auto-save */}
      {lastSavedAt && !draftDate && (
        <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1 justify-end">
          <Check className="h-3 w-3 text-emerald-500" />
          Rascunho salvo às {lastSavedAt}
        </p>
      )}
    </div>
  );
}
