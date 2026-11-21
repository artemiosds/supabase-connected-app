import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { monitorSupplierDocuments } from "@/lib/supplier-document-monitor";
import { Badge } from "@/components/ui/badge";
const labels = {
  valid: "Válido",
  expiring: "A vencer (até 30 dias)",
  expired: "Vencido",
  missing: "Ausente",
  review: "Conferir validade",
};
export function SupplierDocumentMonitor({
  tenantId,
  supplierId,
  category,
}: {
  tenantId: string;
  supplierId: string;
  category: string;
}) {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: ["supplier-document-monitor", session?.user.id, tenantId, supplierId],
    queryFn: () =>
      carregarTodasAsPaginas((from, to) =>
        db
          .from("supplier_documents")
          .select("id,title,document_type,expires_at,status")
          .eq("tenant_id", tenantId)
          .eq("supplier_id", supplierId)
          .order("id")
          .range(from, to),
      ),
    retry: false,
  });
  if (query.isPending) return <p role="status">Conferindo documentos…</p>;
  if (query.isError)
    return (
      <p role="alert">
        Não foi possível conferir os documentos. Reabra a ficha para tentar novamente.
      </p>
    );
  const requirements = monitorSupplierDocuments(query.data, category);
  const alert = requirements.some((r) => !r.sanitary && ["expired", "missing"].includes(r.status));
  return (
    <section aria-label="Pendências documentais" className="space-y-3 rounded border p-3">
      <h3 className="font-semibold">Conferência documental</h3>
      <p className="text-xs text-muted-foreground">
        Matriz de referência para revisão pelo responsável conforme atividade, objeto e edital. O
        cadastro do arquivo depende de conferência de autenticidade, abrangência e validade.
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(labels).map(([status, label]) => (
          <Badge key={status} variant="outline">
            {requirements.filter((r) => r.status === status).length} {label}
          </Badge>
        ))}
      </div>
      {alert && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-950">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          Há certidões fiscais ausentes ou vencidas. Solicite regularização antes da análise de
          habilitação.
        </p>
      )}
      <ul className="space-y-2">
        {requirements.map((r) => (
          <li key={r.type} className="text-sm">
            <span className="font-medium">{r.label}</span>
            {r.sanitary && " · confirmar aplicabilidade"} — {labels[r.status]}
            {["missing", "expired", "review"].includes(r.status) && (
              <p className="text-xs text-muted-foreground">
                {r.status === "review"
                  ? "Conferir vigência no órgão emissor."
                  : "Solicitar documento atualizado."}{" "}
                Prazo sugerido: antes da decisão de habilitação, conforme o prazo do processo.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
