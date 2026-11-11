import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — Gestão de Fornecedores da Saúde" }] }),
  component: Usuarios,
});

type Membership = Tables<"tenant_memberships">;
type TenantRole = Tables<"tenant_roles">;
type Convite = Tables<"tenant_invitations">;
type Membro = Membership & {
  profiles?: { full_name: string } | null;
  membership_roles?: { role_id: string; tenant_roles?: { name: string; slug: string } | null }[];
};
type Capabilities = {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_assign_role: boolean;
  can_suspend: boolean;
};
type Candidate = { user_id: string; full_name: string };

function Usuarios() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [membros, setMembros] = useState<Membro[]>([]);
  const [papeis, setPapeis] = useState<TenantRole[]>([]);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [capacidades, setCapacidades] = useState<Capabilities>({
    can_view: false,
    can_create: false,
    can_edit: false,
    can_assign_role: false,
    can_suspend: false,
  });
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [dialogoConviteAberto, setDialogoConviteAberto] = useState(false);
  const [nomeConvite, setNomeConvite] = useState("");
  const [emailConvite, setEmailConvite] = useState("");
  const [papelConviteId, setPapelConviteId] = useState("");
  const [enviandoConvite, setEnviandoConvite] = useState(false);
  const [cancelandoConviteId, setCancelandoConviteId] = useState<string | null>(null);
  const [membroEmEdicao, setMembroEmEdicao] = useState<Membro | null>(null);
  const [novoPapelId, setNovoPapelId] = useState("");
  const [salvandoPapel, setSalvandoPapel] = useState(false);
  const [email, setEmail] = useState("");
  const [candidato, setCandidato] = useState<Candidate | null>(null);
  const [papelId, setPapelId] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [busca, setBusca] = useState("");
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [permissionCatalog, setPermissionCatalog] = useState<
    { id: string; code: string; name: string; description: string; module: string }[]
  >([]);
  const [rolePermissionRows, setRolePermissionRows] = useState<
    { role_id: string; permission_id: string }[]
  >([]);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleEditing, setRoleEditing] = useState<TenantRole | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleSlug, setRoleSlug] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const [savingRole, setSavingRole] = useState(false);

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setMembros([]);
      setPapeis([]);
      setConvites([]);
      setCanManageRoles(false);
      setPermissionCatalog([]);
      setRolePermissionRows([]);
      setCapacidades({
        can_view: false,
        can_create: false,
        can_edit: false,
        can_assign_role: false,
        can_suspend: false,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    setCanManageRoles(false);
    setPermissionCatalog([]);
    setRolePermissionRows([]);
    try {
      const [cap, membershipResult, roleResult, invitationResult] = await Promise.all([
        db.rpc("get_tenant_user_capabilities", { p_tenant_id: selecionado.id }),
        db
          .from("tenant_memberships")
          .select(
            "id,tenant_id,user_id,status,created_at,updated_at,profiles(full_name),membership_roles(role_id,tenant_roles(name,slug))",
          )
          .eq("tenant_id", selecionado.id)
          .order("created_at", { ascending: false }),
        db.from("tenant_roles").select("*").eq("tenant_id", selecionado.id).order("name"),
        db
          .from("tenant_invitations")
          .select("*")
          .eq("tenant_id", selecionado.id)
          .order("created_at", { ascending: false }),
      ]);
      if (cap.error) throw cap.error;
      if (membershipResult.error) throw membershipResult.error;
      if (roleResult.error) throw roleResult.error;
      if (invitationResult.error) throw invitationResult.error;
      const allowed = cap.data?.[0] ?? {
        can_view: false,
        can_create: false,
        can_edit: false,
        can_assign_role: false,
        can_suspend: false,
      };
      setCapacidades(allowed);
      setMembros(allowed.can_view ? ((membershipResult.data ?? []) as unknown as Membro[]) : []);
      setPapeis(roleResult.data ?? []);
      setConvites(allowed.can_view ? (invitationResult.data ?? []) : []);
      const roleManagement = await db.rpc("get_tenant_role_management_capability", {
        p_tenant_id: selecionado.id,
      });
      if (roleManagement.error) throw roleManagement.error;
      const canManage = Boolean(roleManagement.data);
      setCanManageRoles(canManage);
      if (canManage) {
        const [permissionResult, rolePermissionResult] = await Promise.all([
          db
            .from("permissions")
            .select("id,code,name,description,module")
            .order("module")
            .order("name"),
          db.from("tenant_role_permissions").select("role_id,permission_id"),
        ]);
        if (permissionResult.error) throw permissionResult.error;
        if (rolePermissionResult.error) throw rolePermissionResult.error;
        setPermissionCatalog(permissionResult.data ?? []);
        setRolePermissionRows(rolePermissionResult.data ?? []);
      } else {
        setPermissionCatalog([]);
        setRolePermissionRows([]);
      }
      setPapelId((current) =>
        roleResult.data?.some((role) => role.id === current)
          ? current
          : (roleResult.data?.find((role) => role.slug === "admin")?.id ??
            roleResult.data?.[0]?.id ??
            ""),
      );
      setPapelConviteId((current) =>
        roleResult.data?.some((role) => role.id === current)
          ? current
          : (roleResult.data?.find((role) => role.slug === "operador")?.id ??
            roleResult.data?.[0]?.id ??
            ""),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setMembros([]);
      setPapeis([]);
      setConvites([]);
      setCanManageRoles(false);
      setPermissionCatalog([]);
      setRolePermissionRows([]);
    } finally {
      setLoading(false);
    }
  }, [selecionado?.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const lista = membros.filter((m) => {
    const term = busca.trim().toLocaleLowerCase("pt-BR");
    return !term || (m.profiles?.full_name ?? "").toLocaleLowerCase("pt-BR").includes(term);
  });

  async function localizarConta(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setBuscando(true);
    setCandidato(null);
    setErro(null);
    try {
      const { data, error: lookupError } = await db.rpc("find_tenant_user_by_email", {
        p_tenant_id: selecionado.id,
        p_email: email.trim(),
      });
      if (lookupError) throw lookupError;
      const candidate = data?.[0];
      if (!candidate) {
        setErro(
          "Nenhuma conta confirmada e disponível foi encontrada com esse e-mail. A pessoa precisa criar a conta e confirmar o endereço antes de ser vinculada.",
        );
        return;
      }
      setCandidato(candidate);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscando(false);
    }
  }

  async function vincularConta() {
    if (!selecionado || !candidato || !papelId) return;
    setVinculando(true);
    setErro(null);
    try {
      const { error: linkError } = await db.rpc("add_tenant_member", {
        p_tenant_id: selecionado.id,
        p_user_id: candidato.user_id,
        p_role_id: papelId,
      });
      if (linkError) throw linkError;
      toast.success("Usuário vinculado à Secretaria.");
      setDialogoAberto(false);
      setEmail("");
      setCandidato(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setVinculando(false);
    }
  }

  async function enviarConvite(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || !capacidades.can_create || !capacidades.can_assign_role) return;
    setEnviandoConvite(true);
    setErro(null);
    const { data, error: inviteError } = await db.functions.invoke("invite-tenant-user", {
      body: {
        tenant_id: selecionado.id,
        email: emailConvite.trim().toLowerCase(),
        full_name: nomeConvite.trim(),
        role_id: papelConviteId,
      },
    });
    setEnviandoConvite(false);
    if (inviteError) {
      let mensagem =
        "Não foi possível enviar o convite. Confira a configuração de SMTP do Supabase e as permissões do seu perfil.";
      const contexto = (inviteError as { context?: unknown }).context;
      if (contexto instanceof Response) {
        try {
          const resposta = (await contexto.clone().json()) as { error?: unknown };
          if (typeof resposta.error === "string" && resposta.error.trim()) {
            mensagem = resposta.error;
          }
        } catch {
          // Keep the generic message when the server does not return JSON.
        }
      }
      setErro(mensagem);
      return;
    }
    toast.success("Convite enviado. O acesso será liberado após a confirmação do e-mail.");
    setDialogoConviteAberto(false);
    setNomeConvite("");
    setEmailConvite("");
    setPapelConviteId(papeis.find((role) => role.slug === "operador")?.id ?? papeis[0]?.id ?? "");
    await carregar();
    void data;
  }

  async function cancelarConvite(convite: Convite) {
    if (!selecionado || convite.status !== "pending") return;
    setCancelandoConviteId(convite.id);
    const { error: revokeError } = await db.rpc("revoke_tenant_invitation", {
      p_invitation_id: convite.id,
    });
    setCancelandoConviteId(null);
    if (revokeError) {
      toast.error(revokeError.message);
      return;
    }
    toast.success("Convite cancelado. O link não poderá mais ativar o acesso.");
    await carregar();
  }

  function conviteExpirado(convite: Convite) {
    return (
      convite.status === "expired" ||
      (convite.status === "pending" && Date.parse(convite.expires_at) <= Date.now())
    );
  }

  function statusConvite(convite: Convite) {
    if (conviteExpirado(convite)) return "Expirado";
    if (convite.status === "pending") return "Pendente";
    if (convite.status === "accepted") return "Aceito";
    if (convite.status === "revoked") return "Cancelado";
    if (convite.status === "already_member") return "Já era membro";
    return convite.status;
  }

  function abrirEdicaoPapel(membro: Membro) {
    const roleId = membro.membership_roles?.[0]?.role_id ?? "";
    setMembroEmEdicao(membro);
    setNovoPapelId(roleId);
    setErro(null);
  }

  async function salvarPapel() {
    if (!membroEmEdicao || !novoPapelId || !selecionado || salvandoPapel) return;
    setSalvandoPapel(true);
    setErro(null);
    try {
      const { error: roleError } = await db.rpc("set_tenant_member_role", {
        p_membership_id: membroEmEdicao.id,
        p_role_id: novoPapelId,
      });
      if (roleError) throw roleError;
      toast.success("Papel do usuário atualizado.");
      setMembroEmEdicao(null);
      setNovoPapelId("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoPapel(false);
    }
  }

  function abrirEditorPerfil(role?: TenantRole) {
    if (!canManageRoles) return;
    setRoleEditing(role ?? null);
    setRoleName(role?.name ?? "");
    setRoleSlug(role?.slug ?? "");
    setRoleDescription(role?.description ?? "");
    setSelectedPermissionIds(
      role
        ? rolePermissionRows.filter((x) => x.role_id === role.id).map((x) => x.permission_id)
        : [],
    );
    setRoleDialogOpen(true);
  }

  async function salvarPerfil(event: FormEvent) {
    event.preventDefault();
    if (!selecionado || !canManageRoles || !selectedPermissionIds.length || savingRole) return;
    setSavingRole(true);
    try {
      const { error } = await db.rpc("save_tenant_role_with_permissions", {
        p_tenant_id: selecionado.id,
        p_role_id: roleEditing?.id ?? null,
        p_name: roleName.trim(),
        p_slug: roleSlug.trim().toLowerCase(),
        p_description: roleDescription.trim() || null,
        p_permission_ids: selectedPermissionIds,
      });
      if (error) throw error;
      toast.success(
        roleEditing ? "Perfil atualizado e permissões aplicadas." : "Perfil criado com permissões.",
      );
      setRoleDialogOpen(false);
      await carregar();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil.");
    } finally {
      setSavingRole(false);
    }
  }

  async function alternarStatus(membro: Membro) {
    if (!selecionado || !capacidades.can_suspend) return;
    const novoStatus = membro.status === "active" ? "suspended" : "active";
    const { error: updateError } = await db
      .from("tenant_memberships")
      .update({ status: novoStatus })
      .eq("id", membro.id)
      .eq("tenant_id", selecionado.id);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success(
      novoStatus === "suspended"
        ? "Acesso suspenso nesta Secretaria."
        : "Acesso reativado nesta Secretaria.",
    );
    await carregar();
  }

  if (!selecionado)
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>
          Os usuários são vinculados e administrados separadamente em cada Secretaria.
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acessos, papéis e situação dos usuários de {selecionado.nome}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void carregar()}
            disabled={loading}
            aria-label="Atualizar lista"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {capacidades.can_create && capacidades.can_assign_role && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setErro(null);
                  setNomeConvite("");
                  setEmailConvite("");
                  setDialogoConviteAberto(true);
                }}
              >
                <Plus className="h-4 w-4" /> Convidar por e-mail
              </Button>
              <Button
                onClick={() => {
                  setErro(null);
                  setEmail("");
                  setCandidato(null);
                  setDialogoAberto(true);
                }}
              >
                <UserCheck className="h-4 w-4" /> Vincular conta existente
              </Button>
            </>
          )}
        </div>
      </div>

      {canManageRoles && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Perfis e permissões</h2>
              <p className="text-sm text-muted-foreground">
                Crie perfis personalizados e escolha os acessos de cada função. Perfis nativos
                permanecem protegidos.
              </p>
            </div>
            <Button onClick={() => abrirEditorPerfil()}>
              <Plus className="h-4 w-4" /> Novo perfil
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {papeis.map((role) => (
              <div key={role.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{role.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {role.slug} · {rolePermissionRows.filter((x) => x.role_id === role.id).length}{" "}
                      permissões
                    </p>
                    {role.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>
                    )}
                  </div>
                  {role.is_system ? (
                    <Badge variant="outline">Nativo protegido</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => abrirEditorPerfil(role)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <Dialog open={roleDialogOpen} onOpenChange={(open) => !savingRole && setRoleDialogOpen(open)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {roleEditing ? "Editar perfil personalizado" : "Criar perfil personalizado"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarPerfil} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Nome do perfil *</Label>
                <Input
                  required
                  minLength={2}
                  maxLength={80}
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Identificador *</Label>
                <Input
                  required
                  minLength={2}
                  maxLength={60}
                  pattern="[a-z0-9][a-z0-9_-]{1,59}"
                  value={roleSlug}
                  onChange={(e) => setRoleSlug(e.target.value)}
                  placeholder="ex: fiscal_contrato"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Descrição</Label>
                <Input
                  maxLength={300}
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Permissões disponíveis</Label>
                <span className="text-xs text-muted-foreground">
                  {selectedPermissionIds.length} selecionada(s)
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {permissionCatalog.map((permission) => (
                  <label
                    key={permission.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedPermissionIds.includes(permission.id)}
                      onChange={(e) =>
                        setSelectedPermissionIds((current) =>
                          e.target.checked
                            ? [...new Set([...current, permission.id])]
                            : current.filter((id) => id !== permission.id),
                        )
                      }
                    />
                    <span>
                      <span className="block font-medium">{permission.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {permission.description}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {permission.code}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRoleDialogOpen(false)}
                disabled={savingRole}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={savingRole || !selectedPermissionIds.length}>
                {savingRole ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}{" "}
                Salvar perfil
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Vínculos</p>
          <p className="mt-1 text-2xl font-semibold">{membros.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Ativos</p>
          <p className="mt-1 text-2xl font-semibold">
            {membros.filter((m) => m.status === "active").length}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Suspensos</p>
          <p className="mt-1 text-2xl font-semibold">
            {membros.filter((m) => m.status === "suspended").length}
          </p>
        </div>
      </div>

      {capacidades.can_view && (
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-semibold">Convites por e-mail</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                O vínculo só será ativado quando o convidado confirmar o endereço e entrar na
                plataforma.
              </p>
            </div>
            <Badge variant="outline">
              {
                convites.filter(
                  (convite) => convite.status === "pending" && !conviteExpirado(convite),
                ).length
              }{" "}
              pendentes
            </Badge>
          </div>
          {convites.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum convite registrado nesta Secretaria.
            </p>
          ) : (
            <div className="divide-y">
              {convites.slice(0, 10).map((convite) => (
                <div
                  key={convite.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{convite.invited_email}</p>
                    <p className="text-xs text-muted-foreground">
                      {papeis.find((role) => role.id === convite.role_id)?.name ?? "Papel"} ·{" "}
                      {statusConvite(convite)} · expira em{" "}
                      {new Date(convite.expires_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  {convite.status === "pending" &&
                    capacidades.can_create &&
                    capacidades.can_assign_role && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void cancelarConvite(convite)}
                        disabled={cancelandoConviteId !== null}
                      >
                        {cancelandoConviteId === convite.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <UserX className="h-4 w-4" />
                        )}
                        Cancelar convite
                      </Button>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível concluir a operação</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      {!capacidades.can_view && !loading ? (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Acesso de consulta não autorizado</AlertTitle>
          <AlertDescription>
            Seu papel não possui permissão para listar os usuários desta Secretaria.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar usuário"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : lista.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Nenhum usuário vinculado encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  lista.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <p className="font-medium">{m.profiles?.full_name ?? "Usuário"}</p>
                        <p className="text-xs text-muted-foreground">ID: {m.user_id.slice(0, 8)}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(m.membership_roles ?? []).map((mr, i) => (
                            <Badge key={i} variant="secondary">
                              {mr.tenant_roles?.name ?? "—"}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.status === "active" ? "secondary" : "outline"}>
                          {m.status === "active"
                            ? "Ativo"
                            : m.status === "suspended"
                              ? "Suspenso"
                              : m.status === "invited"
                                ? "Convidado"
                                : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {capacidades.can_assign_role && m.user_id !== session?.user.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirEdicaoPapel(m)}
                              aria-label={`Alterar papel de ${m.profiles?.full_name ?? "usuário"}`}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Papel
                            </Button>
                          )}
                          {m.user_id === session?.user.id ? (
                            <span className="px-2 text-xs text-muted-foreground">Sua conta</span>
                          ) : capacidades.can_suspend ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void alternarStatus(m)}
                            >
                              {m.status === "active" ? (
                                <>
                                  <UserX className="h-4 w-4" /> Suspender
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-4 w-4" /> Reativar
                                </>
                              )}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        Para vincular alguém, a pessoa deve criar sua conta em <strong>/cadastro</strong> e
        confirmar o e-mail. Depois, informe aqui o mesmo e-mail e selecione o papel. A suspensão
        remove o acesso somente a esta Secretaria, sem apagar a conta nem o histórico.
      </div>

      <Dialog
        open={dialogoConviteAberto}
        onOpenChange={(open) => {
          if (!enviandoConvite) setDialogoConviteAberto(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar usuário por e-mail</DialogTitle>
            <DialogDescription>
              Enviaremos um link de convite. O acesso só será ativado após a confirmação do mesmo
              e-mail.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={enviarConvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="convite-nome">Nome completo</Label>
              <Input
                id="convite-nome"
                required
                minLength={2}
                maxLength={160}
                value={nomeConvite}
                onChange={(event) => setNomeConvite(event.target.value)}
                placeholder="Nome do profissional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="convite-email">E-mail do convidado</Label>
              <Input
                id="convite-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={emailConvite}
                onChange={(event) => setEmailConvite(event.target.value)}
                placeholder="usuario@orgao.gov.br"
              />
            </div>
            <div className="space-y-2">
              <Label>Papel na Secretaria</Label>
              <Select value={papelConviteId} onValueChange={setPapelConviteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o papel" />
                </SelectTrigger>
                <SelectContent>
                  {papeis.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Alert>
              <AlertTitle>Entrega do e-mail</AlertTitle>
              <AlertDescription>
                O envio depende do SMTP configurado no Supabase. Para convidar endereços externos ao
                time do projeto, configure um provedor SMTP próprio antes de utilizar em produção.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogoConviteAberto(false)}
                disabled={enviandoConvite}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={enviandoConvite || !papelConviteId}>
                {enviandoConvite ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogoAberto}
        onOpenChange={(open) => {
          if (!vinculando) setDialogoAberto(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular usuário existente</DialogTitle>
            <DialogDescription>
              A conta precisa estar cadastrada, confirmada e ainda não vinculada a esta Secretaria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <form onSubmit={localizarConta} className="space-y-2">
              <Label htmlFor="usuario-email">E-mail da conta</Label>
              <div className="flex gap-2">
                <Input
                  id="usuario-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setCandidato(null);
                  }}
                  placeholder="usuario@exemplo.com"
                />
                <Button type="submit" variant="outline" disabled={buscando || !email.trim()}>
                  {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Localizar"}
                </Button>
              </div>
            </form>
            {candidato && (
              <div className="rounded-md border bg-card p-3">
                <p className="text-sm font-medium">{candidato.full_name}</p>
                <p className="text-xs text-muted-foreground">{email}</p>
                <Badge variant="secondary" className="mt-2">
                  Conta localizada
                </Badge>
              </div>
            )}
            <div className="space-y-2">
              <Label>Papel na Secretaria</Label>
              <Select value={papelId} onValueChange={setPapelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o papel" />
                </SelectTrigger>
                <SelectContent>
                  {papeis.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogoAberto(false)} disabled={vinculando}>
              Cancelar
            </Button>
            <Button
              onClick={() => void vincularConta()}
              disabled={!candidato || !papelId || vinculando}
            >
              {vinculando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}{" "}
              Confirmar vínculo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!membroEmEdicao}
        onOpenChange={(open) => {
          if (!open && !salvandoPapel) {
            setMembroEmEdicao(null);
            setNovoPapelId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar papel do usuário</DialogTitle>
            <DialogDescription>
              {membroEmEdicao?.profiles?.full_name ?? "Usuário"} · {selecionado.nome}. A alteração
              será registrada no histórico da Secretaria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Novo papel</Label>
            <Select value={novoPapelId} onValueChange={setNovoPapelId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o papel" />
              </SelectTrigger>
              <SelectContent>
                {papeis.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A Secretaria precisa manter pelo menos um administrador ativo. O banco impede rebaixar
              o último administrador.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMembroEmEdicao(null);
                setNovoPapelId("");
              }}
              disabled={salvandoPapel}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void salvarPapel()}
              disabled={
                !novoPapelId ||
                !membroEmEdicao ||
                novoPapelId === membroEmEdicao.membership_roles?.[0]?.role_id ||
                salvandoPapel
              }
            >
              {salvandoPapel ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="h-4 w-4" />
              )}
              Salvar papel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
