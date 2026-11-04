import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — Gestão de Fornecedores da Saúde" }] }),
  component: Usuarios,
});

type Membership = Tables<"tenant_memberships">;
type TenantRole = Tables<"tenant_roles">;
type Membro = Membership & {
  profiles?: { full_name: string } | null;
  membership_roles?: { tenant_roles?: { name: string; slug: string } | null }[];
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
  const [capacidades, setCapacidades] = useState<Capabilities>({
    can_view: false, can_create: false, can_edit: false, can_assign_role: false, can_suspend: false,
  });
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [email, setEmail] = useState("");
  const [candidato, setCandidato] = useState<Candidate | null>(null);
  const [papelId, setPapelId] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setMembros([]); setPapeis([]);
      setCapacidades({ can_view: false, can_create: false, can_edit: false, can_assign_role: false, can_suspend: false });
      setLoading(false);
      return;
    }
    setLoading(true); setErro(null);
    try {
      const [cap, membershipResult, roleResult] = await Promise.all([
        db.rpc("get_tenant_user_capabilities", { p_tenant_id: selecionado.id }),
        db.from("tenant_memberships")
          .select("id,tenant_id,user_id,status,created_at,updated_at,profiles(full_name),membership_roles(tenant_roles(name,slug))")
          .eq("tenant_id", selecionado.id)
          .order("created_at", { ascending: false }),
        db.from("tenant_roles").select("*").eq("tenant_id", selecionado.id).order("name"),
      ]);
      if (cap.error) throw cap.error;
      if (membershipResult.error) throw membershipResult.error;
      if (roleResult.error) throw roleResult.error;
      const allowed = cap.data?.[0] ?? {
        can_view: false, can_create: false, can_edit: false, can_assign_role: false, can_suspend: false,
      };
      setCapacidades(allowed);
      setMembros(allowed.can_view ? ((membershipResult.data ?? []) as unknown as Membro[]) : []);
      setPapeis(roleResult.data ?? []);
      setPapelId((current) => roleResult.data?.some((role) => role.id === current) ? current : (roleResult.data?.find((role) => role.slug === "admin")?.id ?? roleResult.data?.[0]?.id ?? ""));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setMembros([]); setPapeis([]);
    } finally { setLoading(false); }
  }, [selecionado?.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  const lista = membros.filter((m) => {
    const term = busca.trim().toLocaleLowerCase("pt-BR");
    return !term || (m.profiles?.full_name ?? "").toLocaleLowerCase("pt-BR").includes(term);
  });

  async function localizarConta(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setBuscando(true); setCandidato(null); setErro(null);
    try {
      const { data, error: lookupError } = await db.rpc("find_tenant_user_by_email", {
        p_tenant_id: selecionado.id,
        p_email: email.trim(),
      });
      if (lookupError) throw lookupError;
      const candidate = data?.[0];
      if (!candidate) {
        setErro("Nenhuma conta confirmada e disponível foi encontrada com esse e-mail. A pessoa precisa criar a conta e confirmar o endereço antes de ser vinculada.");
        return;
      }
      setCandidato(candidate);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setBuscando(false); }
  }

  async function vincularConta() {
    if (!selecionado || !candidato || !papelId) return;
    setVinculando(true); setErro(null);
    try {
      const { error: linkError } = await db.rpc("add_tenant_member", {
        p_tenant_id: selecionado.id,
        p_user_id: candidato.user_id,
        p_role_id: papelId,
      });
      if (linkError) throw linkError;
      toast.success("Usuário vinculado à Secretaria.");
      setDialogoAberto(false); setEmail(""); setCandidato(null); await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setVinculando(false); }
  }

  async function alternarStatus(membro: Membro) {
    if (!selecionado || !capacidades.can_suspend) return;
    const novoStatus = membro.status === "active" ? "suspended" : "active";
    const { error: updateError } = await db.from("tenant_memberships")
      .update({ status: novoStatus }).eq("id", membro.id).eq("tenant_id", selecionado.id);
    if (updateError) { toast.error(updateError.message); return; }
    toast.success(novoStatus === "suspended" ? "Acesso suspenso nesta Secretaria." : "Acesso reativado nesta Secretaria.");
    await carregar();
  }

  if (!selecionado) return <Alert><AlertTitle>Selecione uma Secretaria</AlertTitle><AlertDescription>Os usuários são vinculados e administrados separadamente em cada Secretaria.</AlertDescription></Alert>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acessos, papéis e situação dos usuários de {selecionado.nome}.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void carregar()} disabled={loading} aria-label="Atualizar lista"><RefreshCw className="h-4 w-4"/></Button>
          {capacidades.can_create && capacidades.can_assign_role && <Button onClick={() => { setErro(null); setEmail(""); setCandidato(null); setDialogoAberto(true); }}><Plus className="h-4 w-4"/> Vincular usuário</Button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Vínculos</p><p className="mt-1 text-2xl font-semibold">{membros.length}</p></div>
        <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Ativos</p><p className="mt-1 text-2xl font-semibold">{membros.filter((m) => m.status === "active").length}</p></div>
        <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Suspensos</p><p className="mt-1 text-2xl font-semibold">{membros.filter((m) => m.status === "suspended").length}</p></div>
      </div>

      {erro && <Alert variant="destructive"><AlertTitle>Não foi possível concluir a operação</AlertTitle><AlertDescription>{erro}</AlertDescription></Alert>}
      {!capacidades.can_view && !loading ? <Alert><ShieldCheck className="h-4 w-4"/><AlertTitle>Acesso de consulta não autorizado</AlertTitle><AlertDescription>Seu papel não possui permissão para listar os usuários desta Secretaria.</AlertDescription></Alert> : (
        <div className="space-y-3">
          <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" placeholder="Pesquisar usuário" value={busca} onChange={(e) => setBusca(e.target.value)}/></div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Papel</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={4} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin"/></TableCell></TableRow>
                : lista.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Nenhum usuário vinculado encontrado.</TableCell></TableRow>
                : lista.map((m) => <TableRow key={m.id}>
                  <TableCell><p className="font-medium">{m.profiles?.full_name ?? "Usuário"}</p><p className="text-xs text-muted-foreground">ID: {m.user_id.slice(0,8)}</p></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{(m.membership_roles ?? []).map((mr, i) => <Badge key={i} variant="secondary">{mr.tenant_roles?.name ?? "—"}</Badge>)}</div></TableCell>
                  <TableCell><Badge variant={m.status === "active" ? "secondary" : "outline"}>{m.status === "active" ? "Ativo" : m.status === "suspended" ? "Suspenso" : m.status === "invited" ? "Convidado" : "Inativo"}</Badge></TableCell>
                  <TableCell className="text-right">{capacidades.can_suspend && (m.user_id === session?.user.id ? <span className="text-xs text-muted-foreground">Sua conta</span> : <Button size="sm" variant="outline" onClick={() => void alternarStatus(m)}>{m.status === "active" ? <><UserX className="h-4 w-4"/> Suspender</> : <><UserCheck className="h-4 w-4"/> Reativar</>}</Button>)}</TableCell>
                </TableRow>)}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        Para vincular alguém, a pessoa deve criar sua conta em <strong>/cadastro</strong> e confirmar o e-mail. Depois, informe aqui o mesmo e-mail e selecione o papel. A suspensão remove o acesso somente a esta Secretaria, sem apagar a conta nem o histórico.
      </div>

      <Dialog open={dialogoAberto} onOpenChange={(open) => { if (!vinculando) setDialogoAberto(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Vincular usuário existente</DialogTitle><DialogDescription>A conta precisa estar cadastrada, confirmada e ainda não vinculada a esta Secretaria.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <form onSubmit={localizarConta} className="space-y-2">
              <Label htmlFor="usuario-email">E-mail da conta</Label>
              <div className="flex gap-2"><Input id="usuario-email" type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setCandidato(null); }} placeholder="usuario@exemplo.com"/><Button type="submit" variant="outline" disabled={buscando || !email.trim()}>{buscando ? <Loader2 className="h-4 w-4 animate-spin"/> : "Localizar"}</Button></div>
            </form>
            {candidato && <div className="rounded-md border bg-card p-3"><p className="text-sm font-medium">{candidato.full_name}</p><p className="text-xs text-muted-foreground">{email}</p><Badge variant="secondary" className="mt-2">Conta localizada</Badge></div>}
            <div className="space-y-2"><Label>Papel na Secretaria</Label><Select value={papelId} onValueChange={setPapelId}><SelectTrigger><SelectValue placeholder="Selecione o papel"/></SelectTrigger><SelectContent>{papeis.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogoAberto(false)} disabled={vinculando}>Cancelar</Button><Button onClick={() => void vincularConta()} disabled={!candidato || !papelId || vinculando}>{vinculando ? <Loader2 className="h-4 w-4 animate-spin"/> : <UserCheck className="h-4 w-4"/>} Confirmar vínculo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
