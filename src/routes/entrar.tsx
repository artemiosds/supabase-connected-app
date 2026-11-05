import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/entrar")({
  head: () => ({
    meta: [
      { title: "Entrar — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Acesse sua conta na plataforma de gestão de fornecedores para a saúde.",
      },
      { property: "og:title", content: "Entrar — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Acesse sua conta na plataforma de gestão de fornecedores para a saúde.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Entrar,
});

function Entrar() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const erroLogin = await signIn(email.trim(), senha);
    setEnviando(false);
    if (erroLogin) {
      setErro(erroLogin);
      return;
    }
    navigate({ to: "/painel" });
  }

  return (
    <AuthShell title="Entrar" subtitle="Acesse sua conta para continuar.">
      <form onSubmit={aoEnviar} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@orgao.gov.br"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <Input
            id="senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>
        {erro && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Entrar
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link to="/recuperar-senha" className="text-primary underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
        <Link to="/cadastro" className="text-muted-foreground underline-offset-4 hover:underline">
          Criar conta
        </Link>
      </div>
    </AuthShell>
  );
}
