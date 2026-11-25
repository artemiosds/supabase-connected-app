import { useCallback, useEffect, useState } from "react";
import { Loader2, MailCheck, Play, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CandidateRow = {
  tenant_id: string;
  tenant_name: string;
  alert_kind: string;
  severity: "critical" | "high" | "medium";
  recipient_email: string | null;
  recipient_scope: string;
  dedupe_key: string;
};

type AlertHistoryRow = {
  id: string;
  tenant_id: string;
  alert_kind: string;
  severity: string;
  recipient_email: string;
  status: string;
  reason: string | null;
  sent_at: string | null;
  created_at: string;
};

const KIND_LABELS: Record<string, string> = {
  invoice_upcoming: "Fatura a vencer (5d)",
  invoice_overdue: "Fatura vencida",
  trial_expiring: "Trial terminando (3d)",
  ai_quota_warning: "Cota IA >= 80%",
  ai_quota_exceeded: "Cota IA atingida",
  user_limit_warning: "Usuários >= 80%",
  user_limit_reached: "Limite de usuários",
};

function severityVariant(severity: string): "destructive" | "secondary" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "high") return "secondary";
  return "outline";
}

export function AdminMasterCommercialAlerts({
  tenantNameById,
}: {
  tenantNameById: Map<string, string>;
}) {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [history, setHistory] = useState<AlertHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const dbUntyped = supabase as unknown as {
      rpc: (
        fn: string,
      ) => Promise<{ data: CandidateRow[] | null; error: { message: string } | null }>;
      from: (table: string) => {
        select: (cols: string) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => {
            limit: (n: number) => Promise<{
              data: AlertHistoryRow[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };

    const [candRes, histRes] = await Promise.all([
      dbUntyped.rpc("list_platform_commercial_alert_candidates"),
      dbUntyped
        .from("platform_commercial_alerts")
        .select("id,tenant_id,alert_kind,severity,recipient_email,status,reason,sent_at,created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    setCandidates(Array.isArray(candRes.data) ? candRes.data : []);
    setHistory(Array.isArray(histRes.data) ? histRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function runAlerts(dryRun: boolean) {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("platform-commercial-alerts", {
      body: { dry_run: dryRun },
    });
    setRunning(false);

    if (error || data?.error) {
      toast.error(
        typeof data?.error === "string"
          ? data.error
          : "Não foi possível processar os alertas comerciais.",
      );
      return;
    }

    if (dryRun) {
      const count = Number(data?.candidates_count ?? 0);
      toast.success(
        count > 0
          ? `Simulação: ${count} alerta(s) elegível(is) para envio.`
          : "Simulação concluída: nenhum alerta pendente.",
      );
    } else {
      toast.success(
        `Processamento concluído: ${data?.sent ?? 0} enviado(s), ${data?.skipped ?? 0} ignorado(s), ${data?.failed ?? 0} falha(s).`,
      );
    }
    await loadData();
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MailCheck className="h-4 w-4 text-primary" aria-hidden />
            Alertas automáticos por e-mail (Cobrança, Trial & Cotas)
          </CardTitle>
          <CardDescription>
            Dispara avisos idempotentes para faturas vencendo (5d), vencidas, trials expirando (3d)
            e limites de IA ou usuários (80% / 100%).
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            disabled={loading || running}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Atualizar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runAlerts(true)}
            disabled={running}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            Simular pendências
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void runAlerts(false)}
            disabled={running || candidates.length === 0}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Enviar alertas ({candidates.length})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pendentes neste ciclo ({candidates.length})
          </p>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando pendências…
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              Nenhum alerta pendente para o ciclo atual.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Secretaria</TableHead>
                    <TableHead>Alerta</TableHead>
                    <TableHead>Gravidade</TableHead>
                    <TableHead>Destinatário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow key={c.dedupe_key}>
                      <TableCell className="font-medium">{c.tenant_name}</TableCell>
                      <TableCell>{KIND_LABELS[c.alert_kind] ?? c.alert_kind}</TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(c.severity)}>{c.severity}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.recipient_email || "Sem e-mail cadastrado"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Histórico recente de envios ({history.length})
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Secretaria</TableHead>
                    <TableHead>Alerta</TableHead>
                    <TableHead>Destinatário</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(item.sent_at ?? item.created_at))}
                      </TableCell>
                      <TableCell>{tenantNameById.get(item.tenant_id) ?? item.tenant_id}</TableCell>
                      <TableCell>{KIND_LABELS[item.alert_kind] ?? item.alert_kind}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.recipient_email}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.status === "sent"
                              ? "default"
                              : item.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {item.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
