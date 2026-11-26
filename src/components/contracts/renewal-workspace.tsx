import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  FilePlus2,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { AssigneeSelect, useAssignees } from "@/components/assignee-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { diasAte, formatarData, formatarMoeda } from "@/lib/contratacao";
import { calcularVariacaoPrecoPercentual, podeUsarMinutaProrrogacao } from "@/lib/contract-renewal";
import {
  calcularNovaDataVigencia,
  identificarMesesVigencia,
} from "@/lib/contract-extension-helper";
import { registrarVerificacaoRegularidade } from "@/lib/supplier-regularity";
import { consultarRegularidadeAutomatica } from "@/lib/supplier-regularity-lookup";
import type { Json, Tables } from "@/integrations/supabase/types";

type Followup = Pick<Tables<"contract_renewal_followups">, "contract_id" | "started_at">;
type Assessment = Tables<"contract_renewal_assessments">;
type ChecklistItem = Tables<"contract_renewal_checklist_items">;
type Contract = Pick<
  Tables<"contracts">,
  | "id"
  | "number"
  | "object"
  | "start_date"
  | "end_date"
  | "status"
  | "total_value"
  | "manager_name"
  | "inspector_name"
  | "supplier_id"
  | "instrument_type"
>;

type AssessmentForm = {
  legal_regime: string;
  contract_nature: string;
  legal_basis: string;
  edital_allows_extension: boolean;
  contract_allows_extension: boolean;
  continuity_justification: string;
  public_interest_justification: string;
  execution_report: string;
  vantajosidade_method: string;
  current_period_value: string;
  market_reference_value: string;
  reference_source: string;
  reference_date: string;
  comparison_basis: string;
  price_analysis: string;
  price_advantage_attested: boolean;
  supplier_agreed: boolean;
  habilitation_confirmed: boolean;
  budget_confirmed: boolean;
  authority_approved: boolean;
  legal_review_status: string;
  legal_review_reference: string;
  accumulated_months: string;
  proposed_months: string;
  proposed_start_date: string;
  proposed_end_date: string;
  notes: string;
};

type Validation = { can_generate: boolean; blockers: string[] };

type WorkspaceState = {
  tenantId: string;
  rows: Followup[];
  assessments: Assessment[];
  checklist: ChecklistItem[];
  canEdit: boolean;
  canCreate: boolean;
  failed: boolean;
  schemaReady: boolean;
};

const LEGAL_REGIMES = [
  ["lei_14133", "Lei nº 14.133/2021"],
  ["lei_8666", "Lei nº 8.666/1993"],
  ["lei_13303", "Lei nº 13.303/2016"],
  ["special", "Regime especial / legislação própria"],
  ["not_identified", "Ainda não identificado"],
] as const;

const CONTRACT_NATURES = [
  ["continuous_service", "Serviço contínuo"],
  ["continuous_supply", "Fornecimento contínuo"],
  ["scope", "Contrato por escopo"],
  ["ata", "Ata de registro de preços"],
  ["special", "Regime ou instrumento especial"],
  ["other", "Outra natureza"],
  ["unclassified", "Ainda não classificado"],
] as const;

const METHOD_OPTIONS = [
  ["price_research", "Pesquisa de preços de mercado"],
  ["official_panel", "Painel ou base oficial de preços"],
  ["negotiation", "Negociação com a contratada"],
  ["index", "Índice contratual / metodologia prevista no ajuste"],
  ["other", "Outra metodologia fundamentada"],
] as const;

function dataSeguinte(data: string): string {
  const date = new Date(`${data}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function novoFormulario(contract: Contract, assessment?: Assessment): AssessmentForm {
  return {
    legal_regime: assessment?.legal_regime ?? "not_identified",
    contract_nature: assessment?.contract_nature ?? "unclassified",
    legal_basis: assessment?.legal_basis ?? "",
    edital_allows_extension: assessment?.edital_allows_extension ?? false,
    contract_allows_extension: assessment?.contract_allows_extension ?? false,
    continuity_justification: assessment?.continuity_justification ?? "",
    public_interest_justification: assessment?.public_interest_justification ?? "",
    execution_report: assessment?.execution_report ?? "",
    vantajosidade_method: assessment?.vantajosidade_method ?? "",
    current_period_value:
      assessment?.current_period_value === null || assessment?.current_period_value === undefined
        ? ""
        : String(assessment.current_period_value),
    market_reference_value:
      assessment?.market_reference_value === null ||
      assessment?.market_reference_value === undefined
        ? ""
        : String(assessment.market_reference_value),
    reference_source: assessment?.reference_source ?? "",
    reference_date: assessment?.reference_date ?? "",
    comparison_basis: assessment?.comparison_basis ?? "",
    price_analysis: assessment?.price_analysis ?? "",
    price_advantage_attested: assessment?.price_advantage_attested ?? false,
    supplier_agreed: assessment?.supplier_agreed ?? false,
    habilitation_confirmed: assessment?.habilitation_confirmed ?? false,
    budget_confirmed: assessment?.budget_confirmed ?? false,
    authority_approved: assessment?.authority_approved ?? false,
    legal_review_status: assessment?.legal_review_status ?? "pending",
    legal_review_reference: assessment?.legal_review_reference ?? "",
    accumulated_months:
      assessment?.accumulated_months === null || assessment?.accumulated_months === undefined
        ? ""
        : String(assessment.accumulated_months),
    proposed_months:
      assessment?.proposed_months === null || assessment?.proposed_months === undefined
        ? ""
        : String(assessment.proposed_months),
    proposed_start_date: assessment?.proposed_start_date ?? dataSeguinte(contract.end_date),
    proposed_end_date: assessment?.proposed_end_date ?? "",
    notes: assessment?.notes ?? "",
  };
}

function rotuloNatureza(value: string): string {
  return CONTRACT_NATURES.find(([key]) => key === value)?.[1] ?? "Não classificado";
}

function statusChecklist(status: string): string {
  if (status === "completed") return "Concluída";
  if (status === "in_progress") return "Em andamento";
  if (status === "not_applicable") return "Não aplicável";
  return "Pendente";
}

export function RenewalWorkspace(props: {
  tenantId: string;
  userId: string;
  contracts: Contract[];
  supplierName: (id: string | null) => string;
  supplierCnpj?: (id: string | null) => string | undefined;
  onAmendment: (id: string) => void;
}) {
  const { tenantId, userId } = props;
  const members = useAssignees(tenantId);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "recorded" | "overdue">("all");
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [form, setForm] = useState<AssessmentForm | null>(null);
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [checkingRegularity, setCheckingRegularity] = useState(false);
  const [regularityAlert, setRegularityAlert] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [validations, setValidations] = useState<Record<string, Validation>>({});

  const load = useCallback(async () => {
    let active = true;
    setState((old) => (old?.tenantId === tenantId ? { ...old, failed: false } : null));
    const [followups, capabilities, assessments, checklist] = await Promise.allSettled([
      carregarTodasAsPaginas<Followup>((start, end) =>
        db
          .from("contract_renewal_followups")
          .select("contract_id,started_at")
          .eq("tenant_id", tenantId)
          .order("contract_id")
          .range(start, end),
      ),
      db.rpc("get_document_capabilities", { p_tenant_id: tenantId }),
      carregarTodasAsPaginas<Assessment>((start, end) =>
        db
          .from("contract_renewal_assessments")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("contract_id")
          .range(start, end),
      ),
      carregarTodasAsPaginas<ChecklistItem>((start, end) =>
        db
          .from("contract_renewal_checklist_items")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("title")
          .range(start, end),
      ),
    ]);
    active = false;
    void active;

    const capability =
      capabilities.status === "fulfilled" && !capabilities.value.error
        ? capabilities.value.data?.[0]
        : undefined;
    setState({
      tenantId,
      rows: followups.status === "fulfilled" ? followups.value : [],
      assessments: assessments.status === "fulfilled" ? assessments.value : [],
      checklist: checklist.status === "fulfilled" ? checklist.value : [],
      canEdit: capability?.can_update === true,
      canCreate: capability?.can_create === true,
      failed:
        followups.status === "rejected" ||
        capabilities.status === "rejected" ||
        !!(capabilities.status === "fulfilled" && capabilities.value.error),
      schemaReady: assessments.status === "fulfilled" && checklist.status === "fulfilled",
    });
  }, [tenantId]);

  useEffect(() => {
    setState(null);
    setFilter("all");
    setBusy(null);
    setTaskBusy(null);
    setExpanded({});
    setValidations({});
    void load();
  }, [load]);

  useEffect(() => {
    setRegularityAlert(null);
  }, [editingContract?.id]);

  const current = state?.tenantId === tenantId ? state : null;
  const recorded = useMemo(
    () => new Map(current?.rows.map((row) => [row.contract_id, row]) ?? []),
    [current?.rows],
  );
  const assessmentByContract = useMemo(
    () => new Map(current?.assessments.map((row) => [row.contract_id, row]) ?? []),
    [current?.assessments],
  );
  const checklistByContract = useMemo(() => {
    const result = new Map<string, ChecklistItem[]>();
    for (const item of current?.checklist ?? []) {
      const items = result.get(item.contract_id) ?? [];
      items.push(item);
      result.set(item.contract_id, items);
    }
    return result;
  }, [current?.checklist]);

  const eligible = props.contracts
    .filter((contract) => contract.status === "vigente" && diasAte(contract.end_date) <= 120)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const visible = eligible.filter(
    (contract) =>
      filter === "all" ||
      (filter === "pending" && !recorded.has(contract.id) && diasAte(contract.end_date) >= 0) ||
      (filter === "recorded" && recorded.has(contract.id)) ||
      (filter === "overdue" && diasAte(contract.end_date) < 0),
  );

  async function start(contractId: string) {
    if (!current?.canEdit || current.failed || !userId || busy || recorded.has(contractId)) return;
    setBusy(contractId);
    try {
      const { error } = await db
        .from("contract_renewal_followups")
        .insert({ tenant_id: tenantId, contract_id: contractId, started_by: userId })
        .select("contract_id,started_at")
        .single();
      if (error && error.code !== "23505") {
        toast.error("Não foi possível registrar o acompanhamento.");
        return;
      }
      const { data, error: readError } = await db
        .from("contract_renewal_followups")
        .select("contract_id,started_at")
        .eq("tenant_id", tenantId)
        .eq("contract_id", contractId)
        .single();
      if (readError || !data) {
        toast.error("Não foi possível confirmar o registro. Atualize a página.");
        return;
      }
      setState((old) =>
        old?.tenantId === tenantId
          ? {
              ...old,
              rows: [...old.rows.filter((row) => row.contract_id !== contractId), data],
            }
          : old,
      );
      toast.success("Acompanhamento registrado.");
      window.dispatchEvent(new Event("primus:renewal-followup"));
    } finally {
      setBusy(null);
    }
  }

  function openAssessment(contract: Contract) {
    const assessment = assessmentByContract.get(contract.id);
    setForm(novoFormulario(contract, assessment));
    setEditingContract(contract);
  }

  function updateForm<K extends keyof AssessmentForm>(key: K, value: AssessmentForm[K]) {
    setForm((old) => (old ? { ...old, [key]: value } : old));
  }

  async function saveAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingContract || !form || !current?.canEdit || savingAssessment) return;
    setSavingAssessment(true);
    const payload: Json = {
      ...form,
      current_period_value: form.current_period_value || null,
      market_reference_value: form.market_reference_value || null,
      accumulated_months: form.accumulated_months || null,
      proposed_months: form.proposed_months || null,
      reference_date: form.reference_date || null,
      proposed_start_date: form.proposed_start_date || null,
      proposed_end_date: form.proposed_end_date || null,
    };
    try {
      const { error } = await db.rpc("save_contract_renewal_assessment", {
        p_tenant_id: tenantId,
        p_contract_id: editingContract.id,
        p_payload: payload,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Análise de renovação salva. O checklist documental foi preparado.");
      setEditingContract(null);
      setForm(null);
      setValidations((old) => {
        const next = { ...old };
        delete next[editingContract.id];
        return next;
      });
      await load();
    } finally {
      setSavingAssessment(false);
    }
  }

  function updateChecklistItem(itemId: string, patch: Partial<ChecklistItem>) {
    setState((old) =>
      old?.tenantId === tenantId
        ? {
            ...old,
            checklist: old.checklist.map((item) =>
              item.id === itemId ? { ...item, ...patch } : item,
            ),
          }
        : old,
    );
  }

  async function saveChecklistItem(item: ChecklistItem) {
    if (!current?.canEdit || taskBusy) return;
    setTaskBusy(item.id);
    try {
      const { error } = await db.rpc("save_contract_renewal_checklist_item", {
        p_tenant_id: tenantId,
        p_contract_id: item.contract_id,
        p_item_key: item.item_key,
        ...(item.assigned_user_id ? { p_assigned_user_id: item.assigned_user_id } : {}),
        ...(item.due_date ? { p_due_date: item.due_date } : {}),
        p_status: item.status,
        ...(item.evidence_reference ? { p_evidence_reference: item.evidence_reference } : {}),
        ...(item.notes ? { p_notes: item.notes } : {}),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Providência do checklist atualizada.");
      await load();
    } finally {
      setTaskBusy(null);
    }
  }

  async function validate(contractId: string) {
    const { data, error } = await db.rpc("validate_contract_renewal_addendum", {
      p_tenant_id: tenantId,
      p_contract_id: contractId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data?.[0];
    if (!result) {
      toast.error("O servidor não retornou o resultado da validação.");
      return;
    }
    setValidations((old) => ({ ...old, [contractId]: result }));
    if (result.can_generate) {
      toast.success("Requisitos conferidos. A minuta pode ser preparada como rascunho.");
    } else {
      toast.warning(`${result.blockers.length} requisito(s) ainda precisam ser resolvidos.`);
    }
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

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        Na Lei nº 14.133/2021, o art. 107 trata de serviços e fornecimentos contínuos, com previsão
        no edital e vantagem atestada pela autoridade competente, observado o limite decenal.
        Contratos por escopo (art. 111), atas e regimes especiais exigem análise própria. A minuta
        nunca prorroga o contrato: é apenas um rascunho sujeito à revisão e assinatura.
      </div>

      {!current ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          {current.failed && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível confirmar todos os acompanhamentos ou permissões.
            </p>
          )}
          {!current.schemaReady && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A análise jurídica estruturada e o checklist documental ainda aguardam a habilitação
                da nova estrutura neste ambiente. O acompanhamento básico continua disponível.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "Todos", eligible.length],
                [
                  "pending",
                  "Sem registro",
                  eligible.filter(
                    (contract) => !recorded.has(contract.id) && diasAte(contract.end_date) >= 0,
                  ).length,
                ],
                [
                  "recorded",
                  "Registrados",
                  eligible.filter((contract) => recorded.has(contract.id)).length,
                ],
                [
                  "overdue",
                  "Vencidos",
                  eligible.filter((contract) => diasAte(contract.end_date) < 0).length,
                ],
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

          {visible.map((contract) => {
            const days = diasAte(contract.end_date);
            const followup = recorded.get(contract.id);
            const assessment = assessmentByContract.get(contract.id);
            const checklist = checklistByContract.get(contract.id) ?? [];
            const validation = validations[contract.id];
            const requiredCount = checklist.filter((item) => item.is_required).length;
            const completedCount = checklist.filter(
              (item) =>
                item.is_required &&
                (item.status === "completed" ||
                  (item.item_key === "parecer_juridico" &&
                    item.status === "not_applicable" &&
                    !!item.evidence_reference?.trim())),
            ).length;
            const canUseTemplate =
              contract.instrument_type === "contrato" &&
              !!assessment &&
              podeUsarMinutaProrrogacao(
                contract.instrument_type,
                assessment.legal_regime as Parameters<typeof podeUsarMinutaProrrogacao>[1],
                assessment.contract_nature as Parameters<typeof podeUsarMinutaProrrogacao>[2],
              );

            return (
              <Card key={contract.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {contract.instrument_type === "ata_registro_precos" ? "Ata" : "Contrato"}{" "}
                        {contract.number}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {props.supplierName(contract.supplier_id)} · {contract.object}
                      </p>
                    </div>
                    <Badge variant={days < 30 ? "destructive" : "outline"}>
                      <CalendarClock className="mr-1 h-3.5 w-3.5" />
                      {days < 0 ? `Vencido há ${-days} dias` : `${days} dias restantes`}
                    </Badge>
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <span>Vigência: {formatarData(contract.end_date)}</span>
                    <span>Valor cadastrado: {formatarMoeda(Number(contract.total_value))}</span>
                    <span>Gestor: {contract.manager_name || "Não designado"}</span>
                    <span>Fiscal: {contract.inspector_name || "Não designado"}</span>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {followup
                      ? `Acompanhamento registrado em ${formatarData(followup.started_at.slice(0, 10))}.`
                      : "Sem acompanhamento registrado."}
                  </p>

                  {contract.instrument_type === "ata_registro_precos" ? (
                    <div className="space-y-2">
                      <p className="rounded-md bg-muted/50 p-2 text-sm">
                        Ata de registro de preços (art. 84 da Lei nº 14.133/2021): vigência de 1
                        ano, prorrogável por igual período (máximo total de 24 meses a contar de{" "}
                        {formatarData(contract.start_date)}), desde que comprovado o preço vantajoso
                        e formalizada antes do vencimento.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {days >= 0 && !followup && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!current.canEdit || current.failed || !!busy}
                            onClick={() => void start(contract.id)}
                          >
                            {busy === contract.id ? "Registrando…" : "Iniciar acompanhamento"}
                          </Button>
                        )}
                        {days >= 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!current.canEdit || current.failed}
                            onClick={() => props.onAmendment(contract.id)}
                          >
                            <FilePlus2 className="h-4 w-4" />
                            Registrar prorrogação da Ata
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {current.schemaReady && assessment && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">
                                Classificação e instrução jurídica
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {LEGAL_REGIMES.find(
                                  ([key]) => key === assessment.legal_regime,
                                )?.[1] ?? assessment.legal_regime}
                                {" · "}
                                {rotuloNatureza(assessment.contract_nature)}
                              </p>
                            </div>
                            <Badge variant={canUseTemplate ? "secondary" : "outline"}>
                              {canUseTemplate ? "Candidato ao art. 107" : "Exige análise própria"}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span>
                              Checklist: {completedCount}/{requiredCount || 11} providências
                              concluídas
                            </span>
                            <span>·</span>
                            <span>
                              Vantajosidade:{" "}
                              {assessment.price_advantage_attested ? "Atestada" : "Pendente"}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {current.schemaReady && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!current.canEdit || days < 0}
                            onClick={() => openAssessment(contract)}
                          >
                            <ShieldCheck className="h-4 w-4" />
                            {assessment ? "Editar análise de renovação" : "Classificar e instruir"}
                          </Button>
                        )}
                        {current.schemaReady && assessment && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setExpanded((old) => ({ ...old, [contract.id]: !old[contract.id] }))
                            }
                            aria-expanded={expanded[contract.id] === true}
                          >
                            <FileText className="h-4 w-4" />
                            {expanded[contract.id] ? "Ocultar checklist" : "Checklist documental"}
                          </Button>
                        )}
                        {current.schemaReady && assessment && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={days < 0}
                            onClick={() => void validate(contract.id)}
                          >
                            <ShieldCheck className="h-4 w-4" />
                            Verificar requisitos
                          </Button>
                        )}
                        {validation?.can_generate && current.canCreate && (
                          <Button size="sm" asChild>
                            <a
                              href={`/documentos?contrato=${encodeURIComponent(contract.id)}&modelo=ADITIVO_PRORROGACAO_CONTINUO`}
                            >
                              <FilePlus2 className="h-4 w-4" />
                              Preparar minuta
                            </a>
                          </Button>
                        )}
                        {days >= 0 && !followup && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!current.canEdit || current.failed || !!busy}
                            onClick={() => void start(contract.id)}
                          >
                            {busy === contract.id ? "Registrando…" : "Iniciar acompanhamento"}
                          </Button>
                        )}
                        {days >= 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!current.canEdit || current.failed}
                            onClick={() => props.onAmendment(contract.id)}
                          >
                            <FilePlus2 className="h-4 w-4" />
                            Registrar aditivo formalizado
                          </Button>
                        )}
                      </div>

                      {validation && !validation.can_generate && (
                        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                          <p className="font-medium">A minuta permanece bloqueada pelo servidor</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {validation.blockers.map((blocker) => (
                              <li key={blocker}>{blocker}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {expanded[contract.id] && (
                        <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                          <div>
                            <p className="font-medium">
                              Checklist documental com responsáveis e prazos
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Concluir uma etapa exige registrar a referência do documento ou
                              evidência. Atribuições aparecem automaticamente na Central de Tarefas
                              do responsável.
                            </p>
                          </div>
                          {checklist.map((item) => (
                            <div
                              key={item.id}
                              className="space-y-2 rounded-md border bg-background p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium">{item.title}</p>
                                <Badge
                                  variant={item.status === "completed" ? "secondary" : "outline"}
                                >
                                  {statusChecklist(item.status)}
                                </Badge>
                              </div>
                              <div className="grid gap-2 md:grid-cols-2">
                                <div className="space-y-1">
                                  <Label>Responsável</Label>
                                  <AssigneeSelect
                                    members={members}
                                    value={item.assigned_user_id}
                                    label={`Responsável: ${item.title}`}
                                    onChange={(value) =>
                                      updateChecklistItem(item.id, {
                                        assigned_user_id: value || null,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>Prazo</Label>
                                  <Input
                                    type="date"
                                    value={item.due_date ?? ""}
                                    onChange={(event) =>
                                      updateChecklistItem(item.id, {
                                        due_date: event.target.value || null,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>Situação</Label>
                                  <Select
                                    value={item.status}
                                    onValueChange={(value) =>
                                      updateChecklistItem(item.id, { status: value })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="pending">Pendente</SelectItem>
                                      <SelectItem value="in_progress">Em andamento</SelectItem>
                                      <SelectItem value="completed">Concluída</SelectItem>
                                      {item.item_key === "parecer_juridico" && (
                                        <SelectItem value="not_applicable">
                                          Não aplicável
                                        </SelectItem>
                                      )}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label>Referência da evidência</Label>
                                  <Input
                                    value={item.evidence_reference ?? ""}
                                    placeholder="Arquivo, número do processo ou documento"
                                    onChange={(event) =>
                                      updateChecklistItem(item.id, {
                                        evidence_reference: event.target.value || null,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label>Observações</Label>
                                <Textarea
                                  rows={2}
                                  value={item.notes ?? ""}
                                  onChange={(event) =>
                                    updateChecklistItem(item.id, {
                                      notes: event.target.value || null,
                                    })
                                  }
                                />
                              </div>
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!current.canEdit || taskBusy === item.id}
                                  onClick={() => void saveChecklistItem(item)}
                                >
                                  {taskBusy === item.id ? "Salvando…" : "Salvar providência"}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <p className="rounded-md bg-muted/40 p-2 text-sm">
                    {days < 0
                      ? "A vigência cadastrada terminou: não gere minuta retroativa. Encaminhe a situação para análise jurídica e administrativa."
                      : "A prorrogação depende de instrução, decisão da autoridade competente e formalização antes do fim da vigência. O acompanhamento não substitui esses atos."}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}

      <Dialog
        open={!!editingContract && !!form}
        onOpenChange={(open) => {
          if (!open && !savingAssessment) {
            setEditingContract(null);
            setForm(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Análise de renovação — Contrato {editingContract?.number ?? ""}
            </DialogTitle>
          </DialogHeader>
          {editingContract && form && (
            <form className="space-y-5" onSubmit={(event) => void saveAssessment(event)}>
              <section className="space-y-3">
                <h3 className="font-semibold">1. Classificação jurídica</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Regime jurídico</Label>
                    <Select
                      value={form.legal_regime}
                      onValueChange={(value) => updateForm("legal_regime", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEGAL_REGIMES.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Natureza do objeto</Label>
                    <Select
                      value={form.contract_nature}
                      onValueChange={(value) => updateForm("contract_nature", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTRACT_NATURES.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Fundamento legal e cláusula aplicável</Label>
                    <Input
                      value={form.legal_basis}
                      onChange={(event) => updateForm("legal_basis", event.target.value)}
                      placeholder="Ex.: art. 107 da Lei nº 14.133/2021 e cláusula X do contrato"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Prazo acumulado até a vigência atual (meses)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="120"
                      value={form.accumulated_months}
                      onChange={(event) => updateForm("accumulated_months", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Período proposto (meses)</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        type="number"
                        min="1"
                        max="120"
                        className="flex-1"
                        value={form.proposed_months}
                        onChange={(event) => {
                          const raw = event.target.value;
                          const months = Number.parseInt(raw, 10);
                          if (
                            Number.isInteger(months) &&
                            months >= 1 &&
                            months <= 120 &&
                            editingContract
                          ) {
                            setForm((old) =>
                              old
                                ? {
                                    ...old,
                                    proposed_months: raw,
                                    proposed_start_date: dataSeguinte(editingContract.end_date),
                                    proposed_end_date: calcularNovaDataVigencia(
                                      editingContract.end_date,
                                      months,
                                    ),
                                  }
                                : old,
                            );
                          } else {
                            updateForm("proposed_months", raw);
                          }
                        }}
                      />
                      {[6, 12].map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={form.proposed_months === String(preset) ? "default" : "outline"}
                          onClick={() => {
                            if (!editingContract) return;
                            setForm((old) =>
                              old
                                ? {
                                    ...old,
                                    proposed_months: String(preset),
                                    proposed_start_date: dataSeguinte(editingContract.end_date),
                                    proposed_end_date: calcularNovaDataVigencia(
                                      editingContract.end_date,
                                      preset,
                                    ),
                                  }
                                : old,
                            );
                          }}
                        >
                          +{preset}m
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Início proposto</Label>
                    <Input
                      type="date"
                      value={form.proposed_start_date}
                      onChange={(event) => updateForm("proposed_start_date", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Término proposto</Label>
                    <Input
                      type="date"
                      value={form.proposed_end_date}
                      onChange={(event) => {
                        const novaDataFim = event.target.value;
                        const mesesCalculados = editingContract
                          ? identificarMesesVigencia(editingContract.end_date, novaDataFim)
                          : null;
                        setForm((old) =>
                          old
                            ? {
                                ...old,
                                proposed_end_date: novaDataFim,
                                ...(mesesCalculados !== null
                                  ? {
                                      proposed_months: String(mesesCalculados),
                                      proposed_start_date: dataSeguinte(editingContract.end_date),
                                    }
                                  : {}),
                              }
                            : old,
                        );
                      }}
                    />
                  </div>
                </div>
                {(() => {
                  const acc = Number.parseInt(form.accumulated_months, 10);
                  const prop = Number.parseInt(form.proposed_months, 10);
                  if (Number.isInteger(acc) && Number.isInteger(prop) && acc + prop > 120) {
                    return (
                      <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                        Atenção: o prazo acumulado ({acc} meses) somado ao proposto ({prop} meses)
                        atinge {acc + prop} meses e ultrapassa o limite decenal de 120 meses (art.
                        107 da Lei nº 14.133/2021).
                      </p>
                    );
                  }
                  return null;
                })()}
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.edital_allows_extension}
                      onChange={(event) =>
                        updateForm("edital_allows_extension", event.target.checked)
                      }
                    />
                    O edital prevê a prorrogação
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.contract_allows_extension}
                      onChange={(event) =>
                        updateForm("contract_allows_extension", event.target.checked)
                      }
                    />
                    O contrato contém cláusula de prorrogação
                  </label>
                </div>
                {!podeUsarMinutaProrrogacao(
                  editingContract.instrument_type,
                  form.legal_regime as Parameters<typeof podeUsarMinutaProrrogacao>[1],
                  form.contract_nature as Parameters<typeof podeUsarMinutaProrrogacao>[2],
                ) && (
                  <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
                    A minuta automatizada disponível é exclusiva para contratos de serviços ou
                    fornecimentos contínuos regidos pela Lei nº 14.133/2021. Esta classificação não
                    autoriza o uso do modelo; encaminhe o caso ao fluxo jurídico adequado.
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">2. Justificativas e execução</h3>
                <div className="space-y-1">
                  <Label>Justificativa da natureza contínua</Label>
                  <Textarea
                    rows={3}
                    value={form.continuity_justification}
                    onChange={(event) => updateForm("continuity_justification", event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Interesse público na continuidade</Label>
                  <Textarea
                    rows={3}
                    value={form.public_interest_justification}
                    onChange={(event) =>
                      updateForm("public_interest_justification", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Relatório de execução e fiscalização</Label>
                  <Textarea
                    rows={3}
                    value={form.execution_report}
                    onChange={(event) => updateForm("execution_report", event.target.value)}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">3. Comparativo estruturado de vantajosidade</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Metodologia</Label>
                    <Select
                      value={form.vantajosidade_method || "none"}
                      onValueChange={(value) =>
                        updateForm("vantajosidade_method", value === "none" ? "" : value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a metodologia" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Selecione a metodologia</SelectItem>
                        {METHOD_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Base de comparação</Label>
                    <Input
                      value={form.comparison_basis}
                      onChange={(event) => updateForm("comparison_basis", event.target.value)}
                      placeholder="Ex.: mensal, anual, mesma cesta e especificação"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Valor contratado na base comparável (R$)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.current_period_value}
                      onChange={(event) => updateForm("current_period_value", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Valor de referência de mercado (R$)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.market_reference_value}
                      onChange={(event) => updateForm("market_reference_value", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Fonte da referência</Label>
                    <Input
                      value={form.reference_source}
                      onChange={(event) => updateForm("reference_source", event.target.value)}
                      placeholder="Fonte, pesquisa, painel, índice ou negociação"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Data da referência</Label>
                    <Input
                      type="date"
                      value={form.reference_date}
                      onChange={(event) => updateForm("reference_date", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Análise qualitativa e econômica</Label>
                    <Textarea
                      rows={3}
                      value={form.price_analysis}
                      onChange={(event) => updateForm("price_analysis", event.target.value)}
                      placeholder="Considere preço, qualidade, desempenho, custos de transição e custo de uma nova contratação."
                    />
                  </div>
                </div>
                {(() => {
                  const variation = calcularVariacaoPrecoPercentual(
                    form.current_period_value ? Number(form.current_period_value) : null,
                    form.market_reference_value ? Number(form.market_reference_value) : null,
                  );
                  if (variation === null) return null;
                  return (
                    <p className="rounded-md bg-muted p-2 text-sm">
                      Variação do preço contratado em relação à referência:{" "}
                      <strong>
                        {Math.abs(variation).toLocaleString("pt-BR", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        % {variation > 0 ? "acima" : variation < 0 ? "abaixo" : "igual"}
                      </strong>
                      . Esse indicador não decide a vantajosidade automaticamente.
                    </p>
                  );
                })()}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.price_advantage_attested}
                    onChange={(event) =>
                      updateForm("price_advantage_attested", event.target.checked)
                    }
                  />
                  A análise fundamenta e atesta a vantagem para a Administração
                </label>
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">4. Condições, anuências e autorizações</h3>
                  {editingContract.supplier_id && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={checkingRegularity || !current?.canEdit}
                      onClick={async () => {
                        if (!editingContract.supplier_id) return;
                        setCheckingRegularity(true);
                        setRegularityAlert(null);
                        try {
                          let rawCnpj = props.supplierCnpj?.(editingContract.supplier_id) ?? "";
                          if (!rawCnpj) {
                            const { data: sup } = await db
                              .from("suppliers")
                              .select("cnpj")
                              .eq("id", editingContract.supplier_id)
                              .eq("tenant_id", tenantId)
                              .maybeSingle();
                            rawCnpj = sup?.cnpj ?? "";
                          }
                          const cleanCnpj = rawCnpj.replace(/\D/g, "");
                          if (cleanCnpj.length !== 14) {
                            toast.error(
                              "Fornecedor sem CNPJ de 14 dígitos para consulta automática.",
                            );
                            return;
                          }
                          const res = await consultarRegularidadeAutomatica({
                            tenantId,
                            cnpj: cleanCnpj,
                          });
                          if (res.checks.length === 0) {
                            toast.warning(res.warnings[0] || "Nenhuma certidão retornada.");
                            return;
                          }
                          await Promise.all(
                            res.checks.map((item) =>
                              registrarVerificacaoRegularidade({
                                tenantId,
                                supplierId: editingContract.supplier_id!,
                                source: item.source,
                                sourceLabel: item.sourceLabel,
                                status: item.status,
                                certificateNumber: item.certificateNumber ?? undefined,
                                evidenceUrl: item.evidenceUrl ?? undefined,
                                notes: `Pré-checagem de prorrogação (art. 91, § 4º) · ${item.notes}`,
                                requiresAction: item.requiresAction,
                              }),
                            ),
                          );
                          const blockers = res.checks.filter((c) => c.status !== "regular");
                          if (blockers.length === 0) {
                            updateForm("habilitation_confirmed", true);
                            const msg = `Idoneidade e situação cadastral regularizadas em ${res.checks.length} fonte(s) (TCU, CNJ, CEIS, CNEP e RFB).`;
                            setRegularityAlert({ ok: true, message: msg });
                            toast.success(msg);
                          } else {
                            updateForm("habilitation_confirmed", false);
                            const msg = `Atenção (art. 91, § 4º): ${blockers.map((b) => `${b.sourceLabel}: ${b.rawSituation}`).join("; ")}.`;
                            setRegularityAlert({ ok: false, message: msg });
                            toast.error(msg);
                          }
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Não foi possível consultar TCU/CEIS/RFB.",
                          );
                        } finally {
                          setCheckingRegularity(false);
                        }
                      }}
                    >
                      <Sparkles
                        className={`mr-1.5 h-3.5 w-3.5 ${checkingRegularity ? "animate-pulse" : ""}`}
                      />
                      {checkingRegularity
                        ? "Consultando TCU/CEIS/RFB..."
                        : "Verificar TCU / CEIS / CNEP / RFB"}
                    </Button>
                  )}
                </div>
                {regularityAlert && (
                  <div
                    className={`rounded-md border p-2.5 text-xs ${
                      regularityAlert.ok
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                        : "border-destructive/50 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {regularityAlert.message}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["supplier_agreed", "A contratada manifestou concordância expressa"],
                      ["habilitation_confirmed", "Habilitação e regularidade foram conferidas"],
                      ["budget_confirmed", "Há créditos e disponibilidade orçamentária"],
                      ["authority_approved", "A autoridade competente autorizou previamente"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(event) => updateForm(key, event.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Situação da análise jurídica</Label>
                    <Select
                      value={form.legal_review_status}
                      onValueChange={(value) => updateForm("legal_review_status", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="approved">Parecer aprovado / juntado</SelectItem>
                        <SelectItem value="not_required">
                          Parecer individualizado não exigido
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>
                      {form.legal_review_status === "not_required"
                        ? "Fundamento da não exigência individualizada"
                        : "Referência do parecer / manifestação jurídica"}
                    </Label>
                    <Input
                      value={form.legal_review_reference}
                      onChange={(event) => updateForm("legal_review_reference", event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Observações adicionais</Label>
                  <Textarea
                    rows={2}
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                  />
                </div>
              </section>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingAssessment}
                  onClick={() => {
                    setEditingContract(null);
                    setForm(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={savingAssessment || !current?.canEdit}>
                  {savingAssessment ? "Salvando análise…" : "Salvar análise e gerar checklist"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
