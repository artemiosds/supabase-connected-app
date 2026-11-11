import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, RotateCcw, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/db";
import { calcularQuantidadeConsumida, calcularSaldoDisponivel } from "@/lib/contract-item-balance";

type Contract = {
  id: string;
  number: string;
  total_value: number;
  status: string;
  end_date: string;
};

type Item = {
  id: string;
  line_number: number;
  description: string;
  specification: string | null;
  unit: string;
  quantity_total: number;
  unit_value: number;
  total_value: number;
};

type Movement = {
  id: string;
  contract_item_id: string;
  movement_type: string;
  quantity: number;
  unit_value_snapshot: number;
  reason: string;
  reference_number: string | null;
  reverses_movement_id: string | null;
  created_at: string;
};

type ItemForm = {
  description: string;
  specification: string;
  unit: string;
  quantity_total: string;
  unit_value: string;
};

type ConsumptionForm = {
  quantity: string;
  reason: string;
  reference_number: string;
};

const EMPTY_ITEM: ItemForm = {
  description: "",
  specification: "",
  unit: "",
  quantity_total: "",
  unit_value: "",
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

function numero(input: string): number {
  return Number(input.trim().replace(",", "."));
}

export function ContractItemsBalance(props: {
  contract: Contract;
  tenantId: string;
  userId: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);
  const [consumptionItemId, setConsumptionItemId] = useState<string | null>(null);
  const [consumptionForm, setConsumptionForm] = useState<ConsumptionForm>({
    quantity: "",
    reason: "",
    reference_number: "",
  });
  const [reversalReasons, setReversalReasons] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const { data: itemRows, error: itemError } = await db
      .from("contract_items")
      .select("id,line_number,description,specification,unit,quantity_total,unit_value,total_value")
      .eq("tenant_id", props.tenantId)
      .eq("contract_id", props.contract.id)
      .order("line_number")
      .order("id");
    if (itemError) {
      setErro(itemError.message);
      setItems([]);
      setMovements([]);
      setLoading(false);
      return;
    }
    const nextItems = itemRows ?? [];
    setItems(nextItems);
    if (nextItems.length === 0) {
      setMovements([]);
      setLoading(false);
      return;
    }
    const { data: movementRows, error: movementError } = await db
      .from("contract_item_movements")
      .select(
        "id,contract_item_id,movement_type,quantity,unit_value_snapshot,reason,reference_number,reverses_movement_id,created_at",
      )
      .eq("tenant_id", props.tenantId)
      .in(
        "contract_item_id",
        nextItems.map((item) => item.id),
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (movementError) {
      setErro(movementError.message);
      setMovements([]);
    } else {
      setMovements(movementRows ?? []);
    }
    setLoading(false);
  }, [props.contract.id, props.tenantId]);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  const movementsByItem = useMemo(
    () =>
      movements.reduce<Record<string, Movement[]>>((grouped, movement) => {
        (grouped[movement.contract_item_id] ??= []).push(movement);
        return grouped;
      }, {}),
    [movements],
  );
  const itemTotal = items.reduce((total, item) => total + Number(item.total_value), 0);

  async function salvarItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.userId) {
      toast.error("Não foi possível identificar o usuário da sessão.");
      return;
    }
    const total = numero(itemForm.quantity_total);
    const unitValue = numero(itemForm.unit_value);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(unitValue) || unitValue < 0) {
      toast.error("Informe quantidade e valor unitário válidos.");
      return;
    }
    setSalvando(true);
    const { error: insertError } = await db.from("contract_items").insert({
      tenant_id: props.tenantId,
      contract_id: props.contract.id,
      line_number: items.reduce((max, item) => Math.max(max, item.line_number), 0) + 1,
      description: itemForm.description.trim(),
      specification: itemForm.specification.trim() || null,
      unit: itemForm.unit.trim(),
      quantity_total: total,
      unit_value: unitValue,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSalvando(false);
    if (insertError) {
      toast.error(insertError.message);
      return;
    }
    toast.success("Item incluído no contrato/ARP.");
    setItemForm(EMPTY_ITEM);
    setFormAberto(false);
    await carregar();
  }

  async function registrarConsumo(event: React.FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    const amount = numero(consumptionForm.quantity);
    if (!Number.isFinite(amount) || amount <= 0 || consumptionForm.reason.trim().length < 10) {
      toast.error(
        "Informe uma quantidade válida e uma justificativa com pelo menos 10 caracteres.",
      );
      return;
    }
    setSalvando(true);
    const { error: rpcError } = await db.rpc("record_contract_item_consumption", {
      p_tenant_id: props.tenantId,
      p_contract_item_id: item.id,
      p_quantity: amount,
      p_reason: consumptionForm.reason.trim(),
      ...(consumptionForm.reference_number.trim()
        ? { p_reference_number: consumptionForm.reference_number.trim() }
        : {}),
    });
    setSalvando(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Consumo registrado no histórico imutável.");
    setConsumptionItemId(null);
    setConsumptionForm({ quantity: "", reason: "", reference_number: "" });
    await carregar();
  }

  async function estornar(movement: Movement) {
    const reason = reversalReasons[movement.id]?.trim() ?? "";
    if (reason.length < 10) {
      toast.error("Informe uma justificativa de estorno com pelo menos 10 caracteres.");
      return;
    }
    setSalvando(true);
    const { error: rpcError } = await db.rpc("reverse_contract_item_consumption", {
      p_tenant_id: props.tenantId,
      p_movement_id: movement.id,
      p_reason: reason,
    });
    setSalvando(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Estorno registrado sem apagar o consumo original.");
    setReversalReasons((current) => ({ ...current, [movement.id]: "" }));
    await carregar();
  }

  return (
    <section className="rounded-lg border p-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={aberto}
        onClick={() => setAberto((value) => !value)}
      >
        <ShoppingCart className="h-4 w-4" />
        Itens e saldo{" "}
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>
      {aberto && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">Itens de {props.contract.number}</h3>
              <p className="text-xs text-muted-foreground">
                Total dos itens: {currency.format(itemTotal)} · Limite do instrumento:{" "}
                {currency.format(Number(props.contract.total_value))}
              </p>
            </div>
            <Button type="button" size="sm" onClick={() => setFormAberto((value) => !value)}>
              <Plus className="h-4 w-4" /> Adicionar item
            </Button>
          </div>

          {formAberto && (
            <form
              onSubmit={salvarItem}
              className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2"
            >
              <div className="sm:col-span-2">
                <Label htmlFor={`item-description-${props.contract.id}`}>Descrição do item *</Label>
                <Input
                  id={`item-description-${props.contract.id}`}
                  required
                  minLength={3}
                  maxLength={500}
                  value={itemForm.description}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor={`item-unit-${props.contract.id}`}>Unidade *</Label>
                <Input
                  id={`item-unit-${props.contract.id}`}
                  required
                  maxLength={40}
                  placeholder="unidade, caixa, frasco"
                  value={itemForm.unit}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      unit: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor={`item-spec-${props.contract.id}`}>Especificação</Label>
                <Input
                  id={`item-spec-${props.contract.id}`}
                  maxLength={4000}
                  value={itemForm.specification}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      specification: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor={`item-qty-${props.contract.id}`}>Quantidade total *</Label>
                <Input
                  id={`item-qty-${props.contract.id}`}
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  required
                  value={itemForm.quantity_total}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      quantity_total: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor={`item-price-${props.contract.id}`}>Valor unitário (R$) *</Label>
                <Input
                  id={`item-price-${props.contract.id}`}
                  type="number"
                  min="0"
                  step="0.0001"
                  required
                  value={itemForm.unit_value}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      unit_value: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={salvando}>
                  {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar item
                </Button>
                <Button type="button" variant="outline" onClick={() => setFormAberto(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {erro && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive"
            >
              <span>Não foi possível carregar itens e movimentações: {erro}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void carregar()}>
                Tentar novamente
              </Button>
            </div>
          )}
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum item cadastrado neste instrumento.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const itemMovements = movementsByItem[item.id] ?? [];
                const used = calcularQuantidadeConsumida(itemMovements);
                const available = calcularSaldoDisponivel(
                  Number(item.quantity_total),
                  itemMovements,
                );
                const reversedIds = new Set(
                  itemMovements
                    .filter((movement) => movement.movement_type === "reversal")
                    .map((movement) => movement.reverses_movement_id),
                );
                return (
                  <article key={item.id} className="space-y-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {item.line_number}. {item.description}
                        </p>
                        {item.specification && (
                          <p className="text-xs text-muted-foreground">{item.specification}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {quantity.format(Number(item.quantity_total))} {item.unit} ×{" "}
                          {currency.format(Number(item.unit_value))} · Total{" "}
                          {currency.format(Number(item.total_value))}
                        </p>
                      </div>
                      <Badge variant={available > 0 ? "secondary" : "destructive"}>
                        Saldo: {quantity.format(available)} {item.unit}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Consumido: {quantity.format(used)} {item.unit}
                    </p>
                    {consumptionItemId === item.id ? (
                      <form
                        onSubmit={(event) => void registrarConsumo(event, item)}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        <div>
                          <Label htmlFor={`consume-qty-${item.id}`}>Quantidade a consumir *</Label>
                          <Input
                            id={`consume-qty-${item.id}`}
                            type="number"
                            min="0.0001"
                            max={available}
                            step="0.0001"
                            required
                            value={consumptionForm.quantity}
                            onChange={(event) =>
                              setConsumptionForm((current) => ({
                                ...current,
                                quantity: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`consume-ref-${item.id}`}>Referência (opcional)</Label>
                          <Input
                            id={`consume-ref-${item.id}`}
                            maxLength={120}
                            value={consumptionForm.reference_number}
                            onChange={(event) =>
                              setConsumptionForm((current) => ({
                                ...current,
                                reference_number: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Label htmlFor={`consume-reason-${item.id}`}>Motivo do consumo *</Label>
                          <Input
                            id={`consume-reason-${item.id}`}
                            required
                            minLength={10}
                            maxLength={1000}
                            value={consumptionForm.reason}
                            onChange={(event) =>
                              setConsumptionForm((current) => ({
                                ...current,
                                reason: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="flex gap-2 sm:col-span-2">
                          <Button
                            type="submit"
                            disabled={salvando || props.contract.status !== "vigente"}
                          >
                            <ShoppingCart className="h-4 w-4" /> Registrar consumo
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setConsumptionItemId(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          salvando ||
                          available <= 0 ||
                          props.contract.status !== "vigente" ||
                          props.contract.end_date < new Date().toISOString().slice(0, 10)
                        }
                        onClick={() => setConsumptionItemId(item.id)}
                      >
                        <ShoppingCart className="h-4 w-4" /> Registrar consumo
                      </Button>
                    )}
                    {itemMovements.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-medium">
                          Histórico de movimentações ({itemMovements.length})
                        </summary>
                        <ol className="mt-2 space-y-3">
                          {itemMovements.map((movement) => (
                            <li key={movement.id} className="border-l-2 border-primary/30 pl-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant={
                                    movement.movement_type === "reversal" ? "outline" : "secondary"
                                  }
                                >
                                  {movement.movement_type === "reversal" ? "Estorno" : "Consumo"}
                                </Badge>
                                <span>
                                  {quantity.format(Number(movement.quantity))} {item.unit}
                                </span>
                                <span className="text-muted-foreground">
                                  {new Date(movement.created_at).toLocaleString("pt-BR")}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {movement.reason}
                                {movement.reference_number
                                  ? ` · Referência: ${movement.reference_number}`
                                  : ""}
                              </p>
                              {movement.movement_type === "consumption" &&
                                !reversedIds.has(movement.id) && (
                                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                    <Input
                                      aria-label={`Justificativa para estornar consumo de ${quantity.format(Number(movement.quantity))} ${item.unit}`}
                                      minLength={10}
                                      maxLength={1000}
                                      placeholder="Justificativa do estorno (mínimo 10 caracteres)"
                                      value={reversalReasons[movement.id] ?? ""}
                                      onChange={(event) =>
                                        setReversalReasons((current) => ({
                                          ...current,
                                          [movement.id]: event.target.value,
                                        }))
                                      }
                                    />
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={
                                        salvando ||
                                        (reversalReasons[movement.id]?.trim().length ?? 0) < 10
                                      }
                                      onClick={() => void estornar(movement)}
                                    >
                                      <RotateCcw className="h-4 w-4" /> Estornar
                                    </Button>
                                  </div>
                                )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
