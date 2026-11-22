import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { precoUnitarioComFrete } from "@/lib/pesquisa-precos";
import { calculateItemTotal } from "@/lib/procurement-items-parser";
import {
  filterEligibleProcessItems,
  importUnitPrice,
  mapProcurementItemsToContractPayload,
  type ProcessImportItem,
} from "@/lib/contract-items-import";
import { formatarMoeda } from "@/lib/contratacao";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Props = {
  contractId: string;
  processId: string;
  tenantId: string;
  userId: string;
  onSaved: () => Promise<void>;
};
async function loadImport({ contractId, processId, tenantId }: Props) {
  const contract = await db
    .from("contracts")
    .select("id,process_id,supplier_id,total_value,status")
    .eq("tenant_id", tenantId)
    .eq("id", contractId)
    .single();
  if (
    contract.error ||
    !contract.data ||
    contract.data.process_id !== processId ||
    contract.data.status !== "vigente"
  )
    throw new Error("Instrumento vigente vinculado ao processo indisponível.");
  const contractData = contract.data;
  const parent = await db
    .from("procurement_processes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", processId)
    .single();
  if (parent.error || !parent.data) throw new Error("Processo indisponível nesta Secretaria.");
  const [items, existing, quotes] = await Promise.all([
    carregarTodasAsPaginas((start, end) =>
      db
        .from("procurement_items")
        .select(
          "id,line_number,description,technical_specification,unit,quantity,estimated_unit_price,estimated_price_source,is_active",
        )
        .eq("tenant_id", tenantId)
        .eq("process_id", processId)
        .eq("is_active", true)
        .order("line_number")
        .order("id")
        .range(start, end),
    ),
    carregarTodasAsPaginas((start, end) =>
      db
        .from("contract_items")
        .select("id,line_number,description,specification,notes,total_value")
        .eq("tenant_id", tenantId)
        .eq("contract_id", contractId)
        .order("line_number")
        .order("id")
        .range(start, end),
    ),
    carregarTodasAsPaginas((start, end) =>
      db
        .from("procurement_price_quotes")
        .select("id,procurement_item_id,supplier_id,quantity,unit_price,delivery_cost,total_price")
        .eq("tenant_id", tenantId)
        .eq("contract_id", contractId)
        .eq("is_active", true)
        .order("id")
        .range(start, end),
    ),
  ]);
  const processItems: ProcessImportItem[] = items.map((item) => {
    const matches = quotes.filter(
      (q) =>
        q.procurement_item_id === item.id &&
        q.supplier_id !== null &&
        q.supplier_id === contractData.supplier_id,
    );
    const price = matches.length === 1 ? precoUnitarioComFrete(matches[0]!) : null;
    return price !== null ? { ...item, linked_unit_price: price } : item;
  });
  return {
    ...filterEligibleProcessItems(processItems, existing),
    existing,
    limit: contract.data.total_value,
  };
}
export function ContractItemsImport(props: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () =>
    scope.current.tenant === props.tenantId && scope.current.user === props.userId;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof loadImport>> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const chosen = preview?.eligible.filter((item) => selected.includes(item.id)) ?? [];
  const total = chosen.reduce(
    (sum, item) => sum + calculateItemTotal(item.quantity, importUnitPrice(item)!),
    0,
  );
  const currentTotal =
    preview?.existing.reduce((sum, item) => sum + (item.total_value ?? 0), 0) ?? 0;
  const tooHigh =
    !!preview && Math.round((total + currentTotal) * 100) > Math.round(preview.limit * 100);
  async function start() {
    if (!inScope() || lock.current) return;
    setOpen(true);
    setBusy(true);
    setPreview(null);
    setSelected([]);
    setConfirmed(false);
    setError("");
    try {
      const result = await loadImport(props);
      if (inScope()) {
        setPreview(result);
        setSelected(result.eligible.map((item) => item.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao consultar itens.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (lock.current || !inScope() || !confirmed || !chosen.length || tooHigh) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const access = await db.rpc("get_document_capabilities", { p_tenant_id: props.tenantId });
      if (access.error || !access.data?.[0]?.can_update)
        throw new Error("Seu perfil não permite alterar itens do contrato.");
      const latest = await loadImport(props);
      const fresh = latest.eligible.filter((item) => selected.includes(item.id));
      if (
        fresh.length !== chosen.length ||
        fresh.some(
          (item) =>
            JSON.stringify(item) !== JSON.stringify(chosen.find((old) => old.id === item.id)),
        ) ||
        latest.limit !== preview?.limit ||
        JSON.stringify(latest.existing) !== JSON.stringify(preview?.existing)
      ) {
        setPreview(latest);
        setSelected(fresh.map((item) => item.id));
        setConfirmed(false);
        throw new Error(
          "Os itens ou o instrumento mudaram. Confira a nova prévia antes de confirmar.",
        );
      }
      const last = latest.existing.reduce((max, item) => Math.max(max, item.line_number), 0);
      const payload = mapProcurementItemsToContractPayload(
        fresh,
        props.contractId,
        props.tenantId,
        props.userId,
        last,
      );
      if (!inScope()) return;
      const result = await db.from("contract_items").insert(payload);
      if (result.error) throw new Error(result.error.message);
      setOpen(false);
      toast.success(payload.length + " itens importados para o saldo.");
      if (inScope()) await props.onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha na importação. Confira o saldo antes de repetir.",
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) setOpen(v);
      }}
    >
      <Button type="button" variant="outline" size="sm" onClick={() => void start()}>
        <Download className="h-4 w-4" />
        Puxar itens do processo
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar Itens do Processo Homologado</DialogTitle>
          <DialogDescription>
            Confira quantidades e preços com o contrato ou ata formalizado. Preços de referência e
            estimativas aprovadas exigem conferência com os valores contratados.
          </DialogDescription>
        </DialogHeader>
        {busy && !preview && <p role="status">Carregando itens do processo…</p>}
        {preview && (
          <>
            <p className="text-sm">
              {preview.eligible.length} disponíveis · {preview.alreadyImported.length} já presentes
              ou repetidos · {preview.unavailable.length} sem preço elegível
            </p>
            <div className="max-h-80 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr>
                    {[
                      "Selecionar",
                      "Item",
                      "Quantidade / unidade",
                      "Preço unitário",
                      "Origem",
                      "Subtotal",
                    ].map((h) => (
                      <th key={h} className="p-2 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.eligible.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={"Selecionar item " + item.line_number}
                          checked={selected.includes(item.id)}
                          disabled={busy}
                          onChange={(e) => {
                            setConfirmed(false);
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, item.id]
                                : old.filter((id) => id !== item.id),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-40 p-2">
                        {item.line_number}. {item.description}
                        <p className="text-xs text-muted-foreground">
                          {item.technical_specification}
                        </p>
                      </td>
                      <td className="p-2">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {formatarMoeda(importUnitPrice(item))}
                      </td>
                      <td className="p-2">
                        {item.linked_unit_price !== undefined
                          ? "Cotação de referência vinculada"
                          : "Estimativa aprovada"}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {formatarMoeda(calculateItemTotal(item.quantity, importUnitPrice(item)!))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.alreadyImported.length > 0 && (
              <p className="text-sm text-amber-700">
                Itens existentes ou repetidos foram excluídos para evitar duplicidade.
              </p>
            )}
            {preview.unavailable.length > 0 && (
              <p className="text-sm">
                Itens sem estimativa aprovada ou cotação vinculada válida:{" "}
                {preview.unavailable.map((i) => i.description).join(", ")}.
              </p>
            )}
            <p className="font-semibold">
              {chosen.length} selecionados · {formatarMoeda(total)} a importar
            </p>
            <p className="text-sm">
              Total após importação: {formatarMoeda(currentTotal + total)} · Limite:{" "}
              {formatarMoeda(preview.limit)}
            </p>
            {tooHigh && (
              <p role="alert" className="text-destructive">
                O total excede o valor do instrumento. Desmarque os itens que não fazem parte deste
                contrato.
              </p>
            )}
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              Conferi os itens, quantidades e preços com o instrumento formalizado.
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button
            disabled={busy || !confirmed || !chosen.length || tooHigh}
            onClick={() => void save()}
          >
            {busy ? "Aguarde…" : "Confirmar Importação de " + chosen.length + " Itens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
