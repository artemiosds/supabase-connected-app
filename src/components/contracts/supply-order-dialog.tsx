import { useRef, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { calcularSaldoDisponivel } from "@/lib/contract-item-balance";
import { validateSupplyOrder, type SupplyOrderItemCandidate } from "@/lib/supply-order-helper";
import { formatarMoeda } from "@/lib/contratacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Props = {
  tenantId: string;
  contractId: string;
  userId: string;
  enabled: boolean;
  items: Omit<SupplyOrderItemCandidate, "requestedQuantity">[];
  onSuccess: () => Promise<void>;
};
const quantityFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
type Outcome = {
  description: string;
  status: "Registrado" | "Não enviado" | "Conferir histórico";
  message?: string;
};

export function SupplyOrderDialog({
  tenantId,
  contractId,
  userId,
  enabled,
  items,
  onSuccess,
}: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () =>
    Boolean(userId) && scope.current.tenant === tenantId && scope.current.user === userId;
  const [open, setOpen] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const candidates = items.map((item) => ({
    ...item,
    requestedQuantity: values[item.itemId]?.trim()
      ? Number(values[item.itemId]!.replace(",", "."))
      : 0,
  }));
  const result = validateSupplyOrder({ referenceNumber, reason }, candidates);
  const frozen = busy || attempted;
  function start() {
    setReferenceNumber("");
    setReason("");
    setValues({});
    setOutcomes([]);
    setAttempted(false);
    setError("");
    setOpen(true);
  }
  async function submit() {
    if (lock.current || attempted || !enabled || !result.isValid || !inScope()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const order = result.itemsToConsume;
    const reference = referenceNumber.trim();
    const motive = reason.trim();
    const results: Outcome[] = order.map((item) => ({
      description: items.find((row) => row.itemId === item.itemId)?.description ?? item.itemId,
      status: "Não enviado",
    }));
    let submitted = false;
    try {
      const permission = await db.rpc("get_document_capabilities", { p_tenant_id: tenantId });
      if (permission.error || !permission.data?.[0]?.can_update)
        throw new Error("Seu perfil não permite registrar consumo.");
      const contract = await db
        .from("contracts")
        .select("status,end_date")
        .eq("tenant_id", tenantId)
        .eq("id", contractId)
        .single();
      if (
        contract.error ||
        contract.data.status !== "vigente" ||
        contract.data.end_date < new Date().toLocaleDateString("sv-SE")
      )
        throw new Error("Instrumento indisponível ou fora da vigência.");
      const fresh = await carregarTodasAsPaginas((from, to) =>
        db
          .from("contract_items")
          .select("id,quantity_total,unit_value")
          .eq("tenant_id", tenantId)
          .eq("contract_id", contractId)
          .order("id")
          .range(from, to),
      );
      for (const item of order) {
        const current = fresh.find((row) => row.id === item.itemId);
        if (!current || current.unit_value !== item.unitValue)
          throw new Error(
            "Os itens ou valores foram alterados. Atualize o saldo antes de continuar.",
          );
        const history = await carregarTodasAsPaginas((from, to) =>
          db
            .from("contract_item_movements")
            .select("movement_type,quantity,reference_number")
            .eq("tenant_id", tenantId)
            .eq("contract_item_id", item.itemId)
            .order("id")
            .range(from, to),
        );
        if (
          history.some(
            (row) =>
              row.movement_type === "consumption" &&
              row.reference_number?.trim().toLocaleLowerCase("pt-BR") ===
                reference.toLocaleLowerCase("pt-BR"),
          )
        )
          throw new Error(
            "A referência já consta no histórico de um item solicitado. Confira a OF antes de reenviar.",
          );
        if (calcularSaldoDisponivel(current.quantity_total, history) < item.quantity)
          throw new Error(
            "O saldo de " +
              (items.find((row) => row.itemId === item.itemId)?.description ?? "um item") +
              " mudou. Atualize a consulta.",
          );
      }
      for (const [index, item] of order.entries()) {
        if (!inScope()) throw new Error("A Secretaria ou a sessão mudou durante a operação.");
        submitted = true;
        setAttempted(true);
        try {
          const response = await db.rpc("record_contract_item_consumption", {
            p_tenant_id: tenantId,
            p_contract_item_id: item.itemId,
            p_quantity: item.quantity,
            p_reason: motive,
            p_reference_number: reference,
          });
          if (response.error || !response.data)
            throw new Error(response.error?.message ?? "Resposta sem confirmação.");
          results[index] = { description: results[index]!.description, status: "Registrado" };
          setOutcomes([...results]);
        } catch (e) {
          results[index] = {
            description: results[index]!.description,
            status: "Conferir histórico",
            message: e instanceof Error ? e.message : "Resposta incerta.",
          };
          throw e;
        }
      }
      toast.success("Ordem de fornecimento " + reference + " registrada com sucesso!");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a ordem.");
      if (submitted) {
        setOutcomes([...results]);
        toast.warning(
          "Ordem interrompida. Confira os resultados e o histórico antes de novo envio.",
        );
      }
    } finally {
      if (inScope()) {
        try {
          await onSuccess();
        } catch {
          setError(
            "Não foi possível atualizar o saldo. Reabra o instrumento para conferir o histórico.",
          );
        }
      }
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <Button
        variant="outline"
        type="button"
        size="sm"
        disabled={!enabled || !items.some((item) => item.availableQuantity > 0) || !userId}
        onClick={start}
      >
        <ClipboardList className="h-4 w-4" />
        Emitir Ordem de Fornecimento
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Emitir Ordem de Fornecimento</DialogTitle>
          <DialogDescription>
            Registre os consumos da ordem com a mesma referência e motivo. Cada baixa é validada
            individualmente no banco.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label>
            Nº da OF / Empenho
            <Input
              maxLength={120}
              disabled={frozen}
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Ex: OF nº 005/2026 - NE 2026NE00189"
            />
          </Label>
          <Label>
            Destino / Motivo do Fornecimento
            <Textarea
              minLength={10}
              maxLength={1000}
              disabled={frozen}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Abastecimento regular do Hospital Municipal - Requisição nº 45/2026"
            />
          </Label>
        </div>
        <div className="max-h-80 overflow-auto rounded border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr>
                {[
                  "Item / Descrição",
                  "Unidade",
                  "Saldo Disponível",
                  "Preço Unitário",
                  "Qtd. a Solicitar",
                  "Subtotal (R$)",
                  "Ações",
                ].map((h) => (
                  <th scope="col" key={h} className="p-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.itemId} className="border-t">
                  <th scope="row" className="min-w-40 p-2 text-left">
                    {item.description}
                  </th>
                  <td className="p-2">{item.unit}</td>
                  <td className="p-2">{quantityFormat.format(item.availableQuantity)}</td>
                  <td className="p-2 whitespace-nowrap">{formatarMoeda(item.unitValue)}</td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min="0"
                      max={item.availableQuantity}
                      step="0.0001"
                      className="min-w-24"
                      aria-label={"Quantidade a solicitar — " + item.description}
                      value={values[item.itemId] ?? ""}
                      disabled={frozen || item.availableQuantity <= 0}
                      onChange={(e) =>
                        setValues((old) => ({ ...old, [item.itemId]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {formatarMoeda(
                      result.itemsToConsume.find((row) => row.itemId === item.itemId)?.subtotal ??
                        0,
                    )}
                  </td>
                  <td className="p-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={frozen || item.availableQuantity <= 0}
                      aria-label={"Solicitar todo saldo — " + item.description}
                      onClick={() =>
                        setValues((old) => ({
                          ...old,
                          [item.itemId]: String(item.availableQuantity),
                        }))
                      }
                    >
                      Solicitar todo saldo
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-between gap-2 font-semibold">
          <span>
            Itens na ordem: {result.totalItemsCount} de {items.length}
          </span>
          <span>Valor Total da Ordem: {formatarMoeda(result.totalValue)}</span>
        </div>
        {!attempted &&
          result.errors.map((message, index) => (
            <p className="text-sm text-destructive" key={index}>
              {message}
            </p>
          ))}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {outcomes.length > 0 && (
          <section aria-label="Resultado da ordem" className="space-y-1 rounded border p-3">
            {outcomes.map((item, index) => (
              <p key={index}>
                {item.description}: {item.status}
                {item.message ? " — " + item.message : ""}
              </p>
            ))}
          </section>
        )}
        {attempted && (
          <p role="status">
            Confira o histórico de todos os itens antes de emitir outra ordem. Os consumos
            confirmados permanecem registrados.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            disabled={frozen || !enabled || !result.isValid}
            onClick={() => void submit()}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Confirmar Ordem de Fornecimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
