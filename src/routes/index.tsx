import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { SiteHome } from "@/components/site-home";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gestão pública da saúde, em um só lugar" },
      {
        name: "description",
        content:
          "Organize fornecedores, documentos, prazos e processos de contratação da Secretaria de Saúde em um ambiente único.",
      },
      { property: "og:title", content: "Gestão pública da saúde, em um só lugar" },
      {
        property: "og:description",
        content:
          "Fornecedores, documentos, prazos e processos de contratação organizados por Secretaria.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !session) return;
    navigate({ to: "/painel", replace: true });
  }, [loading, session, navigate]);

  if (loading || session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return <SiteHome />;
}
