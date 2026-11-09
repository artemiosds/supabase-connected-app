import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Clock3, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { db } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/suporte")({
  head: () => ({ meta: [{ title: "Central de Suporte — Gestão de Fornecedores da Saúde" }] }),
  component: CentralSuporte,
});

function dataHora(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function CentralSuporte() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { tenants, selecionado, selecionar, loading, supportAccess, recarregar } = useTenant();
  const [tenantId, setTenantId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (supportAccess?.session_id && supportAccess.tenant_id) {
      setTenantId(supportAccess.tenant_id);
    } else if (!tenantId && (selecionado?.id || tenants[0]?.id)) {
      setTenantId(selecionado?.id ?? tenants[0].id);
    }
  }, [supportAccess?.session_id, supportAccess?.tenant_id, selecionado?.id, tenants, tenantId]);

  const isAuthorized =
    supportAccess?.is_platform_admin === true || supportAccess?.is_agent === true;
  const hasSession = !!supportAccess?.session_id;

  async function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || reason.trim().length < 10) {
      toast.error("Selecione uma organização e descreva o motivo em pelo menos 10 caracteres.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await db.rpc("start_platform_support_session", {
        p_tenant_id: tenantId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      if (!data?.[0]?.session_id) throw new Error("O banco não retornou uma sessão válida.");
      selecionar(tenantId);
      toast.success("Sessão de suporte iniciada por 60 minutos.");
      recarregar();
      await navigate({ to: "/fornecedores" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível iniciar o suporte.");
    } finally {
      setSaving(false);
    }
  }

  async function endSession() {
    if (!supportAccess?.session_id) return;
    setEnding(true);
    try {
      const { error } = await db.rpc("end_platform_support_session", {
        p_session_id: supportAccess.session_id,
      });
      if (error) throw error;
      toast.success("Sessão de suporte encerrada.");
      recarregar();
      setReason("");
      await navigate({ to: supportAccess.is_agent ? "/suporte" : "/painel" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível encerrar a sessão.");
    } finally {
      setEnding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Acesso restrito</CardTitle>
          <CardDescription>Esta central é exclusiva da equipe técnica de suporte e do Administrador Master.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void navigate({ to: "/painel" })}>Voltar ao painel</Button>
        </CardContent>
      </Card>
    );
  }

  if (supportAccess?.is_agent && supportAccess.agent_status !== "active") {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <AlertTitle>Conta de suporte indisponível</AlertTitle>
        <AlertDescription>
          O convite precisa ser confirmado e ativado ou a conta foi suspensa. Entre em contato com o Administrador Master.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Central de Suporte</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          O acesso é temporário, vinculado a uma organização e registrado em auditoria.
        </p>
      </div>

      {hasSession ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Sessão de suporte em andamento</CardTitle>
              <Badge variant="default">Acesso temporário ativo</Badge>
            </div>
            <CardDescription>{supportAccess?.tenant_name ?? "Organização selecionada"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Motivo registrado</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{supportAccess?.reason}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="h-4 w-4" aria-hidden />
                Expira em {dataHora(supportAccess?.expires_at ?? null)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void navigate({ to: "/fornecedores" })}>Abrir fornecedores</Button>
              <Button variant="outline" onClick={() => void endSession()} disabled={ending}>
                {ending ? "Encerrando..." : "Encerrar sessão"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A autorização é validada novamente no banco em cada operação. Suspensão do técnico ou da atribuição revoga imediatamente o acesso.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Iniciar atendimento</CardTitle>
            <CardDescription>
              Escolha apenas uma Secretaria autorizada e informe o motivo. O acesso expira automaticamente em 60 minutos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenants.length === 0 ? (
              <Alert>
                <AlertTitle>Nenhuma organização atribuída</AlertTitle>
                <AlertDescription>
                  Solicite ao Administrador Master uma atribuição ativa com permissão de consulta de fornecedores.
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={startSession} className="space-y-4">
                <div className="space-y-2">
                  <Label>Organização autorizada</Label>
                  <Select value={tenantId} onValueChange={setTenantId}>
                    <SelectTrigger><SelectValue placeholder="Selecione uma Secretaria" /></SelectTrigger>
                    <SelectContent>
                      {tenants.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>{tenant.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-reason">Motivo obrigatório</Label>
                  <Textarea
                    id="support-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    minLength={10}
                    maxLength={500}
                    rows={4}
                    placeholder="Número do chamado, solicitação recebida e atividade que será executada..."
                  />
                </div>
                <Button type="submit" disabled={saving || !tenantId || reason.trim().length < 10}>
                  {saving ? "Iniciando..." : "Iniciar sessão de suporte"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <Alert>
        <AlertTitle>Limites desta conta</AlertTitle>
        <AlertDescription>
          A equipe técnica atua somente no módulo Fornecedores, conforme a permissão atribuída. Não recebe perfil municipal, não altera usuários, planos, cobranças ou módulos e não pode excluir ou inativar fornecedores.
        </AlertDescription>
      </Alert>
      <p className="text-xs text-muted-foreground">Conta autenticada: {session?.user.email}</p>
    </div>
  );
}
