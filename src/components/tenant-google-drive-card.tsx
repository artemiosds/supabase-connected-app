import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

type DriveStatus = {
  can_manage: boolean;
  is_connected: boolean;
  connection_status: string | null;
  google_email: string | null;
  drive_folder_name: string | null;
  connected_at: string | null;
};

type Props = {
  tenantId: string;
  tenantName: string;
};

export function TenantGoogleDriveCard({ tenantId, tenantName }: Props) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [schemaPending, setSchemaPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    setSchemaPending(false);
    const { data, error } = await db.rpc("get_tenant_drive_connection_status", {
      p_tenant_id: tenantId,
    });
    if (error) {
      if (bancoNaoConfigurado(error.message)) {
        setSchemaPending(true);
      } else {
        setErrorMessage("Não foi possível consultar a conexão do Google Drive.");
      }
      setStatus(null);
      setLoading(false);
      return;
    }
    setStatus((data?.[0] as DriveStatus | undefined) ?? null);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get("drive");
    if (result !== "connected" && result !== "error") return;

    if (result === "connected") {
      toast.success("Google Drive conectado à Secretaria.");
      void carregar();
    } else {
      toast.error(
        "Não foi possível conectar o Google Drive. Confira as configurações OAuth e tente novamente.",
      );
    }
    url.searchParams.delete("drive");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [carregar]);

  async function conectar() {
    setBusy(true);
    setErrorMessage(null);
    try {
      const { data, error } = await db.functions.invoke("google-drive-oauth", {
        body: { action: "start", tenant_id: tenantId },
      });
      if (error) throw error;
      const authorizationUrl = (data as { authorization_url?: unknown } | null)?.authorization_url;
      if (
        typeof authorizationUrl !== "string" ||
        !authorizationUrl.startsWith("https://accounts.google.com/")
      ) {
        throw new Error("O serviço não retornou um endereço seguro de autorização Google.");
      }
      window.location.assign(authorizationUrl);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Não foi possível iniciar a conexão.";
      setErrorMessage(message);
      setBusy(false);
    }
  }

  async function desconectar() {
    const confirmou = window.confirm(
      `Desconectar a conta Google da Secretaria ${tenantName}? Os arquivos armazenados no Drive não serão apagados. A desconexão será bloqueada enquanto existirem documentos vinculados.`,
    );
    if (!confirmou) return;

    setBusy(true);
    setErrorMessage(null);
    const { data, error } = await db.functions.invoke("google-drive-oauth", {
      body: { action: "disconnect", tenant_id: tenantId },
    });
    setBusy(false);
    if (error || (data as { error?: string } | null)?.error) {
      const message =
        (data as { error?: string } | null)?.error ??
        "Não foi possível desconectar o Google Drive. Verifique os documentos vinculados e tente novamente.";
      setErrorMessage(message);
      return;
    }
    toast.success("Conta Google desconectada.");
    await carregar();
  }

  const dataConexao = status?.connected_at
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(status.connected_at))
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Cloud className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-base">Google Drive da Secretaria</CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Conecte uma conta institucional para armazenar arquivos da Secretaria em uma pasta
                própria, sem compartilhar a conexão com outras organizações.
              </CardDescription>
            </div>
          </div>
          {status?.is_connected ? (
            <Badge variant="default">Conectado</Badge>
          ) : (
            <Badge variant="secondary">Não conectado</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {schemaPending && (
          <Alert>
            <AlertTitle>Estrutura ainda não aplicada</AlertTitle>
            <AlertDescription>
              A conexão Google Drive já está preparada no código, mas a migration correspondente
              ainda não foi aplicada ao banco desta instalação.
            </AlertDescription>
          </Alert>
        )}
        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível concluir a operação</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <div className="flex h-16 items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Consultando conexão desta Secretaria...
          </div>
        ) : status?.is_connected ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{status.google_email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pasta: {status.drive_folder_name ?? "Pasta da Secretaria"}
              </p>
              {dataConexao && (
                <p className="mt-1 text-xs text-muted-foreground">Conectado em {dataConexao}</p>
              )}
            </div>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Refresh token criptografado no Vault; não é enviado ao navegador.
              </p>
              {status.can_manage && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void desconectar()}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Unlink className="h-4 w-4" />
                  )}{" "}
                  Desconectar
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="max-w-xl">
              <p className="text-sm font-medium">Nenhuma conta Google conectada</p>
              <p className="mt-1 text-xs text-muted-foreground">
                O aplicativo solicitará o escopo drive.file: acesso somente aos arquivos e pastas
                criados ou abertos por esta integração. Nenhuma senha Google será armazenada.
              </p>
            </div>
            {status?.can_manage && (
              <Button
                type="button"
                disabled={busy || schemaPending}
                onClick={() => void conectar()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4" />
                )}{" "}
                Conectar Google Drive
              </Button>
            )}
            {!status?.can_manage && !schemaPending && (
              <p className="text-xs text-muted-foreground">
                Somente o administrador desta Secretaria pode conectar a conta.
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          A conexão é individual por Secretaria. Desconectar não apaga arquivos do Google Drive;
          documentos vinculados precisam ser preservados ou migrados antes da revogação.
        </p>
      </CardContent>
    </Card>
  );
}
