import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cadastro")({
  head: () => ({
    meta: [
      { title: "Acesso por convite — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "O acesso à plataforma é liberado por convite do administrador da Secretaria.",
      },
    ],
  }),
  component: Cadastro,
});

function Cadastro() {
  return (
    <AuthShell
      title="Acesso por convite"
      subtitle="As contas são criadas pelo administrador responsável de cada Secretaria."
    >
      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        Para acessar a plataforma, solicite ao administrador da sua Secretaria que envie um
        convite para o seu e-mail. Depois, use o link recebido para definir sua senha e ativar
        o acesso.
      </p>
      <Button asChild variant="outline" className="mt-4 w-full">
        <Link to="/entrar">Voltar para o login</Link>
      </Button>
    </AuthShell>
  );
}
