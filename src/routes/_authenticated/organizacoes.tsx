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
      const { data, error } = await db
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!ativo) return;
      setIsPlatformAdmin(!error && data?.user_id === session.user.id);
      setVerificandoPermissao(false);
    }

    void verificarPermissao().catch(() => {
      if (!ativo) return;
      setIsPlatformAdmin(false);
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
      if (!aberto || !isPlatformAdmin) return;

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
            "Nao foi possivel carregar os usuarios cadastrados.",
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
        error instanceof Error ? error.message : "Nao foi possivel carregar os usuarios.",
      );
      setAdministradores([]);
      setAdminUserId("");
      setCarregandoAdministradores(false);
    });

    return () => {
      ativo = false;
    };
  }, [aberto, isPlatformAdmin]);

  async function aoCriar(e: FormEvent) {
    e.preventDefault();
    setErroCriacao(null);

    if (!adminUserId) {
      setErroCriacao("Selecione um usuario cadastrado para administrar esta organizacao.");
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
            "A estrutura da Fase 1 ainda nao foi implantada. A migracao precisa ser aprovada antes de criar organizacoes.",
          );
        } else {
          setErroCriacao(error.message);
        }
        return;
      }

      toast.success("Organizacao criada com sucesso.");
      setAberto(false);
      setNome("");
      setSlug("");
      setAdminUserId("");
      recarregar();
    } catch (error) {
      setErroCriacao(
        error instanceof Error ? error.message : "Nao foi possivel criar a organizacao.",
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
                  Escolha um usuario ja cadastrado para ser o administrador municipal. O
                  superadministrador global nao sera incluido como membro desta organizacao.
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
                            ? "Carregando usuarios..."
                            : "Selecione um usuario cadastrado"
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
                        Nenhum usuario disponivel. Cadastre o futuro administrador e abra esta tela
                        novamente.
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
                      ? "Nenhuma organizacao ainda. Crie a primeira para comecar."
                      : "Voce ainda nao possui uma organizacao vinculada."}
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
                              : "Situacao desconhecida"}
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
