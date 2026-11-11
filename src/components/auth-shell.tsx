import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthShell({
  title,
  subtitle,
  children,
  returnTo,
  returnLabel,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  returnTo?: "/" | "/entrar" | "/recuperar-senha";
  returnLabel?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4 py-10">
      <div className="w-full max-w-md">
        {returnTo && (
          <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
            <Link to={returnTo}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              {returnLabel ?? "Voltar"}
            </Link>
          </Button>
        )}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HeartPulse className="h-6 w-6" aria-hidden />
          </div>
          <div className="leading-tight">
            <p className="text-lg font-semibold text-foreground">Gestão de Fornecedores</p>
            <p className="text-sm text-muted-foreground">da Saúde</p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
