import { useRef, useState } from "react";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import { formatarMoeda } from "@/lib/contratacao";
import { parseBatchQuoteRows, type BatchQuoteItemRow } from "@/lib/batch-quote-helper";
import { SupplierSelect, type SupplierOption } from "@/components/supplier-select";
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
import type { TablesInsert } from "@/integrations/supabase/types";

type Supplier = SupplierOption & {
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  street: string | null;
  street_number: string | null;
  neighborhood: string | null;
  state: string | null;
  postal_code: string | null;
};
type Item = {
  id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit: string;
  is_active: boolean;
};
type Props = {
  tenantId: string;
  processId: string;
  userId: string;
  items: Item[];
  suppliers: Supplier[];
  canManage?: boolean;
  onSaved: () => Promise<void>;
};
const extensions: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/jpeg": "jpg",
  "image/png": "png",
};
const today = () => new Date().toLocaleDateString("sv-SE");
const emptyHeader = () => ({
  supplierId: "",
  sourceName: "",
  sourceTaxId: "",
  quotedAt: today(),
  referenceIdentifier: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  justification: "",
  sent: today(),
  deadline: "",
  delivery: "",
});
type QuoteInsert = TablesInsert<"procurement_price_quotes">;

export function BatchQuoteDialog({
  tenantId,
  processId,
  userId,
  items,
  suppliers,
  canManage = true,
  onSaved,
}: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () => scope.current.tenant === tenantId && scope.current.user === userId;
  const [open, setOpen] = useState(false);
  const [header, setHeader] = useState(emptyHeader);
  const [rows, setRows] = useState<BatchQuoteItemRow[]>([]);
  const [column, setColumn] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [pending, setPending] = useState<QuoteInsert[] | null>(null);
  const [error, setError] = useState("");
  const parsed = parseBatchQuoteRows(rows, { ...header, sourceType: "fornecedor" });
  const invalid = Object.keys(parsed.errorsByItem).length > 0;
  const frozen = busy || !!pending;
  function start() {
    if (!pending) {
      setRows(
        items
          .filter((i) => i.is_active)
          .sort((a, b) => a.line_number - b.line_number)
          .map((i) => ({
            itemId: i.id,
            lineNumber: i.line_number,
            description: i.description,
            quantity: i.quantity,
            unit: i.unit,
            unitPriceText: "",
            brandModel: "",
            deliveryCostText: "",
          })),
      );
      setHeader(emptyHeader());
      setFile(null);
      setColumn("");
      setShowPaste(false);
      setError("");
    }
    setOpen(true);
  }
  function selectSupplier(id: string) {
    const s = suppliers.find((x) => x.id === id);
    setHeader((h) => ({
      ...h,
      supplierId: s?.id ?? "",
      sourceName: s?.legal_name ?? "",
      sourceTaxId: s?.cnpj ?? "",
      contact: s?.contact_name ?? "",
      email: s?.contact_email ?? "",
      phone: s?.contact_phone ?? "",
      address: [s?.street, s?.street_number, s?.neighborhood, s?.city, s?.state, s?.postal_code]
        .filter(Boolean)
        .join(", "),
    }));
  }
  function paste() {
    const values = column.replace(/\r\n?/g, "\n").split("\n");
    if (values.length === rows.length + 1 && values.at(-1) === "") values.pop();
    if (values.length !== rows.length || values.some((v) => v.includes("\t"))) {
      setError("Cole uma única coluna, com uma linha para cada item, inclusive as linhas vazias.");
      return;
    }
    setRows((current) => current.map((r, i) => ({ ...r, unitPriceText: values[i] ?? "" })));
    setError("");
    setShowPaste(false);
  }
  async function save() {
    if (lock.current || !inScope() || invalid || !parsed.validInserts.length) return;
    if (!file || !extensions[file.type] || file.size <= 0 || file.size > 20 * 1024 * 1024) {
      setError("Anexe a proposta formal em PDF, DOC, DOCX, XLS, XLSX, JPG ou PNG de até 20 MB.");
      return;
    }
    const extension = extensions[file.type];
    if (
      ![
        header.sourceName,
        header.sourceTaxId,
        header.contact,
        header.email,
        header.phone,
        header.address,
        header.quotedAt,
        header.referenceIdentifier,
      ].every((v) => v.trim()) ||
      header.justification.trim().length < 10 ||
      !header.sent ||
      !header.deadline ||
      header.deadline < header.sent
    ) {
      setError(
        "Preencha os dados da proposta, justificativa (10 caracteres), envio e prazo de resposta.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const access = await db.rpc("get_document_capabilities", { p_tenant_id: tenantId });
      if (access.error || !access.data?.[0]?.can_create || !access.data?.[0]?.can_update)
        throw new Error(
          "Seu perfil precisa de permissão para cadastrar cotações e vincular comprovantes.",
        );
      const ids = parsed.validInserts.map((r) => r.procurement_item_id);
      const current = await db
        .from("procurement_items")
        .select("id,quantity")
        .eq("tenant_id", tenantId)
        .eq("process_id", processId)
        .eq("is_active", true)
        .in("id", ids);
      if (
        current.error ||
        current.data.length !== ids.length ||
        current.data.some((i) => rows.find((r) => r.itemId === i.id)?.quantity !== i.quantity)
      )
        throw new Error("Os itens foram alterados. Feche e abra a proposta novamente.");
      const process = await db
        .from("procurement_processes")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("id", processId)
        .single();
      if (process.error || process.data.status === "concluido")
        throw new Error("Processo indisponível ou concluído.");
      if (header.supplierId) {
        const supplier = await db
          .from("suppliers")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("id", header.supplierId)
          .single();
        if (supplier.error || !supplier.data)
          throw new Error("Fornecedor indisponível nesta Secretaria.");
      }
      if (!inScope()) return;
      const payload =
        pending ??
        parsed.validInserts.map((row) => ({
          ...row,
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          created_by: userId,
          updated_by: userId,
          source_contact_name: header.contact.trim(),
          source_contact_email: header.email.trim(),
          source_contact_phone: header.phone.trim(),
          source_address: header.address.trim(),
          supplier_selection_justification: header.justification.trim(),
          supplier_consultation_sent_at: header.sent,
          supplier_consultation_response_deadline: header.deadline,
          delivery_term: header.delivery.trim() || null,
        }));
      setPending(payload);
      const check = await db
        .from("procurement_price_quotes")
        .select("id,evidence_storage_path")
        .eq("tenant_id", tenantId)
        .in(
          "id",
          payload.map((r) => r.id!),
        );
      if (check.error) throw new Error(check.error.message);
      if (check.data.length !== 0 && check.data.length !== payload.length)
        throw new Error("Lote parcialmente localizado. Confira a lista antes de continuar.");
      if (!check.data.length) {
        if (!inScope()) return;
        const inserted = await db.from("procurement_price_quotes").insert(payload);
        if (inserted.error) {
          if (
            inserted.error.code &&
            /^\d|^P/.test(inserted.error.code) &&
            inserted.error.code !== "23505"
          )
            setPending(null);
          throw new Error(inserted.error.message);
        }
      }
      for (const row of payload) {
        if (!inScope()) return;
        if (check.data.find((q) => q.id === row.id)?.evidence_storage_path) continue;
        const path =
          tenantId +
          "/procurement-quotes/" +
          row.procurement_item_id +
          "/" +
          row.id +
          "/" +
          crypto.randomUUID() +
          "." +
          extension;
        const upload = await db.storage
          .from("gfs-private-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upload.error)
          throw new Error("Cotações gravadas. Falta vincular comprovante: " + upload.error.message);
        const linked = await db
          .from("procurement_price_quotes")
          .update({
            evidence_storage_path: path,
            evidence_file_name: file.name,
            evidence_mime_type: file.type,
            evidence_file_size: file.size,
            updated_by: userId,
          })
          .eq("tenant_id", tenantId)
          .eq("id", row.id!)
          .select("id")
          .single();
        if (linked.error)
          throw new Error("Cotações gravadas. Confira os comprovantes e tente concluir novamente.");
      }
      setPending(null);
      setOpen(false);
      toast.success(payload.length + " cotações registradas com comprovantes.");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar proposta.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  const fields = [
    ["sourceName", "Nome da fonte"],
    ["sourceTaxId", "CPF/CNPJ"],
    ["quotedAt", "Data da cotação"],
    ["referenceIdentifier", "Número da proposta"],
    ["contact", "Responsável"],
    ["email", "E-mail"],
    ["phone", "Telefone"],
    ["address", "Endereço"],
    ["justification", "Justificativa da escolha"],
    ["sent", "Data de envio da solicitação"],
    ["deadline", "Prazo de resposta"],
    ["delivery", "Prazo de entrega (opcional)"],
  ] as const;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) setOpen(v);
      }}
    >
      <Button
        variant="outline"
        type="button"
        disabled={!canManage || !items.some((i) => i.is_active)}
        onClick={start}
      >
        <Receipt className="h-4 w-4" />
        Lançar Proposta Comercial
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Lançar Proposta Comercial</DialogTitle>
          <DialogDescription>
            Informe os dados uma vez. Deixe preços vazios ou zero para itens não cotados.
          </DialogDescription>
        </DialogHeader>
        <Label>Fornecedor cadastrado</Label>
        <SupplierSelect
          suppliers={suppliers}
          value={header.supplierId || "livre"}
          onValueChange={selectSupplier}
          disabled={frozen}
          emptyOption={{ value: "livre", label: "Fornecedor livre" }}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map(([key, label]) => (
            <Label key={key}>
              {label}
              <Input
                disabled={frozen}
                type={
                  ["quotedAt", "sent", "deadline"].includes(key)
                    ? "date"
                    : key === "email"
                      ? "email"
                      : "text"
                }
                value={header[key]}
                onChange={(e) => setHeader((h) => ({ ...h, [key]: e.target.value }))}
              />
            </Label>
          ))}
        </div>
        <Label>
          Proposta formal
          <Input
            type="file"
            disabled={frozen}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Label>
        <Button
          disabled={frozen}
          type="button"
          variant="outline"
          onClick={() => setShowPaste((v) => !v)}
        >
          Preencher valores em lote (Colar coluna)
        </Button>
        {showPaste && (
          <>
            <Textarea
              value={column}
              disabled={frozen}
              onChange={(e) => setColumn(e.target.value)}
              placeholder="Uma linha por item na ordem exibida"
            />
            <Button type="button" disabled={frozen} onClick={paste}>
              Aplicar coluna
            </Button>
          </>
        )}
        <div className="max-h-80 overflow-auto rounded border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr>
                {[
                  "Item",
                  "Descrição",
                  "Qtd / unidade",
                  "Preço unitário",
                  "Marca / modelo",
                  "Frete do item",
                  "Subtotal",
                ].map((h) => (
                  <th className="p-2 text-left" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const quote = parsed.validInserts.find((q) => q.procurement_item_id === row.itemId);
                return (
                  <tr key={row.itemId} className="border-t">
                    <td className="p-2">{row.lineNumber}</td>
                    <td className="min-w-40 p-2">
                      {row.description}
                      {parsed.errorsByItem[row.itemId] && (
                        <p role="alert" className="text-destructive">
                          {parsed.errorsByItem[row.itemId]}
                        </p>
                      )}
                    </td>
                    <td className="p-2">
                      {row.quantity} {row.unit}
                    </td>
                    {(["unitPriceText", "brandModel", "deliveryCostText"] as const).map((key) => (
                      <td key={key} className="p-1">
                        <Input
                          aria-label={key + " item " + row.lineNumber}
                          className="min-w-24"
                          disabled={frozen}
                          inputMode={key === "brandModel" ? "text" : "decimal"}
                          value={row[key]}
                          onChange={(e) =>
                            setRows((current) =>
                              current.map((r) =>
                                r.itemId === row.itemId ? { ...r, [key]: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td className="p-2 whitespace-nowrap">
                      {quote
                        ? formatarMoeda(quote.quantity * quote.unit_price + quote.delivery_cost)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-between gap-2 font-semibold">
          <span>
            {parsed.validInserts.length} itens cotados de {rows.length}
          </span>
          <span>Valor Total da Proposta Comercial: {formatarMoeda(parsed.totalProposta)}</span>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {pending && (
          <p role="status">
            Lote em conferência. Reabra este diálogo ou conclua o vínculo dos comprovantes para
            evitar duplicidade.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button
            disabled={busy || invalid || !parsed.validInserts.length}
            onClick={() => void save()}
          >
            {busy
              ? "Salvando…"
              : pending
                ? "Conferir e concluir"
                : "Salvar Cotações (" + parsed.validInserts.length + " itens)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
