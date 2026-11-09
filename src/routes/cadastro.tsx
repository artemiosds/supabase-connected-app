import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/cadastro")({
  head: () => ({
    meta: [
      { title: "Criar conta — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Crie sua conta na plataforma de gestão de fornecedores para a saúde.",
      },
      { property: "og:title", content: "Criar conta — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Crie sua conta na plataforma de gestão de fornecedores para a saúde.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cadastro,
});

function Cadastro() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacaoPendente, setConfirmacaoPendente] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const resultado = await signUp(email.trim(), senha, nome.trim());
    setEnviando(false);
    if (resultado.error) {
      setErro(resultado.error);
      return;
    }
    if (resultado.precisaConfirmarEmail) {
      setConfirmacaoPendente(true);
      return;
    }
    navigate({ to: "/painel" });
  }

  if (confirmacaoPendente) {
    return (
      <AuthShell
        title="Verifique seu e-mail"
        subtitle="Enviamos um link de confirmação para o e-mail informado."
      >
        <div className="flex items-start gap-3 rounded-md bg-primary/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-foreground">
            Confirme seu cadastro acessando o link enviado a <strong>{email}</strong>. Depois, faça
            login normalmente.
          </p>
        </div>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link to="/entrar">Ir para o login</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar conta" subtitle="Cadastre-se para acessar a plataforma.">
      <form onSubmit={aoEnviar} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome completo</Label>
          <Input
            id="nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Maria Souza"
          />
        </div>
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
            autoComplete="new-password"
            required
            minLength={6}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres.</p>
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
          Criar conta
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link to="/entrar" className="text-primary underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
