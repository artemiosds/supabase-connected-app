import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Usuários vinculados à organização selecionada e seus papéis.",
      },
      { property: "og:title", content: "Usuários — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Usuários vinculados à organização selecionada e seus papéis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Usuarios,
});

type Membro = {
  id: string;
  status: string;
  profiles?: { display_name: string } | null;
  membership_roles?: { tenant_roles?: { name: string } }[];
};

function Usuarios() {
  const { selecionado, bancoPendente } = useTenant();
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [bancoAusente, setBancoAusente] = useState(false);

  const carregar = useCallback(async () => {
    if (!selecionado) {
      setMembros([]);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await db
        .from("tenant_memberships")
        .select("id, status, profiles(display_name), membership_roles(tenant_roles(name))")
        .eq("tenant_id", selecionado.id);
      if (error) throw error;
      setMembros((data ?? []) as unknown as Membro[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (bancoNaoConfigurado(msg)) {
        setBancoAusente(true);
      } else {
        setErro(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [selecionado]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (bancoPendente || bancoAusente) {
    return (
      <div className="space-y-6">
        <Cabecalho />
        <Alert variant="destructive">
          <AlertTitle>Estrutura do banco não aplicada</AlertTitle>
          <AlertDescription>
            A migração inicial da Fase 1 precisa ser aprovada e executada antes de listar e
            gerenciar usuários.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!selecionado) {
    return (
      <div className="space-y-6">
        <Cabecalho />
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Selecione uma organização no topo para ver seus usuários.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Cabecalho organizacao={selecionado.nome} />
      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Erro ao carregar usuários</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Papéis</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                </TableCell>
              </TableRow>
            ) : membros.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum usuário vinculado a esta organização ainda.
                </TableCell>
              </TableRow>
            ) : (
              membros.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-foreground">
                    {m.profiles?.display_name || "—"}
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
                    <Badge
                      variant={m.status === "ativo" ? "secondary" : "outline"}
                      className={
                        m.status === "ativo"
                          ? ""
                          : "border-muted-foreground/40 text-muted-foreground"
                      }
                    >
                      {m.status === "ativo" ? "Ativo" : m.status === "suspenso" ? "Suspenso" : "Revogado"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Cabecalho({ organizacao }: { organizacao?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Usuários</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {organizacao
          ? `Pessoas vinculadas a ${organizacao} e seus papéis.`
          : "Pessoas vinculadas à organização selecionada e seus papéis."}
      </p>
    </div>
  );
}
