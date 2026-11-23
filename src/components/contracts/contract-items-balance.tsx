import { SupplyOrderDialog } from "@/components/contracts/supply-order-dialog";
import { StockReplenishmentDialog } from "@/components/contracts/stock-replenishment-dialog";
import { ContractItemsImport } from "@/components/contracts/contract-items-import";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import {
  calcularPercentualDisponivel,
  calcularQuantidadeConsumida,
  calcularSaldoDisponivel,
  classificarNivelSaldo,
  resumirAlertasSaldo,
} from "@/lib/contract-item-balance";
import { groupMovementsBySupplyOrder } from "@/lib/supply-order-history-helper";
import {
  buildContractDossierDocumentText,
  calcularResumoDossieContratual,
} from "@/lib/contract-dossier-pdf-helper";
import { filtrarItensCriticosParaReposicao } from "@/lib/stock-replenishment-helper";
import { buildSupplyOrderDocumentText } from "@/lib/supply-order-pdf-helper";
import { buildDocxFromText, docxToModel, renderPdf } from "@/lib/docx-engine";
import { carregarTimbradoSecretaria } from "@/lib/document-branding";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Contract = {
  id: string;
  number: string;
  total_value: number;
  status: string;
  end_date: string;
  process_id: string | null;
  object?: string | null;
  manager_user_id?: string | null;
  inspector_user_id?: string | null;
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
  autoOpen?: boolean;
}) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () =>
    Boolean(props.userId) &&
    scope.current.tenant === props.tenantId &&
    scope.current.user === props.userId;
  const [aberto, setAberto] = useState(false);
  const [dialogReposicaoAberto, setDialogReposicaoAberto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [itemEditandoId, setItemEditandoId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);
  const [consumptionItemId, setConsumptionItemId] = useState<string | null>(null);
  const [consumptionForm, setConsumptionForm] = useState<ConsumptionForm>({
    quantity: "",
    reason: "",
    reference_number: "",
  });
  const [reversalReasons, setReversalReasons] = useState<Record<string, string>>({});
  const [reprintingReference, setReprintingReference] = useState<string | null>(null);
  const [gerandoDossie, setGerandoDossie] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const itemRows = await carregarTodasAsPaginas((inicio, fim) =>
        db
          .from("contract_items")
          .select(
            "id,line_number,description,specification,unit,quantity_total,unit_value,total_value",
          )
          .eq("tenant_id", props.tenantId)
          .eq("contract_id", props.contract.id)
          .order("line_number")
          .order("id")
          .range(inicio, fim),
      );
      const nextItems: Item[] = (itemRows ?? []).map((row) => ({
        ...row,
        total_value: Number(row.total_value ?? row.quantity_total * row.unit_value),
      }));
      setItems(nextItems);
      if (nextItems.length === 0) {
        setMovements([]);
        setLoading(false);
        return;
      }
      const movementRows = await carregarTodasAsPaginas((inicio, fim) =>
        db
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
          .order("id", { ascending: false })
          .range(inicio, fim),
      );
      setMovements(movementRows);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o saldo.");
      setItems([]);
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, [props.contract.id, props.tenantId]);

  useEffect(() => {
    if (props.autoOpen) setAberto(true);
  }, [props.autoOpen]);

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
  const supplyOrders = useMemo(
    () =>
      groupMovementsBySupplyOrder(
        movements,
        items.map(({ id, line_number, description, unit }) => ({
          id,
          line_number,
          description,
          unit,
        })),
      ),
    [items, movements],
  );
  const alertasSaldo = useMemo(
    () =>
      resumirAlertasSaldo(
        items.map((item) => ({
          percentualDisponivel: calcularPercentualDisponivel(
            Number(item.quantity_total),
            movementsByItem[item.id] ?? [],
          ),
        })),
      ),
    [items, movementsByItem],
  );
  const itensCriticos = useMemo(
    () => filtrarItensCriticosParaReposicao(items, movementsByItem),
    [items, movementsByItem],
  );
  const podeIniciarReposicao =
    props.contract.status === "vigente" &&
    (props.contract.manager_user_id === props.userId ||
      props.contract.inspector_user_id === props.userId) &&
    Boolean(props.userId);
  const itemTotal = items.reduce((total, item) => total + Number(item.total_value), 0);
  const itemEditandoTemMovimentos =
    itemEditandoId !== null &&
    movements.some((movement) => movement.contract_item_id === itemEditandoId);

  async function reimprimirOrdem(order: (typeof supplyOrders)[number]) {
    if (reprintingReference || !inScope()) {
      if (!inScope()) toast.error("A Secretaria ou a sessão mudou. Reabra o instrumento.");
      return;
    }
    setReprintingReference(order.referenceNumber);
    try {
      const [tenantResult, contractResult] = await Promise.all([
        db.from("tenants").select("name").eq("id", props.tenantId).single(),
        db
          .from("contracts")
          .select("number,object,process_id,supplier_id,inspector_name")
          .eq("tenant_id", props.tenantId)
          .eq("id", props.contract.id)
          .single(),
      ]);
      if (tenantResult.error || !tenantResult.data?.name)
        throw new Error("Não foi possível confirmar a Secretaria do instrumento.");
      if (contractResult.error || !contractResult.data)
        throw new Error("Não foi possível carregar os dados do contrato ou da ata.");
      if (!contractResult.data.supplier_id)
        throw new Error("O contrato não possui fornecedor vinculado para identificar na OF.");

      const [supplierResult, processResult] = await Promise.all([
        db
          .from("suppliers")
          .select("legal_name,trade_name,cnpj")
          .eq("tenant_id", props.tenantId)
          .eq("id", contractResult.data.supplier_id)
          .single(),
        contractResult.data.process_id
          ? db
              .from("procurement_processes")
              .select("number")
              .eq("tenant_id", props.tenantId)
              .eq("id", contractResult.data.process_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (supplierResult.error || !supplierResult.data)
        throw new Error("Não foi possível confirmar o fornecedor vinculado.");
      if (processResult.error) throw new Error("Não foi possível confirmar o processo de origem.");
      if (!inScope()) throw new Error("A Secretaria ou a sessão mudou durante a geração do PDF.");

      const branding = await carregarTimbradoSecretaria(props.tenantId, tenantResult.data.name);
      const documentText = buildSupplyOrderDocumentText({
        tenantName: tenantResult.data.name,
        contractNumber: contractResult.data.number,
        contractObject: contractResult.data.object,
        ...(processResult.data?.number ? { processNumber: processResult.data.number } : {}),
        supplierName: supplierResult.data.trade_name || supplierResult.data.legal_name,
        supplierCnpj: supplierResult.data.cnpj,
        referenceNumber: order.referenceNumber,
        reason: order.reason,
        createdAt: new Date(order.createdAt).toLocaleString("pt-BR"),
        items: order.items,
        totalValue: order.totalValue,
        ...(contractResult.data.inspector_name
          ? { responsibleName: contractResult.data.inspector_name }
          : {}),
      });
      const docxBytes = await buildDocxFromText(documentText, "Ordem de Fornecimento");
      const model = await docxToModel(docxBytes);
      const pdfBytes = await renderPdf(model, {
        branding,
        title: "Ordem de Fornecimento " + order.referenceNumber,
      });
      if (!inScope()) throw new Error("A Secretaria ou a sessão mudou durante a geração do PDF.");
      const blob = new Blob([pdfBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const token =
        order.referenceNumber
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "OF";
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Ordem-de-Fornecimento-" + token + ".pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Termo da Ordem de Fornecimento gerado com sucesso!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reimprimir a OF.");
    } finally {
      setReprintingReference(null);
    }
  }

  async function exportarDossieTce() {
    if (items.length === 0) {
      toast.error("O contrato não possui itens cadastrados para emitir o dossiê.");
      return;
    }
    if (loading || erro) {
      toast.error(
        "Aguarde o carregamento completo dos itens e movimentações antes de emitir o dossiê.",
      );
      return;
    }
    if (!inScope()) {
      toast.error("A Secretaria ou a sessão mudou. Reabra o instrumento.");
      return;
    }

    setGerandoDossie(true);
    try {
      const [tenantResult, contractResult, amendmentsResult] = await Promise.all([
        db.from("tenants").select("name").eq("id", props.tenantId).maybeSingle(),
        db
          .from("contracts")
          .select("*")
          .eq("id", props.contract.id)
          .eq("tenant_id", props.tenantId)
          .maybeSingle(),
        db
          .from("contract_amendments")
          .select("*")
          .eq("contract_id", props.contract.id)
          .eq("tenant_id", props.tenantId)
          .order("signed_at", { ascending: true }),
      ]);

      if (tenantResult.error || !tenantResult.data?.name) {
        throw new Error("Não foi possível confirmar a Secretaria do instrumento.");
      }
      if (contractResult.error || !contractResult.data) {
        throw new Error("Não foi possível confirmar o contrato ou a ata.");
      }
      if (amendmentsResult.error) {
        throw new Error("Não foi possível carregar o histórico de aditivos e apostilamentos.");
      }
      if (!inScope()) {
        throw new Error("A Secretaria ou a sessão mudou durante a geração.");
      }

      if (!contractResult.data.supplier_id) {
        throw new Error(
          "O instrumento não possui fornecedor vinculado para identificar no dossiê.",
        );
      }

      const [supplierResult, processResult] = await Promise.all([
        db
          .from("suppliers")
          .select("legal_name,trade_name,cnpj")
          .eq("id", contractResult.data.supplier_id)
          .eq("tenant_id", props.tenantId)
          .maybeSingle(),
        contractResult.data.process_id
          ? db
              .from("procurement_processes")
              .select("number")
              .eq("id", contractResult.data.process_id)
              .eq("tenant_id", props.tenantId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (supplierResult.error || !supplierResult.data) {
        throw new Error("Não foi possível confirmar o fornecedor vinculado ao instrumento.");
      }
      if (processResult.error) {
        throw new Error("Não foi possível confirmar o processo administrativo de origem.");
      }
      if (!inScope()) {
        throw new Error("A Secretaria ou a sessão mudou durante a geração.");
      }

      const { itemsCalculated, summary } = calcularResumoDossieContratual({
        contractTotalValue: Number(contractResult.data.total_value),
        items: items.map((item) => ({
          id: item.id,
          lineNumber: item.line_number,
          description: item.description,
          unit: item.unit,
          quantityTotal: Number(item.quantity_total),
          unitValue: Number(item.unit_value),
        })),
        movements: movements.map((movement) => ({
          contract_item_id: movement.contract_item_id,
          movement_type: movement.movement_type,
          quantity: Number(movement.quantity),
        })),
        amendments: (amendmentsResult.data ?? []).map((amendment) => ({
          number: amendment.number,
          kind: amendment.kind,
          signedAt: amendment.signed_at,
          newEndDate: amendment.new_end_date,
          valueChange: Number(amendment.value_change),
          notes: amendment.notes,
        })),
        ordersCount: supplyOrders.length,
      });

      const branding = await carregarTimbradoSecretaria(props.tenantId, tenantResult.data.name);
      if (!inScope()) {
        throw new Error("A Secretaria ou a sessão mudou durante a geração.");
      }

      const documentText = buildContractDossierDocumentText({
        tenantName: tenantResult.data.name,
        contract: {
          number: contractResult.data.number,
          instrumentType: contractResult.data.instrument_type,
          modality: contractResult.data.modality,
          object: contractResult.data.object,
          startDate: contractResult.data.start_date,
          endDate: contractResult.data.end_date,
          totalValue: Number(contractResult.data.total_value),
          status: contractResult.data.status,
          managerName: contractResult.data.manager_name,
          inspectorName: contractResult.data.inspector_name,
          ordinance: contractResult.data.ordinance,
        },
        processNumber: processResult.data?.number ?? null,
        supplier: {
          name: supplierResult.data.trade_name || supplierResult.data.legal_name,
          cnpj: supplierResult.data.cnpj,
        },
        amendments: (amendmentsResult.data ?? []).map((amendment) => ({
          number: amendment.number,
          kind: amendment.kind,
          signedAt: amendment.signed_at,
          newEndDate: amendment.new_end_date,
          valueChange: Number(amendment.value_change),
          notes: amendment.notes,
        })),
        items: itemsCalculated,
        orders: supplyOrders.map((order) => ({
          referenceNumber: order.referenceNumber,
          createdAt: order.createdAt,
          reason: order.reason,
          itemsCount: order.itemsCount,
          totalValue: order.totalValue,
        })),
        summary,
        generatedAt: new Date().toLocaleString("pt-BR"),
      });

      const title = "Dossiê TCE - Contrato " + contractResult.data.number;
      const docxBytes = await buildDocxFromText(documentText, title, "landscape");
      const model = await docxToModel(docxBytes);
      const pdfBytes = await renderPdf(model, {
        branding,
        title,
        useTemplatePageSize: true,
      });

      if (!inScope()) {
        throw new Error("A Secretaria ou a sessão mudou durante a geração do PDF.");
      }

      const blob = new Blob([pdfBytes.slice().buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const cleanNumber =
        contractResult.data.number.replace(/[^a-zA-Z0-9_-]/g, "_") || "instrumento";
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Dossie-TCE-Contrato-" + cleanNumber + ".pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success("Dossiê TCE e Prestação de Contas gerado em PDF com sucesso!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao gerar dossiê TCE.");
    } finally {
      setGerandoDossie(false);
    }
  }

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
    const itemData = {
      description: itemForm.description.trim(),
      specification: itemForm.specification.trim() || null,
      unit: itemForm.unit.trim(),
      quantity_total: total,
      unit_value: unitValue,
      updated_by: props.userId,
    };
    let itemWriteError: string | null = null;
    let updateFound = true;
    if (itemEditandoId) {
      const { data: updatedItem, error: updateError } = await db
        .from("contract_items")
        .update(itemData)
        .eq("tenant_id", props.tenantId)
        .eq("contract_id", props.contract.id)
        .eq("id", itemEditandoId)
        .select("id")
        .maybeSingle();
      itemWriteError = updateError?.message ?? null;
      updateFound = !!updatedItem;
    } else {
      const { error: insertError } = await db.from("contract_items").insert({
        tenant_id: props.tenantId,
        contract_id: props.contract.id,
        line_number: items.reduce((max, item) => Math.max(max, item.line_number), 0) + 1,
        ...itemData,
        created_by: props.userId,
      });
      itemWriteError = insertError?.message ?? null;
    }
    setSalvando(false);
    if (itemWriteError) {
      toast.error(itemWriteError);
      return;
    }
    if (!updateFound) {
      toast.error("Item não encontrado ou sem permissão para atualização.");
      return;
    }
    toast.success(itemEditandoId ? "Item atualizado." : "Item incluído no contrato/ARP.");
    setItemForm(EMPTY_ITEM);
    setItemEditandoId(null);
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
        aria-label={`Itens e saldo do contrato ${props.contract.number}`}
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
            <div className="flex flex-wrap gap-2">
              <SupplyOrderDialog
                key={props.tenantId + props.contract.id}
                tenantId={props.tenantId}
                contractId={props.contract.id}
                userId={props.userId}
                enabled={
                  !loading &&
                  !erro &&
                  !salvando &&
                  props.contract.status === "vigente" &&
                  props.contract.end_date >= new Date().toLocaleDateString("sv-SE")
                }
                items={items.map((item) => ({
                  itemId: item.id,
                  lineNumber: item.line_number,
                  description: item.description,
                  unit: item.unit,
                  unitValue: Number(item.unit_value),
                  availableQuantity: calcularSaldoDisponivel(
                    Number(item.quantity_total),
                    movementsByItem[item.id] ?? [],
                  ),
                }))}
                onSuccess={carregar}
              />
              {props.contract.process_id && props.contract.status === "vigente" && (
                <ContractItemsImport
                  key={props.tenantId + props.contract.id + props.contract.process_id}
                  contractId={props.contract.id}
                  processId={props.contract.process_id}
                  tenantId={props.tenantId}
                  userId={props.userId}
                  onSaved={carregar}
                />
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void exportarDossieTce()}
                disabled={
                  gerandoDossie || loading || Boolean(erro) || items.length === 0 || !inScope()
                }
                title="Gerar Dossiê de Execução Contratual e Prestação de Contas (TCE) em PDF"
              >
                {gerandoDossie ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Dossiê TCE (PDF)
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setItemEditandoId(null);
                  setItemForm(EMPTY_ITEM);
                  setFormAberto((value) => !value);
                }}
              >
                <Plus className="h-4 w-4" /> Adicionar item
              </Button>
            </div>
          </div>

          {formAberto && (
            <form
              onSubmit={salvarItem}
              className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2"
            >
              <div className="sm:col-span-2">
                <Label htmlFor={`item-description-${props.contract.id}`}>
                  {itemEditandoId ? "Editar descrição do item *" : "Descrição do item *"}
                </Label>
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
                  disabled={itemEditandoTemMovimentos}
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
                  disabled={itemEditandoTemMovimentos}
                  value={itemForm.unit_value}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      unit_value: event.target.value,
                    }))
                  }
                />
              </div>
              {itemEditandoTemMovimentos && (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Unidade e valor unitário ficam bloqueados após a primeira movimentação para
                  preservar o histórico de consumo e estornos.
                </p>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={salvando}>
                  {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
                  {itemEditandoId ? "Salvar alterações" : "Salvar item"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFormAberto(false);
                    setItemEditandoId(null);
                    setItemForm(EMPTY_ITEM);
                  }}
                >
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
          <Tabs defaultValue="items" className="space-y-3">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="items">Itens e Saldos</TabsTrigger>
              <TabsTrigger value="orders">Ordens Emitidas (OFs)</TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="space-y-3">
              {!loading && !erro && alertasSaldo.temRiscoDesabastecimento && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-sm">
                    <p className="font-semibold">Atenção: Alerta de Desabastecimento</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {alertasSaldo.criticos > 0 &&
                        `${alertasSaldo.criticos} item(ns) com saldo crítico (≤ 20%). `}
                      {alertasSaldo.esgotados > 0 &&
                        `${alertasSaldo.esgotados} item(ns) com saldo esgotado. `}
                      Considere emitir termo aditivo de quantitativo ou iniciar novo processo
                      licitatório.
                    </p>
                  </div>
                  {podeIniciarReposicao && (
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0 bg-amber-600 text-white hover:bg-amber-700"
                      onClick={() => setDialogReposicaoAberto(true)}
                    >
                      <Plus className="h-4 w-4" /> Iniciar Reposição de Estoque
                    </Button>
                  )}
                </div>
              )}
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : erro ? (
                <p className="text-sm text-destructive">
                  Saldo indisponível até que o histórico de movimentações seja carregado com
                  sucesso.
                </p>
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
                    const percentualDisp = calcularPercentualDisponivel(
                      Number(item.quantity_total),
                      itemMovements,
                    );
                    const percentualConsumido = 100 - percentualDisp;
                    const nivelSaldo = classificarNivelSaldo(percentualDisp);
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
                              {item.line_number}. <span>{item.description}</span>
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
                          <div className="flex flex-col items-end gap-1">
                            <Badge
                              variant={nivelSaldo === "esgotado" ? "destructive" : "secondary"}
                              className={
                                nivelSaldo === "critico"
                                  ? "bg-red-600 text-white hover:bg-red-700"
                                  : nivelSaldo === "atencao"
                                    ? "bg-amber-600 text-white hover:bg-amber-700"
                                    : undefined
                              }
                            >
                              {nivelSaldo === "esgotado"
                                ? "Esgotado (0%)"
                                : nivelSaldo === "critico"
                                  ? `Crítico: ${percentualDisp}% restante`
                                  : nivelSaldo === "atencao"
                                    ? `Atenção: ${percentualDisp}% restante`
                                    : `Disponível: ${percentualDisp}%`}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Saldo: {quantity.format(available)} {item.unit}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Consumido: {quantity.format(used)} {item.unit} · Valor consumido:{" "}
                          {currency.format(used * Number(item.unit_value))}
                        </p>
                        <div className="space-y-1 pt-1">
                          <div className="flex justify-between gap-3 text-[11px] text-muted-foreground">
                            <span>Consumo acumulado: {percentualConsumido.toFixed(1)}%</span>
                            <span>
                              Saldo restante: {quantity.format(available)} {item.unit}
                            </span>
                          </div>
                          <Progress value={percentualConsumido} className="h-1.5" />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={salvando}
                          onClick={() => {
                            setItemEditandoId(item.id);
                            setItemForm({
                              description: item.description,
                              specification: item.specification ?? "",
                              unit: item.unit,
                              quantity_total: String(Number(item.quantity_total)),
                              unit_value: String(Number(item.unit_value)),
                            });
                            setFormAberto(true);
                          }}
                        >
                          Editar item
                        </Button>
                        {consumptionItemId === item.id ? (
                          <form
                            onSubmit={(event) => void registrarConsumo(event, item)}
                            className="grid gap-2 sm:grid-cols-2"
                          >
                            <div>
                              <Label htmlFor={`consume-qty-${item.id}`}>
                                Quantidade a consumir *
                              </Label>
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
                              <Label htmlFor={`consume-ref-${item.id}`}>
                                Referência (opcional)
                              </Label>
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
                              <Label htmlFor={`consume-reason-${item.id}`}>
                                Motivo do consumo *
                              </Label>
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
                                        movement.movement_type === "reversal"
                                          ? "outline"
                                          : "secondary"
                                      }
                                    >
                                      {movement.movement_type === "reversal"
                                        ? "Estorno"
                                        : "Consumo"}
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
            </TabsContent>
            <TabsContent value="orders" className="space-y-3">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : erro ? (
                <p className="text-sm text-destructive">
                  O extrato está indisponível enquanto o histórico não puder ser carregado.
                </p>
              ) : supplyOrders.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhuma Ordem de Fornecimento registrada até o momento.
                </p>
              ) : (
                supplyOrders.map((order) => (
                  <article
                    key={order.referenceNumber}
                    className="space-y-3 rounded-md border p-3 sm:p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <h4 className="break-words font-medium">{order.referenceNumber}</h4>
                        <p className="text-xs text-muted-foreground">
                          Emitida em{" "}
                          {new Date(order.createdAt).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Badge variant="secondary">
                            {order.itemsCount} {order.itemsCount === 1 ? "item" : "itens"}
                          </Badge>
                          <span className="font-semibold">{currency.format(order.totalValue)}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reprintingReference !== null || loading || Boolean(erro)}
                        onClick={() => void reimprimirOrdem(order)}
                      >
                        {reprintingReference === order.referenceNumber ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <Printer className="mr-1 h-4 w-4" />
                        )}
                        Reimprimir Termo (PDF)
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">{order.reason}</p>
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium">
                        Itens da ordem ({order.itemsCount})
                      </summary>
                      <div className="mt-2 overflow-x-auto rounded border">
                        <table className="w-full min-w-[620px] text-left text-xs sm:text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th scope="col" className="p-2">
                                Item
                              </th>
                              <th scope="col" className="p-2">
                                Descrição
                              </th>
                              <th scope="col" className="p-2">
                                Quantidade
                              </th>
                              <th scope="col" className="p-2">
                                Valor unitário
                              </th>
                              <th scope="col" className="p-2">
                                Subtotal
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.items.map((orderedItem) => (
                              <tr key={orderedItem.itemId} className="border-t">
                                <td className="p-2">{orderedItem.lineNumber}</td>
                                <td className="p-2">
                                  <span className="block font-medium">
                                    {orderedItem.description}
                                  </span>
                                  <span className="text-muted-foreground">{orderedItem.unit}</span>
                                </td>
                                <td className="p-2">
                                  {quantity.format(orderedItem.quantity)} {orderedItem.unit}
                                </td>
                                <td className="p-2">{currency.format(orderedItem.unitValue)}</td>
                                <td className="p-2 font-medium">
                                  {currency.format(orderedItem.subtotal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </article>
                ))
              )}
            </TabsContent>
          </Tabs>
          <StockReplenishmentDialog
            open={dialogReposicaoAberto}
            onOpenChange={setDialogReposicaoAberto}
            contract={props.contract}
            tenantId={props.tenantId}
            userId={props.userId}
            itensCriticos={itensCriticos}
            onSucesso={() => void carregar()}
          />
        </div>
      )}
    </section>
  );
}
