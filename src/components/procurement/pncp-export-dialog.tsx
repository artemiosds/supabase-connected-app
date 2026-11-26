import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
import { db } from "@/lib/db";
import {
  validarContratoPncp,
  validarProcessoPncp,
  type PncpContractInput,
  type PncpProcessInput,
  type PncpTenantInfo,
} from "@/lib/pncp-export";

type Props =
  | {
      kind: "contract";
      tenantId: string;
      tenantName: string;
      contract: PncpContractInput;
      triggerLabel?: string;
    }
  | {
      kind: "process";
      tenantId: string;
      tenantName: string;
      process: PncpProcessInput;
      triggerLabel?: string;
    };

export function PncpExportDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [loadingTenant, setLoadingTenant] = useState(false);
  const [tenantInfo, setTenantInfo] = useState<PncpTenantInfo>({ name: props.tenantName });

  useEffect(() => {
    if (!open || !props.tenantId) return;
    let cancelled = false;
    setLoadingTenant(true);
    db.from("tenants")
      .select("name,cnpj,ibge_code,municipality,state")
      .eq("id", props.tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setTenantInfo({
            name: data.name || props.tenantName,
            cnpj: data.cnpj,
            ibge_code: data.ibge_code,
            municipality: data.municipality,
            state: data.state,
          });
        } else {
          setTenantInfo({ name: props.tenantName });
        }
        setLoadingTenant(false);
      })
      .then(undefined, () => {
        if (!cancelled) {
          setTenantInfo({ name: props.tenantName });
          setLoadingTenant(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, props.tenantId, props.tenantName]);

  const validation = useMemo(() => {
    if (!open || loadingTenant) return null;
    return props.kind === "contract"
      ? validarContratoPncp(tenantInfo, props.contract)
      : validarProcessoPncp(tenantInfo, props.process);
  }, [open, loadingTenant, tenantInfo, props]);

  const jsonString = useMemo(
    () => (validation ? JSON.stringify(validation.payload, null, 2) : ""),
    [validation],
  );

  const fileIdentifier = props.kind === "contract" ? props.contract.number : props.process.number;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(jsonString);
      toast.success("Pacote JSON no padrão PNCP copiado para a área de transferência.");
    } catch {
      toast.error("Não foi possível copiar o JSON.");
    }
  }

  function handleDownload() {
    const safeName = fileIdentifier.replace(/[^a-zA-Z0-9_-]+/g, "-") || "registro";
    const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pncp-${props.kind}-${safeName}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo JSON padrão PNCP baixado.");
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileCheck2 className="mr-1.5 h-4 w-4" />
        {props.triggerLabel ?? "Pré-validação PNCP"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" />
              Pré-validação e Exportação PNCP (Lei nº 14.133/2021)
              {validation && (
                <Badge
                  variant={
                    validation.status === "ready"
                      ? "default"
                      : validation.status === "ready_with_warnings"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {validation.status === "ready"
                    ? "Apto para PNCP"
                    : validation.status === "ready_with_warnings"
                      ? "Apto com ressalvas"
                      : "Bloqueado — pendências obrigatórias"}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Conferência dos requisitos obrigatórios dos arts. 94 e 174 da Lei nº 14.133/2021 e
              geração do pacote estruturado no padrão da API do PNCP.
            </DialogDescription>
          </DialogHeader>

          {loadingTenant ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Validando dados institucionais da Secretaria...
            </div>
          ) : (
            validation && (
              <div className="space-y-4">
                <div className="space-y-2">
                  {validation.checks.map((item) => (
                    <div
                      key={item.field}
                      className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${
                        item.severity === "blocker"
                          ? "border-destructive/40 bg-destructive/5"
                          : item.severity === "warning"
                            ? "border-amber-500/40 bg-amber-500/10"
                            : "border-emerald-500/30 bg-emerald-500/5"
                      }`}
                    >
                      {item.severity === "blocker" ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      ) : item.severity === "warning" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                      <div>
                        <p className="font-semibold">{item.label}</p>
                        <p className="text-muted-foreground">{item.message}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Pré-visualização do pacote JSON (PNCP v1)
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
                    {jsonString}
                  </pre>
                </div>
              </div>
            )
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!validation}
              onClick={() => void handleCopy()}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar JSON
            </Button>
            <Button
              type="button"
              disabled={!validation || validation.status === "blocked"}
              onClick={handleDownload}
            >
              <Download className="mr-2 h-4 w-4" />
              Baixar JSON PNCP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
