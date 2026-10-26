import { createFileRoute } from "@tanstack/react-router";
import { Building2, FileText, Loader2, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Visão geral da sua organização na plataforma de gestão de fornecedores.",
      },
      { property: "og:title", content: "Painel — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Visão geral da sua organização na plataforma de gestão de fornecedores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Painel,
});

function Painel() {
  const { session } = useAuth();
  const { tenants, selecionado, loading, bancoPendente, erro } = useTenant();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Painel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {selecionado
            ? `Organização selecionada: ${selecionado.nome}`
            : `Bem-vindo(a), ${session?.user.email}.`}
        </p>
      </div>

      {bancoPendente && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-foreground">
              Estrutura do banco de dados ainda não aplicada
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              A migração inicial da plataforma (organizações, usuários, permissões e auditoria)
              aguarda sua aprovação. Enquanto isso, esta página mostra apenas o essencial.
            </p>
          </CardContent>
        </Card>
      )}
      {erro && !bancoPendente && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Erro ao carregar dados: {erro}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Minhas organizações
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{tenants.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Usuários</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">
              {selecionado ? (
                <span className="text-base font-normal text-muted-foreground">Ver em Usuários</span>
              ) : (
                "—"
              )}
            </p>
          </CardContent>
        </Card>
        <Card className="opacity-60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fornecedores</CardTitle>
            <Badge variant="secondary">Fase 2</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Disponível em uma etapa futura.</p>
          </CardContent>
        </Card>
        <Card className="opacity-60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Documentos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Badge variant="secondary">Fase 2</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Disponível em uma etapa futura.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
