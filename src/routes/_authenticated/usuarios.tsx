import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Ellipsis, Loader2, LockKeyhole, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserCheck, UserRound, UserX,
} from "lucide-react";
import { toast } from "sonner";
import { isInvitationExpired } from "@/lib/invitations";
import { db } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — Gestão de Fornecedores da Saúde" }] }),
  component: Usuarios,
});

type Membership = Tables<"tenant_memberships">;
type TenantRole = Tables<"tenant_roles">;
type Convite = Pick<
  Tables<"tenant_invitations">,
  "id" | "invited_email" | "role_id" | "status" | "expires_at"
>;
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
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroPapel, setFiltroPapel] = useState("todos");
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
        db
          .from("tenant_roles")
          .select("id,name,slug,description,is_system,tenant_id,created_at,updated_at")
          .eq("tenant_id", selecionado.id)
          .order("name"),
        db
          .from("tenant_invitations")
          .select("id,invited_email,role_id,status,expires_at")
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

  const convitesPendentes = convites.filter((invite) => invite.status === "pending" && !conviteExpirado(invite));
  const lista = membros.filter((member) => {
    const term = busca.trim().toLocaleLowerCase("pt-BR");
    const matchesName = !term || (member.profiles?.full_name ?? "").toLocaleLowerCase("pt-BR").includes(term);
    const matchesStatus = filtroStatus === "todos" || member.status === filtroStatus;
    const matchesRole = filtroPapel === "todos" || (member.membership_roles ?? []).some((item) => item.role_id === filtroPapel);
    return matchesName && matchesStatus && matchesRole;
  });
  const permissoesPorModulo = useMemo(() => permissionCatalog.reduce<Record<string, typeof permissionCatalog>>((groups, permission) => {
    const moduleName = permission.module?.trim() || "Outros";
    (groups[moduleName] ??= []).push(permission);
    return groups;
  }, {}), [permissionCatalog]);
  const iniciais = (nome: string) => nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "").join("");

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
    return isInvitationExpired(convite.status, convite.expires_at);
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
    if (!capacidades.can_assign_role || membro.user_id === session?.user.id) return;
    const roleId = membro.membership_roles?.[0]?.role_id ?? "";
    setMembroEmEdicao(membro);
    setNovoPapelId(roleId);
    setErro(null);
  }

  async function salvarPapel() {
    if (!membroEmEdicao || membroEmEdicao.user_id === session?.user.id || !capacidades.can_assign_role || !novoPapelId || !selecionado || salvandoPapel) return;
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
    if (!canManageRoles || role?.is_system) return;
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
    if (!selecionado || !canManageRoles || roleEditing?.is_system || !selectedPermissionIds.length || savingRole) return;
    setSavingRole(true);
    try {
      const { error } = await db.rpc("save_tenant_role_with_permissions", {
        p_tenant_id: selecionado.id,
        p_role_id: (roleEditing?.id ?? null) as string,
        p_name: roleName.trim(),
        p_slug: roleSlug.trim().toLowerCase(),
        p_description: (roleDescription.trim() || null) as string,
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
    if (!selecionado || !capacidades.can_suspend || membro.user_id === session?.user.id) return;
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

  if (!selecionado) return (<Alert><AlertTitle>Selecione uma Secretaria</AlertTitle><AlertDescription>Os usuários são vinculados e administrados separadamente em cada Secretaria.</AlertDescription></Alert>);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary"><UserRound className="h-4 w-4" /> Administração da Secretaria</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Usuários</h1><p className="max-w-2xl text-sm text-muted-foreground">Gerencie a equipe, acompanhe convites e organize os níveis de acesso de {selecionado.nome}.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" onClick={() => void carregar()} disabled={loading} aria-label="Atualizar lista"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
          {capacidades.can_create && capacidades.can_assign_role && <><Button variant="outline" onClick={() => { setErro(null); setNomeConvite(""); setEmailConvite(""); setDialogoConviteAberto(true); }}><Plus /> Convidar por e-mail</Button><Button onClick={() => { setErro(null); setEmail(""); setCandidato(null); setDialogoAberto(true); }}><UserCheck /> Vincular conta</Button></>}
        </div>
      </header>
      {erro && <Alert variant="destructive"><AlertTitle>Não foi possível concluir a operação</AlertTitle><AlertDescription>{erro}</AlertDescription></Alert>}
      {!capacidades.can_view && !loading && !canManageRoles ? <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Acesso de consulta não autorizado</AlertTitle><AlertDescription>Seu papel não possui permissão para listar os usuários desta Secretaria.</AlertDescription></Alert> :
      <Tabs defaultValue="equipe" className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1 sm:inline-grid sm:w-auto sm:grid-cols-3">
          <TabsTrigger value="equipe" className="gap-2 px-3 py-2.5"><UserRound className="h-4 w-4" /> Equipe vinculada</TabsTrigger>
          <TabsTrigger value="convites" className="gap-2 px-3 py-2.5">Convites <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{convitesPendentes.length}</Badge></TabsTrigger>
          {canManageRoles && <TabsTrigger value="perfis" className="col-span-2 gap-2 px-3 py-2.5 sm:col-span-1"><ShieldCheck className="h-4 w-4" /> Perfis e permissões</TabsTrigger>}
        </TabsList>
        <TabsContent value="equipe" className="space-y-5">
          {!capacidades.can_view ? <Alert><AlertTitle>Consulta da equipe não autorizada</AlertTitle><AlertDescription>Seu papel não possui permissão para listar os usuários desta Secretaria.</AlertDescription></Alert> : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric title="Total de vínculos" value={membros.length} note="Contas vinculadas à Secretaria" />
              <Metric title="Ativos" value={membros.filter((m) => m.status === "active").length} note="Com acesso habilitado" tone="green" />
              <Metric title="Suspensos" value={membros.filter((m) => m.status === "suspended").length} note="Sem acesso no momento" tone="amber" />
              <Metric title="Convites pendentes" value={convitesPendentes.length} note="Aguardando confirmação" />
            </div>
            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="border-b p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Equipe da Secretaria</h2><p className="text-sm text-muted-foreground">Consulte os vínculos e gerencie os acessos individuais.</p></div><Badge variant="outline">{lista.length} resultado(s)</Badge></div>
                <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_210px]">
                  <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar pelo nome..." aria-label="Buscar usuário pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}><SelectTrigger aria-label="Filtrar por situação"><SelectValue placeholder="Situação" /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="active">Ativos</SelectItem><SelectItem value="suspended">Suspensos</SelectItem></SelectContent></Select>
                  <Select value={filtroPapel} onValueChange={setFiltroPapel}><SelectTrigger aria-label="Filtrar por papel"><SelectValue placeholder="Papel" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os papéis</SelectItem>{papeis.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
              <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-muted/30 hover:bg-muted/30"><TableHead className="pl-5">Profissional</TableHead><TableHead>Perfil de acesso</TableHead><TableHead>Situação</TableHead><TableHead className="w-16 pr-5 text-right">Ações</TableHead></TableRow></TableHeader>
                <TableBody>{loading ? <TableRow><TableCell colSpan={4} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /><span className="mt-2 block text-xs text-muted-foreground">Carregando equipe...</span></TableCell></TableRow> : lista.length === 0 ? <TableRow><TableCell colSpan={4} className="py-12 text-center"><UserRound className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-2 font-medium">Nenhum usuário encontrado</p><p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros ou vincule uma nova conta à Secretaria.</p></TableCell></TableRow> : lista.map((member) => {
                  const self = member.user_id === session?.user.id, name = member.profiles?.full_name ?? "Usuário";
                  return <TableRow key={member.id}>
                    <TableCell className="py-3 pl-5"><div className="flex min-w-0 items-center gap-3"><Avatar className="h-10 w-10 border"><AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{iniciais(name) || "US"}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium text-foreground">{name}</p><p className="text-xs text-muted-foreground">{self ? "Conta atualmente conectada" : `ID: ${member.user_id.slice(0,8)}`}</p></div>{self && <Badge variant="secondary" className="shrink-0">Sua conta</Badge>}</div></TableCell>
                    <TableCell><div className="flex flex-wrap gap-1.5">{(member.membership_roles ?? []).map((item,i) => <Badge key={item.role_id || i} variant="secondary" className="font-medium">{item.tenant_roles?.name ?? "—"}</Badge>)}</div></TableCell>
                    <TableCell><Badge variant="outline" className={member.status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : member.status === "suspended" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}><span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${member.status === "active" ? "bg-emerald-500" : member.status === "suspended" ? "bg-amber-500" : "bg-muted-foreground"}`} />{member.status === "active" ? "Ativo" : member.status === "suspended" ? "Suspenso" : member.status === "invited" ? "Convidado" : "Inativo"}</Badge></TableCell>
                    <TableCell className="pr-5 text-right">{!self ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações de ${name}`}><Ellipsis className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{capacidades.can_assign_role && <DropdownMenuItem onSelect={() => abrirEdicaoPapel(member)}><Pencil /> Alterar papel</DropdownMenuItem>}{capacidades.can_assign_role && capacidades.can_suspend && <DropdownMenuSeparator />}{capacidades.can_suspend && <DropdownMenuItem className={member.status === "active" ? "text-destructive focus:text-destructive" : ""} onSelect={() => void alternarStatus(member)}>{member.status === "active" ? <><UserX /> Suspender acesso</> : <><UserCheck /> Reativar acesso</>}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu> : <span className="pr-2 text-xs text-muted-foreground">Você</span>}</TableCell>
                  </TableRow>;
                })}</TableBody></Table></div>
              <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:px-5">A suspensão remove o acesso somente a esta Secretaria, sem apagar a conta nem o histórico.</div>
            </section>
          </>}
        </TabsContent>
        <TabsContent value="convites" className="space-y-4"><section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5"><div><h2 className="font-semibold">Convites enviados</h2><p className="text-sm text-muted-foreground">Acompanhe os convites e a confirmação de acesso à Secretaria.</p></div><Badge variant="secondary">{convitesPendentes.length} aguardando</Badge></div>
          {!capacidades.can_view ? <p className="p-6 text-sm text-muted-foreground">Sem permissão para consultar convites.</p> : convites.length === 0 ? <div className="px-6 py-14 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted"><UserCheck className="h-5 w-5 text-muted-foreground" /></div><h3 className="mt-3 font-medium">Nenhum convite emitido</h3><p className="mt-1 text-sm text-muted-foreground">Quando um convite for enviado, ele aparecerá nesta lista.</p></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-muted/30 hover:bg-muted/30"><TableHead className="pl-5">E-mail convidado</TableHead><TableHead>Perfil previsto</TableHead><TableHead>Status</TableHead><TableHead>Expiração</TableHead><TableHead className="pr-5 text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{convites.map((invite) => <TableRow key={invite.id}><TableCell className="pl-5 font-medium">{invite.invited_email}</TableCell><TableCell>{papeis.find((role) => role.id === invite.role_id)?.name ?? "—"}</TableCell><TableCell><Badge variant="outline" className={conviteExpirado(invite) ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : invite.status === "pending" ? "border-blue-500/30 bg-blue-500/10 text-blue-700" : "text-muted-foreground"}>{statusConvite(invite)}</Badge></TableCell><TableCell className="whitespace-nowrap text-sm text-muted-foreground">{new Date(invite.expires_at).toLocaleDateString("pt-BR")}</TableCell><TableCell className="pr-5 text-right">{invite.status === "pending" && !conviteExpirado(invite) && capacidades.can_create && capacidades.can_assign_role && <Button size="sm" variant="outline" onClick={() => void cancelarConvite(invite)} disabled={cancelandoConviteId !== null}>{cancelandoConviteId === invite.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX />} Cancelar</Button>}</TableCell></TableRow>)}</TableBody></Table></div>}
        </section></TabsContent>
        {canManageRoles && <TabsContent value="perfis" className="space-y-4"><section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Perfis e permissões</h2><p className="text-sm text-muted-foreground">Defina os acessos por função. Os perfis nativos permanecem protegidos.</p></div><Button onClick={() => abrirEditorPerfil()}><Plus /> Novo perfil</Button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{papeis.map((role) => { const count = rolePermissionRows.filter((row) => row.role_id === role.id).length; return <article key={role.id} className="flex min-h-40 flex-col justify-between rounded-xl border bg-background p-4 transition-shadow hover:shadow-sm"><div><div className="flex items-start justify-between gap-2"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{role.is_system ? <LockKeyhole className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</div>{role.is_system ? <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary"><LockKeyhole className="h-3 w-3" /> Nativo protegido</Badge> : <Badge variant="secondary">Personalizado</Badge>}</div><h3 className="mt-3 font-semibold">{role.name}</h3><p className="mt-1 text-xs text-muted-foreground">{role.description || role.slug}</p></div><div className="mt-4 flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">{count} permissões</span>{!role.is_system && <Button size="sm" variant="outline" onClick={() => abrirEditorPerfil(role)}><Pencil /> Editar perfil</Button>}</div></article>; })}</div></section></TabsContent>}
      </Tabs>}
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
              <div className="space-y-3">
                {Object.entries(permissoesPorModulo).map(([moduleName, permissions]) => {
                  const ids = permissions.map((permission) => permission.id);
                  const count = ids.filter((id) => selectedPermissionIds.includes(id)).length;
                  const allSelected = count === ids.length;
                  return <section key={moduleName} className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{moduleName}</h3><p className="text-xs text-muted-foreground">{count} de {ids.length} permissões selecionadas</p></div>
                      <Button type="button" size="sm" variant="outline" onClick={() => setSelectedPermissionIds((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])])}>{allSelected ? "Desmarcar módulo" : "Marcar módulo"}</Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">{permissions.map((permission) => <label key={permission.id} className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-3 text-sm hover:border-primary/40">
                      <input type="checkbox" className="mt-1" checked={selectedPermissionIds.includes(permission.id)} onChange={(event) => setSelectedPermissionIds((current) => event.target.checked ? [...new Set([...current, permission.id])] : current.filter((id) => id !== permission.id))} />
                      <span className="min-w-0"><span className="block font-medium">{permission.name}</span><span className="block text-xs text-muted-foreground">{permission.description}</span><span className="block text-[11px] text-muted-foreground">{permission.code}</span></span>
                    </label>)}</div>
                  </section>;
                })}
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
function Metric({ title, value, note, tone = "default" }: { title: string; value: number; note: string; tone?: "default" | "green" | "amber" }) {
  return <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : ""}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}
