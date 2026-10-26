import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Configurações da sua conta e da organização selecionada.",
      },
      { property: "og:title", content: "Configurações — Gestão de Fornecedores da Saúde" },
      {
        property: "og:description",
        content: "Configurações da sua conta e da organização selecionada.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  const { session } = useAuth();
  const { selecionado } = useTenant();
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const carregarPerfil = async () => {
      if (!session?.user.id) return;
      try {
        const { data, error } = await db
          .from("profiles")
          .select("display_name")
          .eq("id", session.user.id)
          .maybeSingle();
        if (error) throw error;
        if (ativo && data?.display_name) setNome(data.display_name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (ativo && bancoNaoConfigurado(msg)) {
          setAviso(
            "A estrutura do banco de dados ainda não foi aplicada: o nome do perfil não pode ser carregado ou salvo até a migração da Fase 1 ser executada.",
          );
        }
      }
    };
    void carregarPerfil();
    return () => {
      ativo = false;
    };
  }, [session?.user.id]);

  async function aoSalvarPerfil(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    setSalvando(true);
    const { error } = await db
      .from("profiles")
      .update({ display_name: nome.trim() })
      .eq("id", session!.user.id);
    setSalvando(false);
    if (error) {
      if (bancoNaoConfigurado(error.message)) {
        setAviso(
          "A estrutura do banco de dados ainda não foi aplicada: o nome do perfil não pode ser salvo até a migração da Fase 1 ser executada.",
        );
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success("Perfil atualizado.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sua conta e a organização selecionada.</p>
      </div>

      {aviso && (
        <Alert variant="destructive">
          <AlertTitle>Estrutura do banco não aplicada</AlertTitle>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perfil</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={aoSalvarPerfil} className="max-w-sm space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome-perfil">Nome de exibição</Label>
              <Input
                id="nome-perfil"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Como seu nome aparece na plataforma"
              />
            </div>
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Salvar
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-foreground">E-mail</p>
            <p className="text-muted-foreground">{session?.user.email}</p>
          </div>
          <Separator />
          <div>
            <p className="font-medium text-foreground">Organização selecionada</p>
            <p className="text-muted-foreground">{selecionado?.nome ?? "Nenhuma"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
