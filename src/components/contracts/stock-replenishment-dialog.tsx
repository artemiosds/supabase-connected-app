import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { db } from "@/lib/db";
import {
  montarSugestaoProcessoReposicao,
  prepararProcurementItemsParaInsercao,
  type ItemCriticoSugerido,
} from "@/lib/stock-replenishment-helper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: { id: string; number: string; object?: string | null };
  tenantId: string;
  userId: string;
  itensCriticos: ItemCriticoSugerido[];
  onSucesso: (novoProcessoId: string) => void;
};
type Form = ReturnType<typeof montarSugestaoProcessoReposicao>;
type Row = ItemCriticoSugerido;

export function StockReplenishmentDialog(props: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () => Boolean(props.userId) &&
    scope.current.tenant === props.tenantId && scope.current.user === props.userId;
  const [form, setForm] = useState<Form>(() => montarSugestaoProcessoReposicao({
    contractNumber: props.contract.number, contractObject: props.contract.object,
    itensCriticos: props.itensCriticos,
  }));
  const [rows, setRows] = useState<Row[]>(props.itensCriticos);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [createdProcessId, setCreatedProcessId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open || createdProcessId) return;
    setForm(montarSugestaoProcessoReposicao({
      contractNumber: props.contract.number, contractObject: props.contract.object,
      itensCriticos: props.itensCriticos,
    }));
    setRows(props.itensCriticos);
    setError("");
  }, [props.open, props.contract.number, props.contract.object, props.itensCriticos, createdProcessId]);

  const chosen = rows.filter((item) => item.selecionado);
  const valid = chosen.length > 0 && chosen.every((item) =>
    Number.isFinite(item.quantidadeSugerida) && item.quantidadeSugerida > 0 &&
    item.description.trim().length >= 3 && item.unit.trim().length > 0
  ) && form.number.trim().length > 0 && form.title.trim().length >= 3 &&
    form.description.trim().length >= 10 && form.requesting_unit.trim().length > 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !valid) return;
    if (!inScope()) {
      setError("A sessão ou a Secretaria mudou. Reabra o contrato.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    let processId = createdProcessId;
    try {
      if (!processId) {
        const permission = await db.rpc("get_document_capabilities", { p_tenant_id: props.tenantId });
        if (permission.error || permission.data?.[0]?.can_create !== true) {
          throw new Error("Sua conta não possui permissão para criar processos nesta Secretaria.");
        }
        const result = await db.rpc("create_procurement_process_with_checklist", {
          p_tenant_id: props.tenantId,
          p_number: form.number.trim(),
          p_title: form.title.trim(),
          p_modality: form.modality,
          p_priority: form.priority,
          p_description: form.description.trim(),
          p_requesting_unit: form.requesting_unit.trim(),
        });
        if (result.error || !result.data) throw new Error(result.error?.message ?? "Não foi possível criar o processo.");
        processId = result.data;
        setCreatedProcessId(processId);
      }
      if (!inScope()) throw new Error("A sessão ou a Secretaria mudou durante a operação.");
      // Na repetição, não duplicar itens quando a resposta anterior foi perdida.
      const existing = await db.from("procurement_items")
        .select("id").eq("tenant_id", props.tenantId).eq("process_id", processId).limit(1);
      if (existing.error) throw new Error("Processo criado, mas não foi possível verificar os itens: " + existing.error.message);
      if ((existing.data?.length ?? 0) > 0) {
        throw new Error("O processo já contém itens. Abra-o para conferir a importação antes de tentar novamente.");
      }
      const payload = prepararProcurementItemsParaInsercao({
        processId, tenantId: props.tenantId, userId: props.userId, itens: chosen,
      });
      const inserted = await db.from("procurement_items").insert(payload);
      if (inserted.error) throw new Error("Processo criado, mas os itens não foram gravados: " + inserted.error.message);
      if (!inScope()) throw new Error("A sessão ou a Secretaria mudou. Confira o processo criado antes de continuar.");
      setCreatedProcessId(null);
      props.onOpenChange(false);
      props.onSucesso(processId);
      toast.success("Processo de reposição criado com sucesso!", {
        action: {
          label: "Abrir Processo",
          onClick: () => window.location.assign("/processos?processo=" + encodeURIComponent(processId)),
        },
      });
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : "Falha ao iniciar reposição.") +
        (processId ? " Processo: " + processId + ". Confira os itens em /processos?processo=" + encodeURIComponent(processId) + "." : ""));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !busy && props.onOpenChange(open)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Iniciar Reposição de Estoque</DialogTitle></DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <p className="text-sm text-muted-foreground">Confira a necessidade, a modalidade e os preços históricos antes de instruir a nova contratação. O preço do contrato anterior não substitui a pesquisa de preços.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="rep-number">Nº do processo *</Label><Input id="rep-number" maxLength={100} required disabled={Boolean(createdProcessId)} value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} /></div>
            <div><Label htmlFor="rep-title">Título *</Label><Input id="rep-title" maxLength={250} required disabled={Boolean(createdProcessId)} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
            <div><Label>Prioridade</Label><Select disabled={Boolean(createdProcessId)} value={form.priority} onValueChange={(value: "urgente" | "alta") => setForm((f) => ({ ...f, priority: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="urgente">Urgente</SelectItem><SelectItem value="alta">Alta</SelectItem></SelectContent></Select></div>
            <div><Label>Modalidade</Label><Select disabled={Boolean(createdProcessId)} value={form.modality} onValueChange={(value: "pregao" | "dispensa") => setForm((f) => ({ ...f, modality: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pregao">Pregão</SelectItem><SelectItem value="dispensa">Dispensa</SelectItem></SelectContent></Select></div>
            <div className="sm:col-span-2"><Label htmlFor="rep-unit">Setor requisitante *</Label><Input id="rep-unit" maxLength={200} required disabled={Boolean(createdProcessId)} value={form.requesting_unit} onChange={(e) => setForm((f) => ({ ...f, requesting_unit: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label htmlFor="rep-description">Justificativa *</Label><Textarea id="rep-description" required minLength={10} disabled={Boolean(createdProcessId)} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
            {rows.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
                <Checkbox aria-label={"Incluir " + item.description} checked={item.selecionado} disabled={Boolean(createdProcessId)} onCheckedChange={(checked) => setRows((current) => current.map((row) => row.id === item.id ? { ...row, selecionado: checked === true } : row))} />
                <div className="min-w-40 flex-1"><p className="text-sm font-medium">{item.description}</p><p className="text-xs text-muted-foreground">{item.unit} · preço histórico {item.unit_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p></div>
                <Badge variant={item.nivel === "esgotado" ? "destructive" : "secondary"}>{item.nivel === "esgotado" ? "Esgotado" : "Crítico"}</Badge>
                <div className="w-32"><Label htmlFor={"rep-qty-" + item.id}>Qtd. a adquirir</Label><Input id={"rep-qty-" + item.id} type="number" min="0.0001" step="0.0001" value={item.quantidadeSugerida} disabled={!item.selecionado || Boolean(createdProcessId)} onChange={(e) => setRows((current) => current.map((row) => row.id === item.id ? { ...row, quantidadeSugerida: Number(e.target.value) } : row))} /></div>
              </div>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {createdProcessId && <a className="text-sm underline" href={"/processos?processo=" + encodeURIComponent(createdProcessId)}>Abrir processo criado e conferir itens</a>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => props.onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={busy || !valid}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{createdProcessId ? "Tentar gravar itens novamente" : "Criar processo com " + chosen.length + " item(ns)"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
