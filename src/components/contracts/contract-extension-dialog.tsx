import { useEffect, useRef, useState } from "react";
import { CalendarClock, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { db } from "@/lib/db";
import {
  calcularNovaDataVigencia,
  gerarJustificativaProrrogacao,
  identificarMesesVigencia,
  sugerirProximoNumeroAditivo,
  validarPayloadProrrogacao,
  type AditivoExistenteParaProrrogacao,
} from "@/lib/contract-extension-helper";
import { diasAte, formatarData, formatarMoeda } from "@/lib/contratacao";
import type { Json, Tables } from "@/integrations/supabase/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type Assessment = Tables<"contract_renewal_assessments">;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contrato: {
    id: string;
    number: string;
    object?: string | null;
    start_date?: string;
    end_date: string;
    total_value: number;
    status?: string;
    instrument_type?: string;
  } | null;
  supplierName?: string;
  aditivosContrato: AditivoExistenteParaProrrogacao[];
  tenantId: string;
  userId: string;
  onSucesso: () => void;
  onIrParaRenovacoes: () => void;
};

function montarPayloadAnalise(
  assessment: Assessment,
  meses: number,
  dataInicio: string,
  novaData: string,
): Json {
  return {
    legal_regime: assessment.legal_regime,
    contract_nature: assessment.contract_nature,
    legal_basis: assessment.legal_basis,
    edital_allows_extension: assessment.edital_allows_extension,
    contract_allows_extension: assessment.contract_allows_extension,
    continuity_justification: assessment.continuity_justification,
    public_interest_justification: assessment.public_interest_justification,
    execution_report: assessment.execution_report,
    vantajosidade_method: assessment.vantajosidade_method,
    current_period_value: assessment.current_period_value,
    market_reference_value: assessment.market_reference_value,
    reference_source: assessment.reference_source,
    reference_date: assessment.reference_date,
    comparison_basis: assessment.comparison_basis,
    price_analysis: assessment.price_analysis,
    price_advantage_attested: assessment.price_advantage_attested,
    supplier_agreed: assessment.supplier_agreed,
    habilitation_confirmed: assessment.habilitation_confirmed,
    budget_confirmed: assessment.budget_confirmed,
    authority_approved: assessment.authority_approved,
    legal_review_status: assessment.legal_review_status,
    legal_review_reference: assessment.legal_review_reference,
    accumulated_months: assessment.accumulated_months,
    proposed_months: meses,
    proposed_start_date: dataInicio,
    proposed_end_date: novaData,
    notes: assessment.notes,
  };
}

export function ContractExtensionDialog(props: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };

  const inScope = () =>
    Boolean(props.userId) &&
    scope.current.tenant === props.tenantId &&
    scope.current.user === props.userId;

  const [meses, setMeses] = useState(12);
  const [novaData, setNovaData] = useState("");
  const [numero, setNumero] = useState("");
  const [dataAssinatura, setDataAssinatura] = useState(() =>
    new Date().toLocaleDateString("sv-SE"),
  );
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [bloqueios, setBloqueios] = useState<string[]>([]);
  const lock = useRef(false);

  const hoje = new Date().toLocaleDateString("sv-SE");
  const contrato = props.contrato;
  const diasRestantes = contrato ? diasAte(contrato.end_date) : 0;
  const numeroDuplicado = props.aditivosContrato.some(
    (aditivo) =>
      aditivo.number.trim().toLocaleLowerCase("pt-BR") ===
      numero.trim().toLocaleLowerCase("pt-BR"),
  );
  const prazoInferido =
    contrato && novaData ? identificarMesesVigencia(contrato.end_date, novaData) : null;
  const prazoValido = meses > 0 && prazoInferido === meses;
  const validacaoLocal = contrato
    ? validarPayloadProrrogacao({
        contractId: contrato.id,
        dataFimAtual: contrato.end_date,
        novaData,
        numeroAditivo: numero,
        dataAssinatura,
        hoje,
      })
    : { valido: false, erro: "Selecione um contrato." };

  useEffect(() => {
    if (!props.open || !contrato) return;

    const dataInicial = calcularNovaDataVigencia(contrato.end_date, 12);
    setMeses(12);
    setNovaData(dataInicial);
    setNumero(sugerirProximoNumeroAditivo(props.aditivosContrato));
    setDataAssinatura(new Date().toLocaleDateString("sv-SE"));
    setJustificativa(
      gerarJustificativaProrrogacao({
        contractNumber: contrato.number,
        supplierName: props.supplierName,
        meses: 12,
        novaData: dataInicial,
      }),
    );
    setErro("");
    setBloqueios([]);
    lock.current = false;
  }, [
    props.open,
    contrato?.id,
    contrato?.number,
    contrato?.end_date,
    props.supplierName,
    props.aditivosContrato,
  ]);

  function atualizarPrazo(novoPrazo: number) {
    if (!contrato) return;
    const data = calcularNovaDataVigencia(contrato.end_date, novoPrazo);
    setMeses(novoPrazo);
    setNovaData(data);
    setJustificativa(
      gerarJustificativaProrrogacao({
        contractNumber: contrato.number,
        supplierName: props.supplierName,
        meses: novoPrazo,
        novaData: data,
      }),
    );
    setErro("");
    setBloqueios([]);
  }

  function atualizarDataManual(data: string) {
    if (!contrato) return;
    const prazo = identificarMesesVigencia(contrato.end_date, data);
    setNovaData(data);
    setMeses(prazo ?? 0);
    setJustificativa(
      gerarJustificativaProrrogacao({
        contractNumber: contrato.number,
        supplierName: props.supplierName,
        meses: prazo ?? 0,
        novaData: data,
      }),
    );
    setErro("");
    setBloqueios([]);
  }

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contrato || lock.current || salvando) return;

    if (!inScope()) {
      setErro("A sessão ou a Secretaria mudou. Reabra o contrato antes de continuar.");
      return;
    }

    if (contrato.status !== "vigente" || contrato.instrument_type !== "contrato") {
      setErro(
        "Este fluxo atende somente contratos vigentes. Atas de registro de preços e outros instrumentos exigem análise própria.",
      );
      return;
    }

    if (diasRestantes <= 0) {
      setErro("A prorrogação deve ser formalizada antes do término da vigência atual.");
      return;
    }

    if (!validacaoLocal.valido) {
      setErro(validacaoLocal.erro ?? "Revise os dados da prorrogação.");
      return;
    }

    if (!prazoValido) {
      setErro(
        "A nova data deve corresponder a um período inteiro de meses, entre 1 e 120, contado do dia seguinte ao fim atual.",
      );
      return;
    }

    if (numeroDuplicado) {
      setErro("Já existe um aditivo com esse número para o contrato selecionado.");
      return;
    }

    if (!justificativa.trim()) {
      setErro("Informe a justificativa e a fundamentação da prorrogação.");
      return;
    }

    lock.current = true;
    setSalvando(true);
    setErro("");
    setBloqueios([]);

    try {
      const assessmentResult = await db
        .from("contract_renewal_assessments")
        .select("*")
        .eq("tenant_id", props.tenantId)
        .eq("contract_id", contrato.id)
        .maybeSingle();

      if (assessmentResult.error) {
        throw new Error(
          "Não foi possível consultar a análise jurídica de renovação: " +
            assessmentResult.error.message,
        );
      }

      if (!inScope()) {
        throw new Error("A sessão ou a Secretaria mudou durante a operação.");
      }

      if (!assessmentResult.data) {
        const validation = await db.rpc("validate_contract_renewal_addendum", {
          p_tenant_id: props.tenantId,
          p_contract_id: contrato.id,
        });
        if (validation.error) throw new Error(validation.error.message);

        setBloqueios(
          validation.data?.[0]?.blockers ?? [
            "A classificação jurídica e a análise de renovação ainda não foram preenchidas.",
          ],
        );
        setErro(
          "A prorrogação não pode ser registrada. Conclua primeiro a análise jurídica na Central de Renovações.",
        );
        return;
      }

      const dataInicio = new Date(contrato.end_date + "T00:00:00Z");
      dataInicio.setUTCDate(dataInicio.getUTCDate() + 1);
      const inicioProposto = dataInicio.toISOString().slice(0, 10);

      const savedAssessment = await db.rpc("save_contract_renewal_assessment", {
        p_tenant_id: props.tenantId,
        p_contract_id: contrato.id,
        p_payload: montarPayloadAnalise(
          assessmentResult.data,
          meses,
          inicioProposto,
          novaData,
        ),
      });

      if (savedAssessment.error) {
        throw new Error(
          "Não foi possível atualizar o período proposto na análise de renovação: " +
            savedAssessment.error.message,
        );
      }

      if (!inScope()) {
        throw new Error("A sessão ou a Secretaria mudou durante a operação.");
      }

      const validation = await db.rpc("validate_contract_renewal_addendum", {
        p_tenant_id: props.tenantId,
        p_contract_id: contrato.id,
      });

      if (validation.error) throw new Error(validation.error.message);
      const resultado = validation.data?.[0];

      if (!resultado) {
        throw new Error("O servidor não retornou o resultado da validação jurídica.");
      }

      if (!resultado.can_generate) {
        setBloqueios(resultado.blockers);
        setErro(
          "A prorrogação foi bloqueada pela validação do servidor. Resolva as pendências antes de registrar o aditivo.",
        );
        return;
      }

      if (!inScope()) {
        throw new Error("A sessão ou a Secretaria mudou durante a operação.");
      }

      const { error: insertError } = await db.from("contract_amendments").insert({
        tenant_id: props.tenantId,
        contract_id: contrato.id,
        number: numero.trim(),
        kind: "prorrogacao",
        new_end_date: novaData,
        value_change: 0,
        signed_at: dataAssinatura,
        notes: justificativa.trim(),
        created_by: props.userId,
        updated_by: props.userId,
      });

      if (insertError) {
        if (insertError.code === "23505") {
          throw new Error("Já existe um aditivo com esse número para o contrato selecionado.");
        }
        throw new Error(insertError.message);
      }

      toast.success(
        "Vigência do Contrato prorrogada com sucesso até " + formatarData(novaData) + "!",
      );
      props.onOpenChange(false);
      props.onSucesso();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Não foi possível registrar a prorrogação.");
    } finally {
      setSalvando(false);
      lock.current = false;
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !salvando && props.onOpenChange(open)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prorrogar vigência</DialogTitle>
        </DialogHeader>

        {contrato && (
          <form onSubmit={(event) => void salvar(event)} className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">Contrato nº {contrato.number}</p>
                  <p className="text-muted-foreground">
                    {props.supplierName || "Fornecedor não identificado"}
                  </p>
                </div>
                <Badge variant={diasRestantes < 30 ? "destructive" : "outline"}>
                  <CalendarClock className="mr-1 h-3.5 w-3.5" />
                  {diasRestantes < 0
                    ? "Vencido há " + Math.abs(diasRestantes) + " dia(s)"
                    : diasRestantes + " dia(s) restantes"}
                </Badge>
              </div>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <span>
                  Fim da vigência atual: <strong>{formatarData(contrato.end_date)}</strong>
                </span>
                <span>
                  Valor vigente: <strong>{formatarMoeda(Number(contrato.total_value))}</strong>
                </span>
              </div>
            </div>

            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Registro de aditivo formalizado</AlertTitle>
              <AlertDescription>
                Esta ação registra o aditivo já assinado e aciona o gatilho existente para atualizar
                a vigência do contrato. Não gera minuta nem assina o documento. Antes da gravação,
                o sistema revalida os requisitos jurídicos e documentais no servidor.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Prazo da prorrogação</Label>
              <div className="flex flex-wrap gap-2">
                {[12, 6, 24].map((prazo) => (
                  <Button
                    key={prazo}
                    type="button"
                    size="sm"
                    variant={meses === prazo ? "default" : "outline"}
                    aria-pressed={meses === prazo}
                    disabled={salvando}
                    onClick={() => atualizarPrazo(prazo)}
                  >
                    +{prazo} meses{prazo === 12 ? " (Recomendado)" : ""}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="extension-new-end-date">Nova data final *</Label>
                <Input
                  id="extension-new-end-date"
                  type="date"
                  min={contrato.end_date}
                  required
                  disabled={salvando}
                  value={novaData}
                  onChange={(event) => atualizarDataManual(event.target.value)}
                />
                {!prazoValido && novaData && (
                  <p className="text-xs text-destructive">
                    Informe uma data que corresponda a um período inteiro de meses (1 a 120).
                  </p>
                )}
                {prazoValido && (
                  <p className="text-xs text-muted-foreground">
                    Prazo calculado: {meses} mês(es), a partir do dia seguinte ao fim atual.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="extension-number">Número do aditivo *</Label>
                <Input
                  id="extension-number"
                  required
                  maxLength={60}
                  value={numero}
                  disabled={salvando}
                  onChange={(event) => setNumero(event.target.value)}
                />
                {numeroDuplicado && (
                  <p className="text-xs text-destructive">
                    Já existe um aditivo com esse número neste contrato.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="extension-signed-at">Data de assinatura *</Label>
                <Input
                  id="extension-signed-at"
                  type="date"
                  required
                  max={hoje}
                  value={dataAssinatura}
                  disabled={salvando}
                  onChange={(event) => setDataAssinatura(event.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="extension-justification">Justificativa e fundamentação *</Label>
                <Textarea
                  id="extension-justification"
                  rows={5}
                  maxLength={5000}
                  required
                  value={justificativa}
                  disabled={salvando}
                  onChange={(event) => setJustificativa(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Texto preliminar editável. Revise e complemente com os fatos, documentos e
                  fundamentos específicos do contrato antes de registrar.
                </p>
              </div>
            </div>

            {bloqueios.length > 0 && (
              <Alert className="border-warning/50 bg-warning/10">
                <AlertTitle>Requisitos pendentes na Central de Renovações</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {bloqueios.map((bloqueio) => (
                      <li key={bloqueio}>{bloqueio}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}

            {bloqueios.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={salvando}
                onClick={props.onIrParaRenovacoes}
              >
                Ir para Central de Renovações
              </Button>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={salvando}
                onClick={() => props.onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  salvando ||
                  !validacaoLocal.valido ||
                  !prazoValido ||
                  numeroDuplicado ||
                  !justificativa.trim() ||
                  !inScope()
                }
              >
                {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
                {salvando ? "Validando e registrando…" : "Registrar prorrogação"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
