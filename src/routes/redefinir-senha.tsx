import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Defina uma nova senha para sua conta na plataforma de gestão de fornecedores.",
      },
      { property: "og:title", content: "Redefinir senha — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Defina uma nova senha para sua conta na plataforma de gestão de fornecedores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RedefinirSenha,
});

function RedefinirSenha() {
  const { session, loading, updatePassword } = useAuth();
  const convite = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("convite") === "1";
  const navigate = useNavigate();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha !== confirmacao) {
      setErro("As senhas não coincidem.");
      return;
    }
    setEnviando(true);
    const erroAtualizacao = await updatePassword(senha);
    setEnviando(false);
    if (erroAtualizacao) {
      setErro(erroAtualizacao);
      return;
    }
    toast.success("Senha atualizada com sucesso.");
    navigate({ to: "/painel" });
  }

  if (loading) {
    return (
      <AuthShell
        title={convite ? "Definir senha do convite" : "Redefinir senha"}
        subtitle="Verificando seu link seguro…"
      >
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </AuthShell>
    );
  }

  if (!session) {
    return (
      <AuthShell
        title="Link inválido"
        subtitle={convite
          ? "Este convite expirou ou já foi utilizado. Solicite um novo convite à Secretaria."
          : "Este link de redefinição expirou ou já foi usado."}
      >
        <Button asChild className="w-full">
          <Link to="/recuperar-senha">Solicitar novo link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={convite ? "Crie sua senha de acesso" : "Redefinir senha"}
      subtitle={convite
        ? "Seu e-mail foi confirmado. Defina uma senha para concluir o acesso à Secretaria."
        : "Defina a nova senha da sua conta."}
    >
      <form onSubmit={aoEnviar} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="senha">Nova senha</Label>
          <Input
            id="senha"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmacao">Confirmar nova senha</Label>
          <Input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
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
          {convite ? "Definir senha e continuar" : "Salvar nova senha"}
        </Button>
      </form>
    </AuthShell>
  );
}
