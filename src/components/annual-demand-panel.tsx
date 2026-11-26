import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { MODALIDADES } from "@/lib/contratacao";
import type { Json } from "@/integrations/supabase/types";

type Props = { tenantId: string; onConverted: () => Promise<void> };

type AnnualDemandRow = {
  id: string;
  title: string;
  justification: string;
  approved_at: string | null;
  process_id: string | null;
  items: Json;
  review_status: string;
  rejection_reason: string | null;
  requesting_unit: string | null;
};

export function AnnualDemandPanel(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border bg-card p-4">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        Plano de Contratações Anual
      </Button>
      {open && <AnnualDemands {...props} />}
    </section>
  );
}

function AnnualDemands({ tenantId, onConverted }: Props) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([crypto.randomUUID()]);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const query = useQuery({
    queryKey: ["annual-demands", session?.user.id, tenantId, year],
    enabled: Boolean(session?.user.id && tenantId),
    queryFn: async () => {
      const [demands, capabilities] = await Promise.all([
        carregarTodasAsPaginas<AnnualDemandRow>((from, to) =>
          db
            .from("annual_procurement_demands")
            .select(
              "id,title,justification,approved_at,process_id,items,review_status,rejection_reason,requesting_unit",
            )
            .eq("tenant_id", tenantId)
            .eq("plan_year", year)
            .order("submitted_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
        db.rpc("annual_demand_capabilities", { p_tenant_id: tenantId }),
      ]);
      if (capabilities.error) throw new Error(capabilities.error.message);
      return { demands, capabilities: capabilities.data?.[0] };
    },
    retry: false,
  });

  async function save(action: string, id: string, data: Json) {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setBusy(true);
    try {
      const result = await db.rpc("manage_annual_demand", {
        p_tenant_id: tenantId,
        p_action: action,
        p_id: id,
        p_data: data,
      });
      if (result.error) throw new Error(result.error.message);
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ["annual-demand-source"] });
      if (action === "convert") await onConverted();
      toast.success(
        action === "convert"
          ? "Processo criado com os itens do PCA."
          : action === "approve"
            ? "Demanda aprovada."
            : "Demanda enviada para aprovação.",
      );
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gravar a demanda.");
      return false;
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const items = rows.map((key) => {
      const unitPriceRaw = String(values.get("unit_price-" + key) || "").trim();
      return {
        description: String(values.get("description-" + key) || "").trim(),
        unit: String(values.get("unit-" + key) || "").trim(),
        quantity: Number(values.get("quantity-" + key)) || 0,
        ...(unitPriceRaw !== "" ? { estimated_unit_price: Number(unitPriceRaw) } : {}),
      };
    });
    if (
      await save("submit", crypto.randomUUID(), {
        year,
        title: String(values.get("title") || "").trim(),
        justification: String(values.get("justification") || "").trim(),
        requesting_unit: String(values.get("requesting_unit") || "").trim(),
        items,
      })
    ) {
      form.reset();
      setRows([crypto.randomUUID()]);
    }
  }

  const permissions = query.data?.capabilities;
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm">
          Exercício
          <select
            className="ml-2 rounded border p-2 text-sm"
            value={year}
            disabled={busy}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <Link to="/pca" className="text-xs font-medium text-primary underline">
          Abrir painel completo do PCA
        </Link>
      </div>
      {query.isPending && <p role="status">Carregando demandas…</p>}
      {query.isError && (
        <p role="alert">
          {bancoNaoConfigurado(query.error.message)
            ? "PCA pendente de implantação nesta base."
            : "Falha ao consultar o PCA."}
          <Button variant="link" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </p>
      )}
      {permissions?.can_create && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Objeto da demanda *
              <Input name="title" required minLength={3} maxLength={300} />
            </label>
            <label className="block text-sm">
              Unidade requisitante
              <Input name="requesting_unit" maxLength={180} placeholder="Ex: Farmácia Central" />
            </label>
          </div>
          <label className="block text-sm">
            Justificativa *
            <Input name="justification" required minLength={3} maxLength={5000} />
          </label>
          {rows.map((key, i) => (
            <fieldset key={key} className="grid gap-2 rounded border p-3 sm:grid-cols-4">
              <legend className="text-xs font-medium">Item {i + 1}</legend>
              <label className="text-xs sm:col-span-2">
                Descrição *
                <Input name={"description-" + key} required minLength={3} maxLength={500} />
              </label>
              <label className="text-xs">
                Unidade *
                <Input name={"unit-" + key} required minLength={1} maxLength={30} />
              </label>
              <label className="text-xs">
                Quantidade *
                <Input
                  name={"quantity-" + key}
                  type="number"
                  required
                  min="0.0001"
                  step="0.0001"
                  max="9999999999.9999"
                />
              </label>
              <label className="text-xs">
                Valor unit. est. (opcional)
                <Input
                  name={"unit_price-" + key}
                  type="number"
                  min="0"
                  step="0.0001"
                  max="9999999999"
                />
              </label>
              {rows.length > 1 && (
                <div className="flex items-end sm:col-span-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRows(rows.filter((row) => row !== key))}
                  >
                    Remover item
                  </Button>
                </div>
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || rows.length >= 200}
              onClick={() => setRows([...rows, crypto.randomUUID()])}
            >
              Adicionar item
            </Button>
            <Button disabled={busy}>Enviar demanda para aprovação</Button>
          </div>
        </form>
      )}
      {query.isSuccess && !query.data.demands.length && <p>Nenhuma demanda neste exercício.</p>}
      {query.data?.demands.map((demand) => {
        const isCancelled = demand.review_status === "cancelled";
        const isRejected = demand.review_status === "rejected";
        return (
          <article key={demand.id} className="space-y-2 rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{demand.title}</h3>
              <span className="text-xs text-muted-foreground">
                {demand.process_id
                  ? "Processo vinculado"
                  : isCancelled
                    ? "Cancelada"
                    : isRejected
                      ? "Devolvida para ajuste"
                      : demand.approved_at
                        ? "Demanda aprovada"
                        : "Aguardando aprovação"}
              </span>
            </div>
            {demand.requesting_unit && (
              <p className="text-xs text-muted-foreground">Unidade: {demand.requesting_unit}</p>
            )}
            <p className="text-sm">{demand.justification}</p>
            {isRejected && demand.rejection_reason && (
              <p className="text-xs text-destructive">Motivo da devolução: {demand.rejection_reason}</p>
            )}
            <ul className="list-inside list-disc text-sm">
              {Array.isArray(demand.items) &&
                demand.items.map(
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
            {!demand.approved_at && !isCancelled && permissions?.can_approve && (
              <Button disabled={busy} onClick={() => void save("approve", demand.id, {})}>
                Aprovar demanda
              </Button>
            )}
            {demand.approved_at && !demand.process_id && !isCancelled && permissions?.can_create && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const number = String(data.get("number") || "").trim();
                  const modality = String(data.get("modality") || "");
                  if (!number || !modality) {
                    toast.error("Informe o número e a modalidade do processo.");
                    return;
                  }
                  void save("convert", demand.id, { number, modality });
                }}
              >
                <label className="text-xs">
                  Número do processo
                  <Input name="number" required minLength={1} maxLength={60} />
                </label>
                <label className="text-xs">
                  Modalidade
                  <select
                    className="block rounded border p-2 text-sm"
                    name="modality"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {Object.entries(MODALIDADES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={busy}>Criar processo desta demanda</Button>
              </form>
            )}
            {demand.process_id && (
              <Link
                className="text-sm text-primary underline"
                to="/documentos"
                search={{ tipo: "dfd", processo: demand.process_id } as never}
              >
                Abrir DFD do processo
              </Link>
            )}
          </article>
        );
      })}
    </div>
  );
}
