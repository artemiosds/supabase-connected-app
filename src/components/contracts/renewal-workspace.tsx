import { useEffect, useState } from "react";
import { CalendarClock, FilePlus2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { diasAte, formatarData, formatarMoeda } from "@/lib/contratacao";
import type { Tables } from "@/integrations/supabase/types";

type Followup = Pick<Tables<"contract_renewal_followups">, "contract_id" | "started_at">;
type Contract = Pick<
  Tables<"contracts">,
  | "id"
  | "number"
  | "object"
  | "end_date"
  | "status"
  | "total_value"
  | "manager_name"
  | "inspector_name"
  | "supplier_id"
  | "instrument_type"
>;

export function RenewalWorkspace(props: {
  tenantId: string;
  userId: string;
  contracts: Contract[];
  supplierName: (id: string | null) => string;
  onAmendment: (id: string) => void;
}) {
  const { tenantId, userId } = props;
  const [state, setState] = useState<{
    tenantId: string;
    rows: Followup[];
    canEdit: boolean;
    canCreate: boolean;
    failed: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "recorded" | "overdue">("all");
  useEffect(() => {
    let active = true;
    setState(null);
    setFilter("all");
    setBusy(null);
    async function load() {
      const [followups, capabilities] = await Promise.allSettled([
        carregarTodasAsPaginas<Followup>((start, end) =>
          db
            .from("contract_renewal_followups")
            .select("contract_id,started_at")
            .eq("tenant_id", tenantId)
            .order("contract_id")
            .range(start, end),
        ),
        db.rpc("get_document_capabilities", { p_tenant_id: tenantId }),
      ]);
      if (!active) return;
      setState({
        tenantId,
        rows: followups.status === "fulfilled" ? followups.value : [],
        canEdit:
          capabilities.status === "fulfilled" &&
          !capabilities.value.error &&
          capabilities.value.data?.[0]?.can_update === true,
        canCreate:
          capabilities.status === "fulfilled" &&
          !capabilities.value.error &&
          capabilities.value.data?.[0]?.can_create === true,
        failed:
          followups.status === "rejected" ||
          capabilities.status === "rejected" ||
          !!(capabilities.status === "fulfilled" && capabilities.value.error),
      });
    }
    void load();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const current = state?.tenantId === tenantId ? state : null;
  const recorded = new Map(current?.rows.map((r) => [r.contract_id, r]) ?? []);
  const eligible = props.contracts
    .filter((c) => c.status === "vigente" && diasAte(c.end_date) <= 120)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const visible = eligible.filter(
    (c) =>
      filter === "all" ||
      (filter === "pending" && !recorded.has(c.id) && diasAte(c.end_date) >= 0) ||
      (filter === "recorded" && recorded.has(c.id)) ||
      (filter === "overdue" && diasAte(c.end_date) < 0),
  );

  async function start(contractId: string) {
    if (!current?.canEdit || current.failed || !userId || busy || recorded.has(contractId)) return;
    setBusy(contractId);
    const { error } = await db
      .from("contract_renewal_followups")
      .insert({ tenant_id: tenantId, contract_id: contractId, started_by: userId })
      .select("contract_id,started_at")
      .single();
    if (error && error.code !== "23505")
      toast.error("Não foi possível registrar o acompanhamento.");
    else {
      const { data, error: readError } = await db
        .from("contract_renewal_followups")
        .select("contract_id,started_at")
        .eq("tenant_id", tenantId)
        .eq("contract_id", contractId)
        .single();
      if (readError || !data)
        toast.error("Não foi possível confirmar o registro. Atualize a página.");
      else {
        setState((old) =>
          old?.tenantId === tenantId
            ? { ...old, rows: [...old.rows.filter((r) => r.contract_id !== contractId), data] }
            : old,
        );
        toast.success("Acompanhamento registrado.");
        window.dispatchEvent(new Event("primus:renewal-followup"));
      }
    }
    setBusy(null);
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Central de renovações</h2>
        <p className="text-sm text-muted-foreground">
          Planeje providências para instrumentos vigentes com até 120 dias restantes. Acompanhar não
          autoriza nem prorroga a vigência.
        </p>
      </div>
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        Nos contratos regidos pela Lei nº 14.133/2021, a prorrogação do art. 107 exige serviço ou
        fornecimento contínuo, previsão no edital e demonstração de vantagem. Contratos por escopo
        (art. 111) e atas de registro de preços seguem regras próprias. A minuta é apenas um
        rascunho: não altera a vigência nem registra o aditivo.
      </p>
      {!current ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          {current.failed && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível confirmar todos os acompanhamentos ou permissões.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "Todos", eligible.length],
                [
                  "pending",
                  "Sem registro",
                  eligible.filter((c) => !recorded.has(c.id) && diasAte(c.end_date) >= 0).length,
                ],
                ["recorded", "Registrados", eligible.filter((c) => recorded.has(c.id)).length],
                ["overdue", "Vencidos", eligible.filter((c) => diasAte(c.end_date) < 0).length],
              ] as const
            ).map(([value, label, count]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                onClick={() => setFilter(value)}
              >
                {label}
                {current.failed && (value === "pending" || value === "recorded")
                  ? ""
                  : ` (${count})`}
              </Button>
            ))}
          </div>
          {!visible.length && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Nenhum instrumento corresponde aos filtros.
              </CardContent>
            </Card>
          )}
          {visible.map((c) => {
            const days = diasAte(c.end_date);
            const followup = recorded.get(c.id);
            return (
              <Card key={c.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {c.instrument_type === "ata_registro_precos" ? "Ata" : "Contrato"}{" "}
                        {c.number}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {props.supplierName(c.supplier_id)} · {c.object}
                      </p>
                    </div>
                    <Badge variant={days < 30 ? "destructive" : "outline"}>
                      <CalendarClock className="mr-1 h-3.5 w-3.5" />
                      {days < 0 ? `Vencido há ${-days} dias` : `${days} dias restantes`}
                    </Badge>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <span>Vigência: {formatarData(c.end_date)}</span>
                    <span>Valor: {formatarMoeda(Number(c.total_value))}</span>
                    <span>Gestor: {c.manager_name || "Não designado"}</span>
                    <span>Fiscal: {c.inspector_name || "Não designado"}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {followup
                      ? `Acompanhamento registrado em ${formatarData(followup.started_at.slice(0, 10))}. Confira se corresponde à vigência atual.`
                      : current.failed
                        ? "Estado não confirmado."
                        : "Sem acompanhamento registrado."}
                  </p>
                  <p className="rounded-md bg-muted/40 p-2 text-sm">
                    {days < 0
                      ? "Vigência encerrada pelo calendário: encaminhe a situação para análise do gestor."
                      : "Verifique a previsão contratual, vantajosidade, disponibilidade orçamentária e autorização antes da formalização."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {days >= 0 && c.instrument_type === "contrato" && current.canCreate && (
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`/documentos?contrato=${encodeURIComponent(c.id)}&modelo=ADITIVO_PRORROGACAO_CONTINUO`}
                        >
                          <FileText className="h-4 w-4" /> Preparar minuta (se cabível)
                        </a>
                      </Button>
                    )}
                    {!followup && days >= 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!current.canEdit || current.failed || !!busy}
                        onClick={() => void start(c.id)}
                      >
                        {busy === c.id ? "Registrando…" : "Iniciar acompanhamento"}
                      </Button>
                    )}
                    {days >= 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!current.canEdit || current.failed}
                        onClick={() => props.onAmendment(c.id)}
                      >
                        <FilePlus2 className="h-4 w-4" /> Registrar aditivo formalizado
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </section>
  );
}
