import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/db";
import { formatarMoeda } from "@/lib/contratacao";
import { parsePastedItems } from "@/lib/procurement-items-parser";
import type { TablesInsert } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type Props = { tenantId: string; processId: string; userId: string; onSaved: () => Promise<void> };
const example =
  "Descrição\tUnidade\tQuantidade\tPreço\nAmoxicilina 500mg\tcp\t5000\t0,45\nDipirona 500mg/ml\tamp\t1200\t1,50\nSoro fisiológico 0,9% 500ml\tfr\t300\t5,20";
type Insert = TablesInsert<"procurement_items">;
const unitPriceFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function BatchItemsDialog({ tenantId, processId, userId, onSaved }: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [delivery, setDelivery] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Insert[] | null>(null);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const scope = useRef({ tenantId: selecionado?.id, userId: session?.user.id, processId });
  scope.current = { tenantId: selecionado?.id, userId: session?.user.id, processId };
  const previews = useMemo(() => parsePastedItems(raw, delivery), [raw, delivery]);
  const valid = previews.filter((row) => row.isValid);
  const total = valid.reduce((sum, row) => sum + (row.estimated_total ?? 0), 0);
  const missingPrices = valid.filter((row) => row.estimated_total === null).length;
  const inScope = () =>
    scope.current.tenantId === tenantId &&
    scope.current.userId === userId &&
    scope.current.processId === processId;
  async function save() {
    if (
      lock.current ||
      !inScope() ||
      (!pending && (!valid.length || valid.length !== previews.length))
    )
      return;
    lock.current = true;
    setSaving(true);
    setMessage("");
    let rows = pending;
    try {
      const access = await db.rpc("get_document_capabilities", { p_tenant_id: tenantId });
      if (access.error || !access.data?.[0]?.can_create)
        throw new Error("Seu perfil não permite cadastrar itens nesta Secretaria.");
      const parent = await db
        .from("procurement_processes")
        .select("id,status")
        .eq("tenant_id", tenantId)
        .eq("id", processId)
        .single();
      if (parent.error || !parent.data) throw new Error("Processo indisponível nesta Secretaria.");
      if (parent.data.status === "concluido") throw new Error("O processo já está concluído.");
      if (!inScope()) return;
      if (!rows)
        rows = valid.map((row) => ({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          process_id: processId,
          line_number: 1,
          description: row.description,
          technical_specification: row.technical_specification || null,
          unit: row.unit,
          quantity: row.quantity,
          estimated_unit_price: row.estimated_unit_price,
          delivery_location: row.delivery_location || null,
          created_by: userId,
          updated_by: userId,
        }));
      const existing = await db
        .from("procurement_items")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("process_id", processId)
        .in(
          "id",
          rows.map((row) => row.id!),
        );
      if (existing.error)
        throw new Error(
          "Não foi possível conferir a gravação anterior. Tente verificar novamente.",
        );
      let complete = existing.data.length === rows.length;
      if (existing.data.length && !complete)
        throw new Error(
          "A conferência retornou parte do lote. Reabra o processo antes de continuar.",
        );
      for (let attempt = 0; !complete && attempt < 3; attempt++) {
        const last = await db
          .from("procurement_items")
          .select("line_number")
          .eq("tenant_id", tenantId)
          .eq("process_id", processId)
          .order("line_number", { ascending: false })
          .limit(1);
        if (last.error) throw new Error(last.error.message);
        const start = last.data[0]?.line_number ?? 0;
        if (start + rows.length > 99999)
          throw new Error("A numeração do processo excederia o limite de 99.999.");
        rows = rows.map((row, index) => ({ ...row, line_number: start + index + 1 }));
        if (!inScope()) return;
        setPending(rows);
        const result = await db.from("procurement_items").insert(rows);
        if (!result.error) {
          complete = true;
          break;
        }
        if (result.error.code === "23505") {
          const confirmed = await db
            .from("procurement_items")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("process_id", processId)
            .in(
              "id",
              rows.map((row) => row.id!),
            );
          if (confirmed.error)
            throw new Error("Não foi possível conferir o lote. Verifique a gravação novamente.");
          if (confirmed.data.length === rows.length) {
            complete = true;
            break;
          }
          if (confirmed.data.length)
            throw new Error(
              "A conferência retornou parte do lote. Reabra o processo antes de continuar.",
            );
          // A different insert reserved the same line numbers. Our statement rolled back.
          if (attempt === 2) {
            setPending(null);
            throw new Error("Outro profissional está cadastrando itens. Tente salvar novamente.");
          }
          continue;
        }
        if (result.error.code && /^\d|^P/.test(result.error.code)) setPending(null);
        throw new Error(
          result.error.message ||
            "Resultado do envio incerto. Verifique a gravação antes de reenviar.",
        );
      }
      if (complete && inScope()) {
        setPending(null);
        setRaw("");
        setOpen(false);
        toast.success(rows.length + " itens inseridos no processo.");
        try {
          await onSaved();
        } catch {
          toast.info("Os itens foram gravados. Atualize o processo para conferir a lista.");
        }
      }
    } catch (error) {
      if (inScope())
        setMessage(error instanceof Error ? error.message : "Não foi possível gravar o lote.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) {
          setOpen(value);
          setMessage("");
        }
      }}
    >
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="h-4 w-4" />
        Importar Planilha
      </Button>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Colar da Planilha (Lote)</DialogTitle>
          <DialogDescription>
            Confira as linhas antes de gravar. Ordem sem cabeçalho: Descrição, Unidade, Quantidade e
            Preço. Separe por TAB, ponto-e-vírgula ou CSV entre aspas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="batch-delivery">Local de entrega padrão</Label>
          <Input
            id="batch-delivery"
            value={delivery}
            disabled={saving || !!pending}
            onChange={(e) => setDelivery(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="batch-paste">Itens da planilha</Label>
          <Textarea
            id="batch-paste"
            rows={7}
            value={raw}
            disabled={saving || !!pending}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Cole aqui as linhas do Excel ou Google Sheets (Ex: Amoxicilina 500mg [TAB] COMPRIMIDO [TAB] 5000 [TAB] 0,45)"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={saving || !!pending}
          onClick={() => setRaw(example)}
        >
          Preencher exemplo demonstrativo
        </Button>
        <p className="text-xs text-muted-foreground">
          O exemplo serve para conferir o formato. Revise os itens, apresentações e preços antes de
          salvar.
        </p>
        {!!previews.length && (
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Linha",
                    "Descrição",
                    "Unidade",
                    "Qtd",
                    "Preço unit. (R$)",
                    "Subtotal (R$)",
                  ].map((label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previews.map((row) => (
                  <TableRow
                    key={row.sourceLine}
                    className={row.isValid ? "" : "bg-red-50 text-red-950"}
                  >
                    <TableCell>{row.sourceLine}</TableCell>
                    <TableCell className="min-w-48 whitespace-normal">
                      {row.description || "Descrição vazia"}
                      {row.erros.map((error) => (
                        <p key={error} className="text-xs" role="alert">
                          {error}
                        </p>
                      ))}
                    </TableCell>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell>
                      {Number.isFinite(row.quantity)
                        ? row.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 4 })
                        : "Inválida"}
                    </TableCell>
                    <TableCell>
                      {row.estimated_unit_price === null
                        ? "Não informado"
                        : Number.isFinite(row.estimated_unit_price)
                          ? unitPriceFormat.format(row.estimated_unit_price)
                          : "Inválido"}
                    </TableCell>
                    <TableCell>
                      {row.estimated_total === null
                        ? "Não informado"
                        : Number.isFinite(row.estimated_total)
                          ? formatarMoeda(row.estimated_total)
                          : "Inválido"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-3 rounded border p-3">
          <Badge variant="outline">{valid.length} itens válidos</Badge>
          <p className="font-semibold">
            {missingPrices ? "Valor parcial informado" : "Valor total previsto da contratação"}:{" "}
            {formatarMoeda(total)}
          </p>
        </div>
        {missingPrices > 0 && (
          <p className="text-sm">
            {missingPrices} item(ns) sem preço estimado. O total completo depende desses valores.
          </p>
        )}
        {valid.length !== previews.length && (
          <p className="text-sm text-destructive">
            Corrija todas as linhas inválidas antes de salvar o lote.
          </p>
        )}
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        {pending && !saving && (
          <p role="status" className="text-sm">
            Confira o resultado do envio com o botão abaixo antes de alterar o lote.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saving || !valid.length || valid.length !== previews.length}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending && !saving
              ? "Verificar gravação"
              : "Salvar " + valid.length + " Itens no Processo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
