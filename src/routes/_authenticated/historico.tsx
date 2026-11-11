import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Loader2, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({ meta: [{ title: "Histórico e auditoria — Gestão de Fornecedores da Saúde" }] }),
  component: Historico,
});

type Evento = Pick<
  Tables<"audit_events">,
  "id" | "action" | "actor_id" | "created_at" | "details" | "entity" | "entity_id"
>;

function camposAlterados(details: unknown): string[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const fields = (details as { changed_fields?: unknown }).changed_fields;
  return Array.isArray(fields) ? fields.map(String) : [];
}

function rotuloEntidade(value: string) {
  const labels: Record<string, string> = {
    suppliers: "Fornecedor",
    supplier_documents: "Documento de fornecedor",
    document_templates: "Modelo de documento",
    generated_documents: "Documento gerado",
    tenant_memberships: "Vínculo de usuário",
    tenants: "Secretaria",
  };
  return labels[value] ?? value;
}

function Historico() {
  const { selecionado } = useTenant();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      if (!selecionado?.id) {
        setEventos([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setErro(null);
      const { data, error } = await db
        .from("audit_events")
        .select("id,action,actor_id,created_at,details,entity,entity_id")
        .eq("tenant_id", selecionado.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!ativo) return;
      if (error) {
        setErro(error.message);
        setEventos([]);
      } else setEventos(data ?? []);
      setLoading(false);
    }
    void carregar();
    return () => {
      ativo = false;
    };
  }, [selecionado?.id]);

  if (!selecionado)
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>O histórico é isolado por Secretaria.</AlertDescription>
      </Alert>
    );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Histórico e auditoria</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registros de alterações e operações de {selecionado.nome}.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Atividade recente{" "}
            <Badge variant="secondary">{eventos.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : erro ? (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível consultar o histórico</AlertTitle>
              <AlertDescription>
                {erro.includes("permission") || erro.includes("policy")
                  ? "Seu perfil não possui permissão de auditoria nesta Secretaria."
                  : erro}
              </AlertDescription>
            </Alert>
          ) : eventos.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Ainda não há eventos registrados.
            </div>
          ) : (
            <div className="divide-y">
              {eventos.map((e) => {
                const fields = camposAlterados(e.details);
                return (
                  <div
                    key={e.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {rotuloEntidade(e.entity)}{" "}
                        <span className="font-normal text-muted-foreground">
                          ·{" "}
                          {e.action === "INSERT"
                            ? "criado"
                            : e.action === "UPDATE"
                              ? "alterado"
                              : e.action.toLowerCase()}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Registro: {e.entity_id ?? "—"} · Ator: {e.actor_id ?? "Sistema"}
                      </p>
                      {fields.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Campos: {fields.join(", ")}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> A consulta respeita a permissão de auditoria e o
        isolamento da Secretaria no banco de dados.
      </p>
    </div>
  );
}
