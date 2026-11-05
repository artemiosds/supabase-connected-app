import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/recuperar-senha")({
  head: () => ({
    meta: [
      { title: "Recuperar senha — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Recupere o acesso à sua conta na plataforma de gestão de fornecedores.",
      },
      { property: "og:title", content: "Recuperar senha — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Recupere o acesso à sua conta na plataforma de gestão de fornecedores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecuperarSenha,
});

function RecuperarSenha() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const erroEnvio = await requestPasswordReset(email.trim());
    setEnviando(false);
    if (erroEnvio) {
      setErro(erroEnvio);
      return;
    }
    setEnviado(true);
  }

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Informe seu e-mail para receber o link de redefinição."
    >
      {enviado ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md bg-primary/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="text-foreground">
              Se existir uma conta para <strong>{email}</strong>, você receberá um e-mail com o link
              para definir uma nova senha.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/entrar">Voltar ao login</Link>
          </Button>
        </div>
      ) : (
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
            Enviar link de redefinição
          </Button>
          <p className="text-center text-sm">
            <Link to="/entrar" className="text-primary underline-offset-4 hover:underline">
              Voltar ao login
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
