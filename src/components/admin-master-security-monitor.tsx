import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  avaliarPosturaSeguranca,
  calcularScorePosturaSeguranca,
  type PlatformSecuritySignals,
  type SecurityAlertSeverity,
} from "@/lib/security-monitoring-helper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function severityBadgeVariant(
  severity: SecurityAlertSeverity,
): "destructive" | "secondary" | "outline" {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "secondary";
  return "outline";
}

function severityLabel(severity: SecurityAlertSeverity): string {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  if (severity === "medium") return "Médio";
  return "Informativo";
}

export function AdminMasterSecurityMonitor() {
  const [signals, setSignals] = useState<PlatformSecuritySignals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await (
      db as unknown as {
        rpc: (
          fn: string,
        ) => Promise<{ data: PlatformSecuritySignals | null; error: { message: string } | null }>;
      }
    ).rpc("get_platform_security_signals");

    if (rpcError || !data) {
      setError("Não foi possível consultar os sinais de segurança em tempo real.");
      setLoading(false);
      return;
    }
    setSignals(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  const alerts = useMemo(() => (signals ? avaliarPosturaSeguranca(signals) : []), [signals]);
  const score = useMemo(() => (signals ? calcularScorePosturaSeguranca(signals) : null), [signals]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" aria-hidden />
            Monitoramento Contínuo & Detecção de Anomalias
          </CardTitle>
          <CardDescription>
            Telemetria agregada de autenticação MFA, integridade RLS, negações de acesso e mudanças
            de privilégios nas últimas 24h/7d.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {score !== null && (
            <Badge variant={score >= 85 ? "secondary" : "destructive"}>Postura: {score}/100</Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadSignals()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
            )}
            Atualizar sinais
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Telemetria indisponível</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {signals && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">MFA Master ativo</p>
                <p className="mt-1 text-lg font-semibold">
                  {signals.mfa.platform_admins_with_mfa}/{signals.mfa.platform_admins_total}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Lacunas RLS / FORCE RLS</p>
                <p className="mt-1 text-lg font-semibold">
                  {signals.rls.tables_without_rls} / {signals.rls.tables_without_force_rls}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Acessos negados (24h)</p>
                <p className="mt-1 text-lg font-semibold">{signals.events_24h.access_denied}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Mudanças de privilégio (24h)</p>
                <p className="mt-1 text-lg font-semibold">{signals.events_24h.privilege_changes}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Falhas IA (24h) / Suporte ativo</p>
                <p className="mt-1 text-lg font-semibold">
                  {signals.events_24h.ai_failures} / {signals.active_support_sessions}
                </p>
              </div>
            </div>

            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                Nenhuma anomalia crítica ou falha repetida detectada no momento.
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <div
                    key={alert.code}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-background p-3 text-sm"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-primary" aria-hidden />
                        <span className="font-medium">{alert.title}</span>
                        <Badge variant={severityBadgeVariant(alert.severity)}>
                          {severityLabel(alert.severity)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.detail}</p>
                      <p className="text-xs text-foreground/80">{alert.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
