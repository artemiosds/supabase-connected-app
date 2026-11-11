import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PortalEntrada = "master" | "secretaria" | "suporte";

function parsePortalEntrada(value: unknown): PortalEntrada | undefined {
  if (value === "master" || value === "secretaria" || value === "suporte") return value;
  return undefined;
}

const PORTAL_TEXTO: Record<PortalEntrada, { title: string; subtitle: string }> = {
  master: {
    title: "Acesse o Painel Master",
    subtitle: "Entre com a conta autorizada para administrar a plataforma.",
  },
  secretaria: {
    title: "Acesse o Portal da Secretaria",
    subtitle: "Entre com a conta vinculada à sua organização.",
  },
  suporte: {
    title: "Acesse a Central de Suporte",
    subtitle: "Entre com a conta técnica autorizada para atendimento.",
  },
};

export const Route = createFileRoute("/entrar")({
  validateSearch: (search: Record<string, unknown>) => {
    const portal = parsePortalEntrada(search["portal"]);
    return portal ? { portal } : {};
  },
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
  const { portal } = Route.useSearch();
  const { signIn, session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/painel", replace: true });
    }
  }, [loading, session, navigate]);

  const convitePendente =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("convite") === "1";

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
    if (portal === "master") {
      navigate({ to: "/admin-master" });
      return;
    }
    if (portal === "suporte") {
      navigate({ to: "/suporte" });
      return;
    }
    navigate({ to: "/painel" });
  }

  const textoPortal = portal ? PORTAL_TEXTO[portal] : null;

  return (
    <AuthShell
      title={textoPortal?.title ?? "Entrar"}
      subtitle={
        convitePendente
          ? "Entre com sua conta ou abra o convite recebido para concluir a ativação."
          : (textoPortal?.subtitle ?? "Acesse sua conta para continuar.")
      }
      returnTo="/"
      returnLabel="Voltar ao início"
    >
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
