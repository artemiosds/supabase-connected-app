import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { carregarTodasAsPaginas, db, bancoNaoConfigurado } from "@/lib/db";
import { MODALIDADES } from "@/lib/contratacao";
import type { Json } from "@/integrations/supabase/types";

type Props = { tenantId: string; onConverted: () => Promise<void> };

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
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([crypto.randomUUID()]);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["annual-demands", session?.user.id, tenantId, year],
    queryFn: async () => {
      const [demands, capabilities] = await Promise.all([
        carregarTodasAsPaginas((from, to) => db.from("annual_procurement_demands")
          .select("id,title,justification,approved_at,process_id,items")
          .eq("tenant_id", tenantId).eq("plan_year", year)
          .order("submitted_at", { ascending: false }).order("id").range(from, to)),
        db.rpc("annual_demand_capabilities", { p_tenant_id: tenantId }),
      ]);
      if (capabilities.error) throw new Error(capabilities.error.message);
      return { demands, capabilities: capabilities.data?.[0] };
    },
    retry: false,
  });

  async function save(action: string, id: string, data: Json) {
    setBusy(true);
    try {
      const result = await db.rpc("manage_annual_demand", {
        p_tenant_id: tenantId, p_action: action, p_id: id, p_data: data,
      });
      if (result.error) throw new Error(result.error.message);
      await query.refetch();
      if (action === "convert") await onConverted();
      toast.success(action === "convert" ? "Processo criado com os itens do PCA." :
        action === "approve" ? "Demanda aprovada." : "Demanda enviada para aprovação.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gravar a demanda.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const items = rows.map(key => ({
      description: String(values.get("description-" + key)), unit: String(values.get("unit-" + key)),
      quantity: Number(values.get("quantity-" + key)),
    }));
    if (await save("submit", crypto.randomUUID(), {
      year, title: String(values.get("title")), justification: String(values.get("justification")), items,
    })) {
      form.reset();
      setRows([crypto.randomUUID()]);
    }
  }

  const permissions = query.data?.capabilities;
  return (
    <div className="mt-4 space-y-4">
      <label>Exercício
        <select className="ml-2 rounded border p-2" value={year} disabled={busy}
          onChange={e => setYear(Number(e.target.value))}>
          {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i)
            .map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      {query.isPending && <p role="status">Carregando demandas…</p>}
      {query.isError && <p role="alert">{bancoNaoConfigurado(query.error.message)
        ? "PCA pendente de implantação nesta base." : "Falha ao consultar o PCA."}
        <Button variant="link" onClick={() => void query.refetch()}>Tentar novamente</Button></p>}
      {permissions?.can_create && <form onSubmit={submit} className="space-y-3">
        <label className="block">Objeto da demanda<Input name="title" required minLength={3} maxLength={300} /></label>
        <label className="block">Justificativa<Input name="justification" required minLength={3} maxLength={5000} /></label>
        {rows.map((key, i) => <fieldset key={key} className="grid gap-2 rounded border p-3 sm:grid-cols-3">
          <legend>Item {i + 1}</legend>
          <label>Descrição<Input name={"description-" + key} required minLength={3} maxLength={500} /></label>
          <label>Unidade<Input name={"unit-" + key} required maxLength={30} /></label>
          <label>Quantidade<Input name={"quantity-" + key} type="number" required min="0.0001" step="0.0001" max="9999999999.9999" /></label>
          {rows.length > 1 && <Button type="button" variant="ghost" onClick={() => setRows(rows.filter(row => row !== key))}>Remover item</Button>}
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || rows.length >= 200} onClick={() => setRows([...rows, crypto.randomUUID()])}>Adicionar item</Button>
          <Button disabled={busy}>Enviar demanda para aprovação</Button>
        </div>
      </form>}
      {query.isSuccess && !query.data.demands.length && <p>Nenhuma demanda neste exercício.</p>}
      {query.data?.demands.map(demand => <article key={demand.id} className="space-y-2 rounded border p-3">
        <h3 className="font-semibold">{demand.title}</h3>
        <p>{demand.justification}</p>
        <ul className="list-inside list-disc text-sm">{Array.isArray(demand.items) && demand.items.map((item, index) =>
          item && typeof item === "object" && !Array.isArray(item) &&
          <li key={index}>{String(item.description)} — {String(item.quantity)} {String(item.unit)}</li>)}</ul>
        <p>{demand.process_id ? "Processo vinculado" : demand.approved_at ? "Demanda aprovada" : "Aguardando aprovação"}</p>
        {!demand.approved_at && permissions?.can_approve && <Button disabled={busy}
          onClick={() => void save("approve", demand.id, {})}>Aprovar demanda</Button>}
        {demand.approved_at && !demand.process_id && permissions?.can_create &&
          <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void save("convert", demand.id, { number: String(data.get("number")), modality: String(data.get("modality")) });
          }}>
            <label>Número do processo<Input name="number" required maxLength={60} /></label>
            <label>Modalidade<select className="block rounded border p-2" name="modality" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {Object.entries(MODALIDADES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <Button disabled={busy}>Criar processo desta demanda</Button>
          </form>}
        {demand.process_id && <a className="text-primary underline" href={"/documentos?tipo=dfd&processo=" + demand.process_id}>Abrir DFD do processo</a>}
      </article>)}
    </div>
  );
}
