import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

type DriveStatus = {
  is_connected: boolean;
  google_email: string | null;
  root_folder_name: string | null;
  connected_at: string | null;
};

type Props = {
  tenantId: string | undefined;
  canEdit: boolean;
};

export function GoogleDriveIntegrationCard({ tenantId, canEdit }: Props) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [schemaAvailable, setSchemaAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    const { data, error } = await db.rpc("get_tenant_google_drive_status", {
      p_tenant_id: tenantId,
    });
    setLoading(false);
    if (error) {
      setSchemaAvailable(false);
      setStatus(null);
      if (!/function .* does not exist|schema cache|could not find the function/i.test(error.message)) {
        toast.error("Não foi possível consultar a conexão Google Drive.");
      }
      return;
    }
    setSchemaAvailable(true);
    setStatus((data?.[0] as DriveStatus | undefined) ?? {
      is_connected: false,
      google_email: null,
      root_folder_name: null,
      connected_at: null,
    });
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const result = query.get("drive");
    if (result === "connected") {
      toast.success("Google Drive conectado à Secretaria.");
      void load();
      query.delete("drive");
      query.delete("drive_reason");
      const remaining = query.toString();
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (remaining ? "?" + remaining : ""),
      );
    } else if (result === "error") {
      const reason = query.get("drive_reason");
      const messages: Record<string, string> = {
        access_denied: "A autorização do Google Drive foi cancelada.",
        invalid_state: "A autorização expirou ou já foi utilizada. Inicie novamente.",
        permission_revoked: "Sua permissão nesta Secretaria mudou durante a autorização.",
        scope_missing: "O Google não concedeu todas as permissões mínimas solicitadas.",
        google_account_unverified: "Não foi possível confirmar a conta Google autorizada.",
        token_exchange_failed: "O Google não concluiu a autorização. Tente novamente.",
        drive_folder_failed: "Não foi possível criar a pasta da Secretaria no Drive.",
        missing_config: "A integração ainda não está configurada no servidor.",
      };
      toast.error(messages[reason ?? ""] ?? "Não foi possível conectar o Google Drive.");
      query.delete("drive");
      query.delete("drive_reason");
      const remaining = query.toString();
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (remaining ? "?" + remaining : ""),
      );
    }
  }, [load]);

  async function connect() {
    if (!tenantId || !canEdit || busy || !schemaAvailable) return;
    setBusy(true);
    try {
      const { data, error } = await db.functions.invoke("google-drive-oauth-start", {
        body: { tenant_id: tenantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const authorizeUrl = new URL(data?.authorize_url ?? "");
      if (
        authorizeUrl.protocol !== "https:" ||
        authorizeUrl.hostname !== "accounts.google.com"
      ) {
        throw new Error("O endereço de autorização retornado não é confiável.");
      }
      window.location.assign(authorizeUrl.toString());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível iniciar a conexão.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!tenantId || !canEdit || busy || !status?.is_connected) return;
    const confirmed = window.confirm(
      "Desconectar o Google Drive desta Secretaria? Os arquivos já enviados continuarão na conta Google, mas não poderão ser acessados pelo sistema até reconectar.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const { data, error } = await db.functions.invoke("google-drive-disconnect", {
        body: { tenant_id: tenantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Google Drive desconectado. Os tokens locais foram removidos do Vault.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível desconectar o Drive.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">Google Drive da Secretaria</CardTitle>
          </div>
          {status?.is_connected ? (
            <Badge variant="default">Conectado</Badge>
          ) : (
            <Badge variant="secondary">Não conectado</Badge>
          )}
        </div>
        <CardDescription>
          Guarde documentos de fornecedores em uma pasta privada da conta Google autorizada.
          Os usuários municipais acessam os arquivos pelo sistema, conforme suas permissões.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!tenantId ? (
          <p className="text-sm text-muted-foreground">Selecione uma Secretaria para configurar o Drive.</p>
        ) : loading ? (
          <div className="flex h-12 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !schemaAvailable ? (
          <Alert>
            <AlertDescription>
              A estrutura de integração Google Drive ainda não foi implantada neste ambiente.
              O módulo de documentos continua usando o Storage privado do Supabase.
            </AlertDescription>
          </Alert>
        ) : status?.is_connected ? (
          <>
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{status.google_email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pasta: {status.root_folder_name ?? "Documentos da Secretaria"}
              </p>
              {status.connected_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Conectado em {new Date(status.connected_at).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
            {canEdit ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void disconnect()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                Desconectar Drive
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Somente o administrador municipal pode alterar a conexão.
              </p>
            )}
          </>
        ) : canEdit ? (
          <>
            <p className="text-sm text-muted-foreground">
              A conexão usa o escopo mínimo de arquivos criados por este aplicativo. Os tokens
              ficam no Supabase Vault e não são enviados ao navegador.
            </p>
            <Button type="button" disabled={busy} onClick={() => void connect()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Conectar conta Google
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            O Drive ainda não está conectado. Solicite ao administrador municipal que configure
            esta integração.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
