import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { supportRpc } from "@/lib/support-rpc";
import { useTenant } from "@/hooks/use-tenant";
import type { MasterTenant } from "@/hooks/use-platform-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SupportTenant = Pick<MasterTenant, "id" | "name">;
type Props = { tenants: SupportTenant[]; allowMasterSessions?: boolean };
type SupportAgent = {
  user_id: string;
  email: string;
  display_name: string;
  status: "invited" | "active" | "suspended" | "revoked";
  assignment_count: number;
};
type Assignment = {
  tenant_id: string;
  tenant_name: string;
  is_active: boolean;
  can_view_suppliers: boolean;
  can_create_suppliers: boolean;
  can_update_suppliers: boolean;
};

type PermissionDraft = {
  is_active: boolean;
  can_view_suppliers: boolean;
  can_create_suppliers: boolean;
  can_update_suppliers: boolean;
};

const EMPTY_PERMISSION: PermissionDraft = {
  is_active: true,
  can_view_suppliers: true,
  can_create_suppliers: false,
  can_update_suppliers: false,
};

export function AdminMasterSupport({ tenants, allowMasterSessions = true }: Props) {
  const navigate = useNavigate();
  const { selecionar, recarregar } = useTenant();
  const [team, setTeam] = useState<SupportAgent[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assignmentTenantId, setAssignmentTenantId] = useState("");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>(EMPTY_PERMISSION);
  const [savingAssignment, setSavingAssignment] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteTenantId, setInviteTenantId] = useState(tenants[0]?.id ?? "");
  const [invitePermissions, setInvitePermissions] = useState<PermissionDraft>({
    ...EMPTY_PERMISSION,
    can_create_suppliers: true,
    can_update_suppliers: false,
  });
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteToRevoke, setInviteToRevoke] = useState<SupportAgent | null>(null);
  const [revokingInvite, setRevokingInvite] = useState(false);

  const [masterTenantId, setMasterTenantId] = useState("");
  const [supportReason, setSupportReason] = useState("");
  const [startingSession, setStartingSession] = useState(false);

  async function loadTeam() {
    setLoadingTeam(true);
    const { data, error } = await supportRpc("list_platform_support_team");
    if (error) {
      toast.error("Não foi possível carregar a equipe de suporte.");
      setTeam([]);
    } else {
      const members = (data ?? []) as SupportAgent[];
      setTeam(members);
      if (selectedAgentId && !members.some((member) => member.user_id === selectedAgentId)) {
        setSelectedAgentId("");
      }
    }
    setLoadingTeam(false);
  }

  async function loadAssignments(agentId: string) {
    setLoadingAssignments(true);
    const { data, error } = await supportRpc("list_platform_support_assignments", {
      p_agent_user_id: agentId,
    });
    if (error) {
      toast.error("Não foi possível consultar as organizações atribuídas.");
      setAssignments([]);
    } else {
      const rows = (data ?? []) as Assignment[];
      setAssignments(rows);
      const firstTenant = rows[0]?.tenant_id ?? tenants[0]?.id ?? "";
      setAssignmentTenantId((current) =>
        current &&
        (rows.some((row) => row.tenant_id === current) || tenants.some((t) => t.id === current))
          ? current
          : firstTenant,
      );
      const currentAssignment = rows.find((row) => row.tenant_id === assignmentTenantId);
      if (currentAssignment) {
        setPermissionDraft({
          is_active: currentAssignment.is_active,
          can_view_suppliers: currentAssignment.can_view_suppliers,
          can_create_suppliers: currentAssignment.can_create_suppliers,
          can_update_suppliers: currentAssignment.can_update_suppliers,
        });
      } else if (rows.length === 0) {
        setPermissionDraft(EMPTY_PERMISSION);
      }
    }
    setLoadingAssignments(false);
  }

  useEffect(() => {
    void loadTeam();
    // Initial load only; explicit refreshes happen after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedAgentId) void loadAssignments(selectedAgentId);
    else {
      setAssignments([]);
      setPermissionDraft(EMPTY_PERMISSION);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  useEffect(() => {
    const existing = assignments.find((row) => row.tenant_id === assignmentTenantId);
    setPermissionDraft(
      existing
        ? {
            is_active: existing.is_active,
            can_view_suppliers: existing.can_view_suppliers,
            can_create_suppliers: existing.can_create_suppliers,
            can_update_suppliers: existing.can_update_suppliers,
          }
        : EMPTY_PERMISSION,
    );
  }, [assignmentTenantId, assignments]);

  async function inviteSupportAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim() || !inviteTenantId) {
      toast.error("Preencha nome, e-mail e organização do primeiro vínculo.");
      return;
    }
    setSendingInvite(true);
    try {
      const { data, error } = await db.functions.invoke("invite-platform-support-agent", {
        body: {
          email: inviteEmail.trim().toLowerCase(),
          display_name: inviteName.trim(),
          tenant_id: inviteTenantId,
          can_view_suppliers: invitePermissions.can_view_suppliers,
          can_create_suppliers: invitePermissions.can_create_suppliers,
          can_update_suppliers: invitePermissions.can_update_suppliers,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      toast.success("Convite enviado. A conta ficará pendente até a confirmação do e-mail.");
      setInviteEmail("");
      setInviteName("");
      await loadTeam();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar o convite.");
    } finally {
      setSendingInvite(false);
    }
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgentId || !assignmentTenantId) {
      toast.error("Selecione o técnico e a organização.");
      return;
    }
    setSavingAssignment(true);
    try {
      const { error } = await supportRpc("set_platform_support_assignment", {
        p_agent_user_id: selectedAgentId,
        p_tenant_id: assignmentTenantId,
        p_is_active: permissionDraft.is_active,
        p_can_view_suppliers: permissionDraft.can_view_suppliers,
        p_can_create_suppliers: permissionDraft.can_create_suppliers,
        p_can_update_suppliers: permissionDraft.can_update_suppliers,
      });
      if (error) throw error;
      toast.success("Atribuição e permissões atualizadas.");
      await loadAssignments(selectedAgentId);
      await loadTeam();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar a atribuição.");
    } finally {
      setSavingAssignment(false);
    }
  }

  async function revokeInvitation(agent: SupportAgent) {
    if (agent.status !== "invited") return;
    setRevokingInvite(true);
    try {
      const { error } = await supportRpc("revoke_platform_support_invitation", {
        p_user_id: agent.user_id,
      });
      if (error) throw error;
      setInviteToRevoke(null);
      toast.success(
        "Convite cancelado. A identidade Auth foi preservada, as atribuições foram desativadas e o acesso não poderá ser ativado.",
      );
      await loadTeam();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível cancelar o convite de suporte.",
      );
    } finally {
      setRevokingInvite(false);
    }
  }

  async function toggleAgentStatus(agent: SupportAgent) {
    if (agent.status === "invited") {
      toast.info("O técnico ainda precisa aceitar o convite e confirmar o e-mail.");
      return;
    }
    if (agent.status === "revoked") return;
    const nextStatus = agent.status === "active" ? "suspended" : "active";
    try {
      const { error } = await supportRpc("set_platform_support_agent_status", {
        p_user_id: agent.user_id,
        p_status: nextStatus,
      });
      if (error) throw error;
      toast.success(
        nextStatus === "suspended"
          ? "Técnico suspenso e sessões encerradas."
          : "Técnico reativado.",
      );
      await loadTeam();
      if (selectedAgentId) await loadAssignments(selectedAgentId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível alterar o status.");
    }
  }

  async function startMasterSupport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!masterTenantId || supportReason.trim().length < 10) {
      toast.error("Selecione a organização e informe um motivo com pelo menos 10 caracteres.");
      return;
    }
    setStartingSession(true);
    try {
      const { error } = await supportRpc("start_platform_support_session", {
        p_tenant_id: masterTenantId,
        p_reason: supportReason.trim(),
      });
      if (error) throw error;
      selecionar(masterTenantId);
      recarregar();
      toast.success("Modo de suporte iniciado. A sessão expira automaticamente em 60 minutos.");
      await navigate({ to: "/fornecedores" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível iniciar a sessão.");
    } finally {
      setStartingSession(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Equipe de Suporte</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Técnicos independentes dos administradores municipais, com acesso temporário e limitado
          por organização.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Convidar técnico</CardTitle>
          <CardDescription>
            O convite cria uma conta exclusiva de suporte. O acesso só é ativado depois da
            confirmação do e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={inviteSupportAgent} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="support-invite-name">Nome completo</Label>
                <Input
                  id="support-invite-name"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-invite-email">E-mail</Label>
                <Input
                  id="support-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  maxLength={254}
                  required
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Primeira organização atribuída</Label>
                <Select value={inviteTenantId} onValueChange={setInviteTenantId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma Secretaria" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-5 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="support-invite-view"
                  checked={invitePermissions.can_view_suppliers}
                  onCheckedChange={(checked) =>
                    setInvitePermissions((current) => ({
                      ...current,
                      can_view_suppliers: checked,
                      can_create_suppliers: checked && current.can_create_suppliers,
                      can_update_suppliers: checked && current.can_update_suppliers,
                    }))
                  }
                />
                <Label htmlFor="support-invite-view">Consultar fornecedores</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="support-invite-create"
                  checked={invitePermissions.can_create_suppliers}
                  onCheckedChange={(checked) =>
                    setInvitePermissions((current) => ({
                      ...current,
                      can_view_suppliers: checked || current.can_view_suppliers,
                      can_create_suppliers: checked,
                    }))
                  }
                />
                <Label htmlFor="support-invite-create">Cadastrar fornecedores</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="support-invite-update"
                  checked={invitePermissions.can_update_suppliers}
                  onCheckedChange={(checked) =>
                    setInvitePermissions((current) => ({
                      ...current,
                      can_view_suppliers: checked || current.can_view_suppliers,
                      can_update_suppliers: checked,
                    }))
                  }
                />
                <Label htmlFor="support-invite-update">Editar fornecedores</Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Técnicos não recebem permissão para excluir ou inativar fornecedores, alterar
              usuários, acessar documentos ou administrar a Secretaria.
            </p>
            <Button type="submit" disabled={sendingInvite || tenants.length === 0}>
              {sendingInvite ? "Enviando convite..." : "Enviar convite de suporte"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equipe cadastrada</CardTitle>
          <CardDescription>
            Contas, situação dos convites e quantidade de organizações atribuídas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingTeam ? (
            <p className="text-sm text-muted-foreground">Carregando equipe...</p>
          ) : team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum técnico cadastrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Técnico</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Organizações</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((agent) => (
                    <TableRow key={agent.user_id}>
                      <TableCell>
                        <p className="font-medium">{agent.display_name}</p>
                        <p className="text-xs text-muted-foreground">{agent.email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            agent.status === "active"
                              ? "default"
                              : agent.status === "suspended"
                                ? "destructive"
                                : agent.status === "revoked"
                                  ? "outline"
                                  : "secondary"
                          }
                        >
                          {agent.status === "active"
                            ? "Ativo"
                            : agent.status === "suspended"
                              ? "Suspenso"
                              : agent.status === "revoked"
                                ? "Convite cancelado"
                                : "Convite pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell>{agent.assignment_count}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={agent.status !== "active"}
                            onClick={() => setSelectedAgentId(agent.user_id)}
                          >
                            Gerenciar acesso
                          </Button>
                          {agent.status === "invited" ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={revokingInvite}
                              onClick={() => setInviteToRevoke(agent)}
                            >
                              Cancelar convite
                            </Button>
                          ) : agent.status === "revoked" ? (
                            <Button type="button" variant="ghost" size="sm" disabled>
                              Cancelado
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => void toggleAgentStatus(agent)}
                            >
                              {agent.status === "active" ? "Suspender" : "Reativar"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedAgentId && (
        <Card>
          <CardHeader>
            <CardTitle>Permissões por organização</CardTitle>
            <CardDescription>
              Altere apenas o escopo do técnico selecionado. Mudanças são auditadas no banco.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveAssignment} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Técnico</Label>
                  <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um técnico" />
                    </SelectTrigger>
                    <SelectContent>
                      {team.map((agent) => (
                        <SelectItem key={agent.user_id} value={agent.user_id}>
                          {agent.display_name} · {agent.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Organização</Label>
                  <Select value={assignmentTenantId} onValueChange={setAssignmentTenantId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma Secretaria" />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {loadingAssignments ? (
                <p className="text-sm text-muted-foreground">Carregando permissões...</p>
              ) : (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="support-assignment-active">Atribuição ativa</Label>
                      <p className="text-xs text-muted-foreground">
                        Desativar encerra qualquer sessão desse técnico nesta organização.
                      </p>
                    </div>
                    <Switch
                      id="support-assignment-active"
                      checked={permissionDraft.is_active}
                      onCheckedChange={(checked) =>
                        setPermissionDraft((current) => ({ ...current, is_active: checked }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-5">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="support-assignment-view"
                        checked={permissionDraft.can_view_suppliers}
                        onCheckedChange={(checked) =>
                          setPermissionDraft((current) => ({
                            ...current,
                            can_view_suppliers: checked,
                            can_create_suppliers: checked && current.can_create_suppliers,
                            can_update_suppliers: checked && current.can_update_suppliers,
                          }))
                        }
                      />
                      <Label htmlFor="support-assignment-view">Consultar</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="support-assignment-create"
                        checked={permissionDraft.can_create_suppliers}
                        onCheckedChange={(checked) =>
                          setPermissionDraft((current) => ({
                            ...current,
                            can_view_suppliers: checked || current.can_view_suppliers,
                            can_create_suppliers: checked,
                          }))
                        }
                      />
                      <Label htmlFor="support-assignment-create">Cadastrar</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="support-assignment-update"
                        checked={permissionDraft.can_update_suppliers}
                        onCheckedChange={(checked) =>
                          setPermissionDraft((current) => ({
                            ...current,
                            can_view_suppliers: checked || current.can_view_suppliers,
                            can_update_suppliers: checked,
                          }))
                        }
                      />
                      <Label htmlFor="support-assignment-update">Editar</Label>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Não há permissão de exclusão/inativação nesta equipe.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={savingAssignment || loadingAssignments || !assignmentTenantId}
                >
                  {savingAssignment ? "Salvando..." : "Salvar atribuição"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setSelectedAgentId("")}>
                  Fechar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {allowMasterSessions && (
        <Card>
          <CardHeader>
            <CardTitle>Modo de suporte do Administrador Master</CardTitle>
            <CardDescription>
              Abra uma sessão temporária para operar Fornecedores em uma organização. Todas as ações
              ficam registradas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={startMasterSupport} className="space-y-4">
              <div className="space-y-2">
                <Label>Organização de atendimento</Label>
                <Select value={masterTenantId} onValueChange={setMasterTenantId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma Secretaria" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="master-support-reason">Motivo obrigatório do acesso</Label>
                <Textarea
                  id="master-support-reason"
                  value={supportReason}
                  onChange={(event) => setSupportReason(event.target.value)}
                  minLength={10}
                  maxLength={500}
                  rows={3}
                  placeholder="Descreva o chamado, solicitação ou tarefa que exige acesso..."
                />
              </div>
              <Button
                type="submit"
                disabled={startingSession || !masterTenantId || supportReason.trim().length < 10}
              >
                {startingSession ? "Iniciando sessão..." : "Entrar no modo de suporte"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Sessão de 60 minutos. O escopo fica limitado ao módulo Fornecedores, sem exclusão ou
                inativação.
              </p>
            </form>
          </CardContent>
        </Card>
      )}
      <AlertDialog
        open={inviteToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokingInvite) setInviteToRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite de suporte?</AlertDialogTitle>
            <AlertDialogDescription>
              {inviteToRevoke
                ? `O convite de ${inviteToRevoke.display_name} (${inviteToRevoke.email}) será marcado como cancelado e todas as atribuições ficarão inativas. A pessoa não poderá ativar o perfil antigo mesmo que confirme o e-mail. A identidade Auth não será excluída.`
                : "O convite será cancelado sem excluir a identidade de autenticação."}
              {" "}Um novo convite no futuro exigirá um endereço exclusivo; o reenvio do mesmo convite ainda não está habilitado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokingInvite}>Manter convite</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={revokingInvite || !inviteToRevoke}
              onClick={() => {
                if (inviteToRevoke) void revokeInvitation(inviteToRevoke);
              }}
            >
              {revokingInvite ? "Cancelando..." : "Confirmar cancelamento"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
