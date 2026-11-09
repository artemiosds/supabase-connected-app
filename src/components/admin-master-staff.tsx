import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type StaffStatus = "invited" | "active" | "suspended";
type StaffMember = {
  user_id: string;
  email: string;
  display_name: string;
  status: StaffStatus;
  created_at: string;
  activated_at: string | null;
  role_ids: string[];
  role_names: string[];
};
type StaffRole = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permission_codes: string[];
  staff_count: number;
};
type PermissionCode =
  | "dashboard.view"
  | "clients.view"
  | "plans.view"
  | "billing.summary.view"
  | "metrics.view"
  | "audit.view"
  | "support.team.manage";

const PERMISSIONS: { code: PermissionCode; label: string; description: string; group: string }[] = [
  { code: "dashboard.view", label: "Portal interno", description: "Entrar no ambiente de trabalho interno.", group: "Geral" },
  { code: "clients.view", label: "Consultar clientes", description: "Consultar cadastro e situação das Secretarias, sem editar.", group: "Comercial" },
  { code: "plans.view", label: "Consultar planos", description: "Consultar planos e distribuição de clientes.", group: "Comercial" },
  { code: "billing.summary.view", label: "Resumo financeiro", description: "Ver valores agregados e mensalidades; não acessa tokens, chaves nem configurações de cobrança.", group: "Financeiro" },
  { code: "metrics.view", label: "Métricas globais", description: "Consultar indicadores agregados da plataforma.", group: "Gestão" },
  { code: "audit.view", label: "Auditoria", description: "Consultar eventos sem payloads privados ou segredos.", group: "Segurança" },
  { code: "support.team.manage", label: "Gerenciar equipe de suporte", description: "Convidar e administrar técnicos e suas atribuições. Não permite iniciar sessão de suporte Master.", group: "Suporte" },
];

const STATUS_LABELS: Record<StaffStatus, string> = {
  invited: "Convite pendente",
  active: "Ativo",
  suspended: "Suspenso",
};

const STATUS_VARIANTS: Record<StaffStatus, "secondary" | "default" | "destructive"> = {
  invited: "secondary",
  active: "default",
  suspended: "destructive",
};

export function AdminMasterStaff() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([]);
  const [editingRole, setEditingRole] = useState<StaffRole | null>(null);
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleSlug, setRoleSlug] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<PermissionCode[]>(["dashboard.view"]);

  const selectedStaff = useMemo(
    () => staff.find((member) => member.user_id === selectedStaffId) ?? null,
    [staff, selectedStaffId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [staffResult, roleResult] = await Promise.all([
      db.rpc("list_platform_staff"),
      db.rpc("list_platform_staff_roles"),
    ]);
    if (staffResult.error || roleResult.error) {
      toast.error("Não foi possível carregar a equipe interna e os perfis.");
      setStaff([]);
      setRoles([]);
    } else {
      const members = (staffResult.data ?? []) as StaffMember[];
      const availableRoles = (roleResult.data ?? []) as StaffRole[];
      setStaff(members);
      setRoles(availableRoles.filter((role) => role.is_active));
      if (selectedStaffId && !members.some((member) => member.user_id === selectedStaffId)) {
        setSelectedStaffId("");
      }
    }
    setLoading(false);
  }, [selectedStaffId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedRoleIds(selectedStaff?.role_ids ?? []);
  }, [selectedStaff]);

  function toggleId(values: string[], value: string, checked: boolean) {
    return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inviteName.trim().length < 2 || !inviteEmail.trim() || inviteRoleIds.length === 0) {
      toast.error("Informe nome, e-mail e ao menos um perfil.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await db.functions.invoke("invite-platform-staff", {
        body: {
          email: inviteEmail.trim().toLowerCase(),
          display_name: inviteName.trim(),
          role_ids: inviteRoleIds,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      toast.success("Convite enviado. O colaborador só terá acesso depois de confirmar o e-mail e criar a senha.");
      setInviteName("");
      setInviteEmail("");
      setInviteRoleIds([]);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStaffRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStaff || selectedRoleIds.length === 0) {
      toast.error("O colaborador precisa manter ao menos um perfil.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await db.rpc("set_platform_staff_roles", {
        p_user_id: selectedStaff.user_id,
        p_role_ids: selectedRoleIds,
      });
      if (error) throw error;
      toast.success("Perfis do colaborador atualizados.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar os perfis.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(member: StaffMember) {
    if (member.status === "invited") return;
    const nextStatus = member.status === "active" ? "suspended" : "active";
    setBusy(true);
    try {
      const { error } = await db.rpc("set_platform_staff_status", {
        p_user_id: member.user_id,
        p_status: nextStatus,
      });
      if (error) throw error;
      toast.success(nextStatus === "suspended" ? "Colaborador suspenso. As permissões deixam de valer imediatamente." : "Colaborador reativado.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível alterar o status.");
    } finally {
      setBusy(false);
    }
  }

  function beginRoleEdit(role: StaffRole | null) {
    setRoleEditorOpen(true);
    setEditingRole(role);
    setRoleName(role?.name ?? "");
    setRoleSlug(role?.slug ?? "");
    setRoleDescription(role?.description ?? "");
    setRolePermissions((role?.permission_codes ?? ["dashboard.view"]) as PermissionCode[]);
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roleName.trim().length < 2 || roleSlug.trim().length < 2 || rolePermissions.length === 0) {
      toast.error("Informe nome, identificador e ao menos uma permissão.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await db.rpc("save_platform_staff_role", {
        p_role_id: editingRole?.id ?? null,
        p_slug: roleSlug.trim().toLowerCase(),
        p_name: roleName.trim(),
        p_description: roleDescription.trim(),
        p_permission_codes: rolePermissions,
      });
      if (error) throw error;
      toast.success("Perfil e permissões salvos.");
      setRoleEditorOpen(false);
      setEditingRole(null);
      setRoleName("");
      setRoleSlug("");
      setRoleDescription("");
      setRolePermissions(["dashboard.view"]);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Equipe Interna</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Gerencie os colaboradores da empresa responsável pela plataforma. Estas contas são independentes das contas municipais e da equipe técnica de suporte.
        </p>
      </div>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>Separação de acesso e segurança</CardTitle>
          <CardDescription>
            Somente o Administrador Master mantém poderes globais. Os perfis abaixo concedem permissões específicas, verificadas no banco em cada operação.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>• Convite pendente não acessa o portal.</p>
          <p>• Suspensão revoga as permissões no banco imediatamente.</p>
          <p>• Colaboradores não podem virar Master nem administrador municipal.</p>
          <p>• Credenciais privadas de cobrança continuam exclusivas do Master.</p>
          <p>• Acesso técnico a clientes é limitado às ações de suporte autorizadas.</p>
          <p>• Alterações de perfis, convites e status são auditadas.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Convidar colaborador</CardTitle>
            <CardDescription>O convite será enviado por e-mail. O acesso é ativado após confirmação e definição de senha.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={invite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="staff-name">Nome completo</Label>
                <Input id="staff-name" value={inviteName} onChange={(event) => setInviteName(event.target.value)} maxLength={120} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-email">E-mail corporativo</Label>
                <Input id="staff-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} maxLength={254} required />
              </div>
              <div className="space-y-3">
                <Label>Perfil(is) inicial(is)</Label>
                {roles.map((role) => (
                  <label key={role.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                    <Checkbox checked={inviteRoleIds.includes(role.id)} onCheckedChange={(checked) => setInviteRoleIds((current) => toggleId(current, role.id, checked === true))} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{role.name}</span>
                      <span className="block text-xs text-muted-foreground">{role.description || role.slug}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Button type="submit" disabled={busy || loading || roles.length === 0}>
                {busy ? "Enviando convite..." : "Enviar convite"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Colaboradores cadastrados</CardTitle>
              <CardDescription>Convites, situação e perfis atribuídos.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>Atualizar</Button>
          </CardHeader>
          <CardContent>
            {loading ? <p className="text-sm text-muted-foreground">Carregando equipe...</p> : staff.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhum colaborador interno cadastrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Colaborador</TableHead><TableHead>Status</TableHead><TableHead>Perfis</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {staff.map((member) => (
                      <TableRow key={member.user_id}>
                        <TableCell className="min-w-[180px]">
                          <p className="font-medium">{member.display_name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </TableCell>
                        <TableCell><Badge variant={STATUS_VARIANTS[member.status]}>{STATUS_LABELS[member.status]}</Badge></TableCell>
                        <TableCell><div className="flex flex-wrap gap-1">{member.role_names.map((name) => <Badge key={name} variant="outline">{name}</Badge>)}</div></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="outline" size="sm" onClick={() => setSelectedStaffId(member.user_id)}>Perfis</Button>
                            <Button type="button" variant="ghost" size="sm" disabled={busy || member.status === "invited"} onClick={() => void changeStatus(member)}>
                              {member.status === "active" ? "Suspender" : member.status === "suspended" ? "Reativar" : "Pendente"}
                            </Button>
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
      </div>

      {selectedStaff && (
        <Card>
          <CardHeader>
            <CardTitle>Perfis de {selectedStaff.display_name}</CardTitle>
            <CardDescription>Um colaborador pode ter mais de um perfil. O conjunto de permissões é a união dos perfis atribuídos.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveStaffRoles} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {roles.map((role) => (
                  <label key={role.id} className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox checked={selectedRoleIds.includes(role.id)} onCheckedChange={(checked) => setSelectedRoleIds((current) => toggleId(current, role.id, checked === true))} />
                    <span><span className="block text-sm font-medium">{role.name}</span><span className="block text-xs text-muted-foreground">{role.description || role.slug}</span></span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || selectedRoleIds.length === 0}>Salvar perfis</Button>
                <Button type="button" variant="outline" onClick={() => setSelectedStaffId("")}>Fechar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div><CardTitle>Perfis e matriz de permissões</CardTitle><CardDescription>Edite as permissões de cada perfil. Novos perfis podem ser criados sem conceder acesso Master.</CardDescription></div>
          <Button type="button" variant="outline" onClick={() => beginRoleEdit(null)}>Novo perfil</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {roles.map((role) => (
              <div key={role.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-medium">{role.name}</p><p className="text-xs text-muted-foreground">{role.description || "Sem descrição"}</p></div>
                  {role.is_system && <Badge variant="secondary">Padrão</Badge>}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{role.permission_codes.length} permissões · {role.staff_count} colaborador(es)</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => beginRoleEdit(role)}>Configurar permissões</Button>
              </div>
            ))}
          </div>
          {roleEditorOpen ? (
            <form onSubmit={saveRole} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{editingRole ? `Editar perfil: ${editingRole.name}` : "Criar perfil interno"}</h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRoleEditorOpen(false)}>Fechar</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="staff-role-name">Nome do perfil</Label><Input id="staff-role-name" value={roleName} onChange={(event) => setRoleName(event.target.value)} maxLength={80} required disabled={!!editingRole?.is_system} /></div>
                <div className="space-y-2"><Label htmlFor="staff-role-slug">Identificador</Label><Input id="staff-role-slug" value={roleSlug} onChange={(event) => setRoleSlug(event.target.value)} maxLength={60} required disabled={!!editingRole?.is_system} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="staff-role-description">Descrição</Label><Textarea id="staff-role-description" value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} maxLength={500} rows={2} /></div>
              <div className="space-y-3">
                <Label>Matriz de permissões</Label>
                {PERMISSIONS.map((permission) => (
                  <label key={permission.code} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                    <Checkbox disabled={permission.code === "dashboard.view"} checked={rolePermissions.includes(permission.code)} onCheckedChange={(checked) => setRolePermissions((current) => checked === true ? [...new Set([...current, permission.code])] : current.filter((code) => code !== permission.code))} />
                    <span><span className="block text-sm font-medium">{permission.label}</span><span className="block text-xs text-muted-foreground">{permission.description}</span></span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || rolePermissions.length === 0}>Salvar matriz</Button><Button type="button" variant="outline" onClick={() => setRoleEditorOpen(false)}>Cancelar</Button></div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
