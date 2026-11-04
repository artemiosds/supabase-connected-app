import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/organizacoes")({
  head: () => ({
    meta: [
      { title: "Organizações — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Organizações às quais você tem acesso na plataforma.",
      },
      { property: "og:title", content: "Organizações — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Organizações às quais você tem acesso na plataforma.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Organizacoes,
});

function gerarSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

type PerfilAdministrador = {
  id: string;
  full_name: string;
};

function Organizacoes() {
  const { session } = useAuth();
  const { tenants, loading, bancoPendente, erro, selecionado, selecionar, recarregar } =
    useTenant();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [administradores, setAdministradores] = useState<PerfilAdministrador[]>([]);
  const [carregandoAdministradores, setCarregandoAdministradores] = useState(false);
  const [erroAdministradores, setErroAdministradores] = useState<string | null>(null);
  const [verificandoPermissao, setVerificandoPermissao] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [erroPermissao, setErroPermissao] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);

  // A criacao de organizacoes e exclusiva do superadministrador global ativo.
  useEffect(() => {
    let ativo = true;

    async function verificarPermissao() {
      if (loading) return;
      if (!session?.user.id || bancoPendente) {
        setIsPlatformAdmin(false);
        setVerificandoPermissao(false);
        return;
      }

      setVerificandoPermissao(true);
      setErroPermissao(null);
      const { data, error } = await db
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!ativo) return;
      if (error) setErroPermissao(error.message);
      setIsPlatformAdmin(!error && data?.user_id === session.user.id);
      setVerificandoPermissao(false);
    }

    void verificarPermissao().catch((error: unknown) => {
      if (!ativo) return;
      setIsPlatformAdmin(false);
      setErroPermissao(error instanceof Error ? error.message : "Não foi possível verificar a permissão global.");
      setVerificandoPermissao(false);
    });

    return () => {
      ativo = false;
    };
  }, [session?.user.id, bancoPendente, loading]);

  // O administrador municipal deve ser um usuario cadastrado e nao pode ser superadmin global.
  useEffect(() => {
    let ativo = true;

    async function carregarAdministradores() {
      if (!isPlatformAdmin) {
        setAdministradores([]);
        setAdminUserId("");
        setCarregandoAdministradores(false);
        return;
      }

      setCarregandoAdministradores(true);
      setErroAdministradores(null);

      const [perfisResult, adminsGlobaisResult] = await Promise.all([
        db.from("profiles").select("id, full_name").order("full_name", { ascending: true }),
        db.from("platform_admins").select("user_id"),
      ]);

      if (!ativo) return;

      if (perfisResult.error || adminsGlobaisResult.error) {
        setAdministradores([]);
        setAdminUserId("");
        setErroAdministradores(
          perfisResult.error?.message ??
            adminsGlobaisResult.error?.message ??
            "Não foi possível carregar os usuários cadastrados.",
        );
      } else {
        const idsAdministradoresGlobais = new Set(
          (adminsGlobaisResult.data ?? []).map((admin) => admin.user_id),
        );
        const disponiveis = (perfisResult.data ?? []).filter(
          (perfil) => !idsAdministradoresGlobais.has(perfil.id),
        );
        setAdministradores(disponiveis);
        setAdminUserId((atual) =>
          disponiveis.some((perfil) => perfil.id === atual) ? atual : (disponiveis[0]?.id ?? ""),
        );
      }

      setCarregandoAdministradores(false);
    }

    void carregarAdministradores().catch((error: unknown) => {
      if (!ativo) return;
      setErroAdministradores(
        error instanceof Error ? error.message : "Não foi possível carregar os usuários.",
      );
      setAdministradores([]);
      setAdminUserId("");
      setCarregandoAdministradores(false);
    });

    return () => {
      ativo = false;
    };
  }, [isPlatformAdmin]);

  async function aoCriar(e: FormEvent) {
    e.preventDefault();
    setErroCriacao(null);

    if (!adminUserId) {
      setErroCriacao("Selecione um usuário cadastrado para administrar esta organização.");
      return;
    }

    setCriando(true);
    try {
      const { error } = await db.rpc("create_tenant_with_admin", {
        p_name: nome.trim(),
        p_slug: slug.trim(),
        p_admin_user_id: adminUserId,
      });

      if (error) {
        if (bancoNaoConfigurado(error.message)) {
          setErroCriacao(
            "A estrutura da Fase 1 ainda não foi implantada. A migração precisa ser aprovada antes de criar organizações.",
          );
        } else {
          setErroCriacao(error.message);
        }
        return;
      }

      toast.success("Organização criada com sucesso.");
      setAberto(false);
      setNome("");
      setSlug("");
      setAdminUserId("");
      recarregar();
    } catch (error) {
      setErroCriacao(
        error instanceof Error ? error.message : "Não foi possível criar a organização.",
      );
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organizacoes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organizacoes as quais voce tem acesso.
          </p>
        </div>
        {isPlatformAdmin && !verificandoPermissao && (
          <Dialog open={aberto} onOpenChange={setAberto}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" aria-hidden />
                Nova organizacao
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova organizacao</DialogTitle>
                <DialogDescription>
                  Escolha uma segunda conta já cadastrada para ser o administrador municipal. A conta global não será membro desta Secretaria.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={aoCriar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nome-org">Nome</Label>
                  <Input
                    id="nome-org"
                    required
                    minLength={3}
                    maxLength={160}
                    value={nome}
                    onChange={(e) => {
                      setNome(e.target.value);
                      setSlug(gerarSlug(e.target.value));
                    }}
                    placeholder="Ex.: Secretaria Municipal de Saude de Exemplo"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug-org">Identificador amigavel</Label>
                  <Input
                    id="slug-org"
                    required
                    minLength={3}
                    maxLength={63}
                    value={slug}
                    onChange={(e) => setSlug(gerarSlug(e.target.value))}
                    placeholder="ex.: sms-exemplo"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-org">Administrador municipal</Label>
                  <Select
                    value={adminUserId}
                    onValueChange={setAdminUserId}
                    disabled={carregandoAdministradores || administradores.length === 0}
                  >
                    <SelectTrigger id="admin-org">
                      <SelectValue
                        placeholder={
                          carregandoAdministradores
                            ? "Carregando usuários..."
                            : "Selecione um usuário cadastrado"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {administradores.map((perfil) => (
                        <SelectItem key={perfil.id} value={perfil.id}>
                          {perfil.full_name} · {perfil.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    O usuario precisa ter uma conta criada antes de ser selecionado.
                  </p>
                  {administradores.length === 0 &&
                    !carregandoAdministradores &&
                    !erroAdministradores && (
                      <p className="text-xs text-muted-foreground">
                        Nenhum usuário municipal disponível. Crie outra conta pela tela pública de cadastro, em uma janela anônima ou outro navegador, confirme o e-mail e atualize esta página.
                      </p>
                    )}
                </div>
                {erroAdministradores && (
                  <Alert variant="destructive">
                    <AlertDescription>{erroAdministradores}</AlertDescription>
                  </Alert>
                )}
                {erroCriacao && (
                  <Alert variant="destructive">
                    <AlertDescription>{erroCriacao}</AlertDescription>
                  </Alert>
                )}
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={
                      criando ||
                      carregandoAdministradores ||
                      !adminUserId ||
                      !!erroAdministradores
                    }
                  >
                    {criando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Criar organizacao
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!verificandoPermissao && !isPlatformAdmin && (
        <Alert variant="destructive">
          <AlertTitle>Esta conta não está reconhecida como administradora global</AlertTitle>
          <AlertDescription>
            {erroPermissao
              ? `Não foi possível consultar sua permissão no banco: ${erroPermissao}`
              : `O login atual (${session?.user.email ?? "sem e-mail"}) não possui a autorização de administrador global no Supabase SMS2. Saia da aplicação e entre com a conta global cadastrada.`}
            O acesso ao editor do Lovable não substitui o usuário de acesso da aplicação.
          </AlertDescription>
          <div className="mt-3"><Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>Verificar novamente</Button></div>
        </Alert>
      )}

      {isPlatformAdmin && !carregandoAdministradores && administradores.length === 0 && (
        <Alert>
          <AlertTitle>Falta cadastrar o primeiro administrador municipal</AlertTitle>
          <AlertDescription>
            Sua conta global está reconhecida. No momento não existe outra conta de usuário para
            receber a administração da Secretaria. Abra uma janela anônima ou outro navegador,
            acesse a tela de cadastro público, crie uma segunda conta com outro e-mail, confirme
            esse e-mail e depois volte aqui e atualize a página. A conta global não pode ser
            selecionada como administrador municipal.
          </AlertDescription>
          <div className="mt-3"><Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>Atualizar lista de usuários</Button></div>
        </Alert>
      )}

      {bancoPendente && (
        <Alert variant="destructive">
          <AlertTitle>Estrutura do banco nao aplicada</AlertTitle>
          <AlertDescription>
            A estrutura inicial da Fase 1 (organizacoes, vinculos, permissoes e auditoria) aguarda
            aprovacao e implantacao controlada no banco. Enquanto isso, esta lista ficara vazia.
          </AlertDescription>
        </Alert>
      )}
      {erro && !bancoPendente && (
        <Alert variant="destructive">
          <AlertTitle>Erro ao carregar organizacoes</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {!bancoPendente && !erro && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden sm:table-cell">Identificador</TableHead>
                <TableHead>Situacao</TableHead>
                <TableHead className="text-right">Acao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                  </TableCell>
                </TableRow>
              ) : tenants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    {isPlatformAdmin
                      ? "Nenhuma organização ainda. Crie a primeira para começar."
                      : "Você ainda não possui uma organização vinculada."}
                  </TableCell>
                </TableRow>
              ) : (
                tenants.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium text-foreground">{t.nome}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {t.slug}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={t.status === "active" ? "secondary" : "outline"}
                        className={
                          t.status === "active"
                            ? ""
                            : "border-muted-foreground/40 text-muted-foreground"
                        }
                      >
                        {t.status === "active"
                          ? "Ativa"
                          : t.status === "suspended"
                            ? "Suspensa"
                            : t.status === "closed"
                              ? "Encerrada"
                              : "Situação desconhecida"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {selecionado?.id === t.id ? (
                        <span className="text-sm text-muted-foreground">Selecionada</span>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => selecionar(t.id)}>
                          Selecionar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
