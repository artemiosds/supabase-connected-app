import { useRef, useState } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  buildPriceMatrix,
  isApproved,
  prepareBatchApprovalPayload,
  type BatchMethod,
  type MatrixItem,
  type MatrixQuote,
  type MatrixApproval,
} from "@/lib/price-matrix-helper";
import { contarFontesDistintas } from "@/lib/pesquisa-precos";
import { Button } from "@/components/ui/button";
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
  processId: string;
  items: MatrixItem[];
  quotes: MatrixQuote[];
  approvals: MatrixApproval[];
  canApprovePrice: boolean;
  in65Applicable: boolean;
  onSaved: () => Promise<void>;
};
const suggestions: Record<BatchMethod, string> = {
  mediana:
    "Adotada a mediana das cotações válidas, após análise da comparabilidade e dispersão dos preços.",
  menor: "Adotado o menor preço válido, após análise da comparabilidade e exequibilidade.",
  media:
    "Adotada a média das cotações válidas, após análise da comparabilidade e dispersão dos preços.",
};

export function BatchPriceApprovalDialog({
  tenantId,
  processId,
  items,
  quotes,
  approvals,
  canApprovePrice,
  in65Applicable,
  onSaved,
}: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<BatchMethod>("mediana");
  const [justification, setJustification] = useState(suggestions.mediana);
  const [exceptional, setExceptional] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [finished, setFinished] = useState<string[]>([]);
  const active = items.filter((i) => i.is_active !== false);
  const approved = active.filter((i) => isApproved(i, approvals)).length;
  const effectiveApprovals = [
    ...approvals,
    ...finished.map((id) => ({ procurement_item_id: id, status: "approved" })),
  ];
  const remaining = active.filter((i) => !finished.includes(i.id));
  const prepared = prepareBatchApprovalPayload(
    remaining,
    quotes,
    effectiveApprovals,
    method,
    justification,
    exceptional,
  );
  const matrix = buildPriceMatrix(remaining, quotes);
  const low = matrix.rows.some((r) => {
    if (isApproved(r.item, effectiveApprovals) || r.summary.quantidade === 0) return false;
    const activeItemQuotes = quotes.filter(
      (q) => q.procurement_item_id === r.item.id && q.is_active !== false,
    );
    return r.summary.quantidade < 3 || contarFontesDistintas(activeItemQuotes) < 3;
  });
  const high = matrix.rows.filter(
    (r) =>
      prepared.eligibleItems.some((i) => i.itemId === r.item.id) &&
      (r.summary.coeficienteVariacao ?? 0) > 25,
  );
  async function approve() {
    if (
      lock.current ||
      !canApprovePrice ||
      !confirmed ||
      !prepared.eligibleItems.length ||
      scope.current.tenant !== tenantId ||
      !scope.current.user
    )
      return;
    const user = scope.current.user;
    const validScope = () => scope.current.tenant === tenantId && scope.current.user === user;
    lock.current = true;
    setBusy(true);
    setFailures([]);
    setProgress("");
    const errors: string[] = [];
    const completed: string[] = [];
    try {
      for (const [index, item] of prepared.eligibleItems.entries()) {
        if (!validScope()) break;
        setProgress(
          `Processando ${index + 1} de ${prepared.eligibleItems.length}: ${item.description}`,
        );
        try {
          const latest = await db
            .from("procurement_items")
            .select("id,estimated_price_source")
            .eq("tenant_id", tenantId)
            .eq("process_id", processId)
            .eq("id", item.itemId)
            .eq("is_active", true)
            .single();
          if (latest.error || !latest.data) throw new Error("Item indisponível no processo.");
          if (latest.data.estimated_price_source === "approved")
            throw new Error("O item já possui preço aprovado. Atualize a lista.");
          if (!validScope()) break;
          const distinctSources = contarFontesDistintas(
            quotes.filter((q) => q.procurement_item_id === item.itemId && q.is_active !== false),
          );
          const result = await db.rpc("approve_procurement_item_price", {
            p_tenant_id: tenantId,
            p_item_id: item.itemId,
            p_method: method,
            p_method_justification: justification.trim(),
            ...(item.samplesCount < 3 || distinctSources < 3
              ? { p_exceptional_justification: exceptional.trim() }
              : {}),
          });
          if (result.error) throw new Error(result.error.message);
          completed.push(item.itemId);
          setFinished((old) => [...old, item.itemId]);
        } catch (error) {
          errors.push(
            item.description +
              ": " +
              (error instanceof Error ? error.message : "Falha na aprovação."),
          );
        }
      }
      setProgress(`${completed.length} aprovado(s); ${errors.length} com pendência.`);
      setFailures(errors);
      if (completed.length) toast.success(completed.length + " preço(s) aprovado(s).");
      if (errors.length) toast.error("Alguns itens não foram aprovados. Confira os motivos.");
      if (validScope()) await onSaved();
    } catch (error) {
      setFailures([
        ...errors,
        error instanceof Error ? error.message : "Não foi possível atualizar os resultados.",
      ]);
    } finally {
      lock.current = false;
      setBusy(false);
      setConfirmed(false);
    }
  }
  if (!canApprovePrice) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setFinished([]);
          setFailures([]);
          setProgress("");
          setConfirmed(false);
          setOpen(true);
        }}
      >
        Aprovação em Lote
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aprovação em Lote</DialogTitle>
          <DialogDescription>
            Revise a pesquisa antes de aprovar os preços. Cada item é validado pela rotina oficial
            do banco e possui resultado individual.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {active.length} itens ativos · {approved} já aprovados · {prepared.eligibleItems.length}{" "}
          elegíveis
        </p>
        <Label>
          Método de cálculo
          <select
            disabled={busy}
            className="mt-1 block w-full rounded border bg-background p-2"
            value={method}
            onChange={(e) => {
              const value = e.target.value as BatchMethod;
              setMethod(value);
              setJustification(suggestions[value]);
              setConfirmed(false);
            }}
          >
            <option value="mediana">Mediana (art. 6º da IN 65/2021, quando aplicável)</option>
            <option value="menor">Menor preço</option>
            <option value="media">Média</option>
          </select>
        </Label>
        <Label>
          Justificativa do método
          <Textarea
            disabled={busy}
            value={justification}
            onChange={(e) => {
              setJustification(e.target.value);
              setConfirmed(false);
            }}
          />
        </Label>
        {in65Applicable && (
          <p className="text-xs text-muted-foreground">
            Enquadramento da IN 65/2021 validado neste processo. Confirme a adequação do método e a
            análise crítica das amostras.
          </p>
        )}
        {low && (
          <Label>
            Justificativa excepcional para menos de três cotações
            <Textarea
              disabled={busy}
              value={exceptional}
              onChange={(e) => {
                setExceptional(e.target.value);
                setConfirmed(false);
              }}
            />
            <span className="text-xs">
              Mínimo de 10 caracteres. Informe a fundamentação e a autorização competente, quando
              aplicável. Sem justificativa, esses itens ficam fora do lote.
            </span>
          </Label>
        )}
        {high.length > 0 && (
          <p className="rounded bg-amber-50 p-2 text-sm text-amber-950">
            Dispersão superior a 25% em {high.length} item(ns). Revise a cesta e as justificativas
            antes de confirmar.
          </p>
        )}
        <div className="max-h-48 overflow-auto rounded border p-2 text-sm">
          <p className="font-semibold">Itens elegíveis</p>
          {prepared.eligibleItems.map((item) => (
            <p key={item.itemId}>
              {item.description} · {item.samplesCount} amostras
            </p>
          ))}
          <p className="mt-2 font-semibold">Itens fora do lote</p>
          {prepared.ineligibleItems.map((item) => (
            <p key={item.itemId}>
              {item.description} — {item.reason}
            </p>
          ))}
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          Conferi os preços, as fontes e as justificativas dos itens elegíveis.
        </label>
        {progress && <p role="status">{progress}</p>}
        {failures.map((error, index) => (
          <p key={index} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ))}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button
            disabled={busy || !confirmed || !prepared.eligibleItems.length}
            onClick={() => void approve()}
          >
            {busy ? "Aprovando…" : "Aprovar " + prepared.eligibleItems.length + " Itens Elegíveis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
