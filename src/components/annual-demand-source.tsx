import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { bancoNaoConfigurado, db } from "@/lib/db";

export function AnnualDemandSource({
  tenantId,
  processId,
}: {
  tenantId: string;
  processId: string;
}) {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: ["annual-demand-source", session?.user.id, tenantId, processId],
    enabled: Boolean(session?.user.id && tenantId && processId),
    queryFn: async () => {
      const { data, error } = await db
        .from("annual_procurement_demands")
        .select("plan_year,title,justification,items,requesting_unit,responsible_name")
        .eq("tenant_id", tenantId)
        .eq("process_id", processId)
        .maybeSingle();
      if (error && !bancoNaoConfigurado(error.message)) throw new Error(error.message);
      return data;
    },
  });
  if (query.isError) return <p role="alert">Falha ao consultar a demanda de origem.</p>;
  if (!query.data) return null;
  const { plan_year, title, justification, items, requesting_unit, responsible_name } = query.data;
  return (
    <section aria-label="Demanda de origem do PCA" className="space-y-1 rounded border p-3 text-sm">
      <h3 className="font-semibold">Demanda de origem do PCA · {plan_year}</h3>
      <p className="font-medium">{title}</p>
      {(requesting_unit || responsible_name) && (
        <p className="text-xs text-muted-foreground">
          {requesting_unit ? `Unidade: ${requesting_unit}` : ""}
          {requesting_unit && responsible_name ? " · " : ""}
          {responsible_name ? `Responsável: ${responsible_name}` : ""}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{justification}</p>
      <ul className="list-inside list-disc text-xs">
        {Array.isArray(items) &&
          items.map(
            (item, index) =>
              item &&
              typeof item === "object" &&
              !Array.isArray(item) && (
                <li key={index}>
                  {String((item as Record<string, unknown>)["description"])} —{" "}
                  {String((item as Record<string, unknown>)["quantity"])}{" "}
                  {String((item as Record<string, unknown>)["unit"])}
                </li>
              ),
          )}
      </ul>
    </section>
  );
}
