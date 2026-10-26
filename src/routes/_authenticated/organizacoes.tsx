import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
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

function Organizacoes() {
  const { tenants, loading, bancoPendente, erro, selecionado, selecionar, recarregar } =
    useTenant();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [criando, setCriando] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);

  async function aoCriar(e: FormEvent) {
    e.preventDefault();
    setErroCriacao(null);
    setCriando(true);
    const { error } = await db.rpc("create_tenant_with_admin", {
      p_nome: nome.trim(),
      p_slug: slug.trim(),
    });
    setCriando(false);
    if (error) {
      if (bancoNaoConfigurado(error.message)) {
        setErroCriacao(
          "A estrutura do banco de dados ainda não foi aplicada. A migração da Fase 1 precisa ser aprovada e executada antes de criar organizações.",
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
    recarregar();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organizações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organizações às quais você tem acesso.
          </p>
        </div>
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              Nova organização
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova organização</DialogTitle>
              <DialogDescription>
                Você será o administrador desta organização. O identificador amigável é usado em
                endereços e não pode ser alterado depois.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={aoCriar} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nome-org">Nome</Label>
                <Input
                  id="nome-org"
                  required
                  minLength={2}
                  maxLength={120}
                  value={nome}
                  onChange={(e) => {
                    setNome(e.target.value);
                    setSlug(gerarSlug(e.target.value));
                  }}
                  placeholder="Ex.: Secretaria Municipal de Saúde de Exemplo"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug-org">Identificador amigável</Label>
                <Input
                  id="slug-org"
                  required
                  minLength={3}
                  maxLength={60}
                  value={slug}
                  onChange={(e) => setSlug(gerarSlug(e.target.value))}
                  placeholder="ex.: sms-exemplo"
                />
              </div>
              {erroCriacao && (
                <Alert variant="destructive">
                  <AlertDescription>{erroCriacao}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="submit" disabled={criando}>
                  {criando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Criar organização
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {bancoPendente && (
        <Alert variant="destructive">
          <AlertTitle>Estrutura do banco não aplicada</AlertTitle>
          <AlertDescription>
            A migração inicial da Fase 1 (organizações, vínculos, permissões e auditoria) aguarda
            sua aprovação no editor. Enquanto ela não for executada, esta lista ficará vazia.
          </AlertDescription>
        </Alert>
      )}
      {erro && !bancoPendente && (
        <Alert variant="destructive">
          <AlertTitle>Erro ao carregar organizações</AlertTitle>
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
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ação</TableHead>
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
                    Nenhuma organização ainda. Crie a primeira para começar.
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
                        variant={t.status === "ativa" ? "secondary" : "outline"}
                        className={
                          t.status === "ativa"
                            ? ""
                            : "border-muted-foreground/40 text-muted-foreground"
                        }
                      >
                        {t.status === "ativa"
                          ? "Ativa"
                          : t.status === "suspensa"
                            ? "Suspensa"
                            : "Encerrada"}
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
