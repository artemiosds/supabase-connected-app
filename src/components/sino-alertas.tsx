import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { ContractExtensionDialog } from "@/components/contracts/contract-extension-dialog";
import { StockReplenishmentDialog } from "@/components/contracts/stock-replenishment-dialog";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { db, carregarTodasAsPaginas } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import type { AditivoExistenteParaProrrogacao } from "@/lib/contract-extension-helper";
import {
  calcularAvisosVencimento,
  dataLimiteAvisosISO,
  type AvisoVencimento,
} from "@/lib/expiry-alerts";
import {
  resumirContratosComSaldoCritico,
  type ContratoComSaldoCritico,
} from "@/lib/stock-replenishment-helper";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ContratoAlertaRegistro = {
  id: string;
  number: string;
  object: string | null;
  start_date: string;
  end_date: string;
  total_value: number;
  status: string;
  instrument_type: string;
  suppliers: {
    legal_name: string | null;
    trade_name: string | null;
  } | null;
};

type ProrrogacaoAlvo = {
  contrato: {
    id: string;
    number: string;
    object: string | null;
    start_date: string;
    end_date: string;
    total_value: number;
    status: string;
    instrument_type: string;
  };
  supplierName: string | undefined;
};

type CotacaoRecebidaAlerta = {
  id: string;
  processId: string;
  processNumber: string;
  processTitle: string;
  supplierName: string;
  protocol: string;
  submittedAt: string;
};

export function SinoAlertas() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const tenantIdAtual = selecionado?.id ?? "";
  const tenantRef = useRef(tenantIdAtual);
  tenantRef.current = tenantIdAtual;

  const [popoverAberto, setPopoverAberto] = useState(false);
  const [avisos, setAvisos] = useState<AvisoVencimento[]>([]);
  const [alertasSaldo, setAlertasSaldo] = useState<ContratoComSaldoCritico[]>([]);
  const [cotacoesRecebidas, setCotacoesRecebidas] = useState<CotacaoRecebidaAlerta[]>([]);
  const [contratosPorId, setContratosPorId] = useState<Record<string, ContratoAlertaRegistro>>({});
  const [carregando, setCarregando] = useState(false);
  const [falhaParcial, setFalhaParcial] = useState(false);
  const [andamento, setAndamento] = useState<{
    tenantId: string;
    ids: string[];
    canEdit: boolean;
    canCreate: boolean;
  }>({
    tenantId: "",
    ids: [],
    canEdit: false,
    canCreate: false,
  });
  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  const [abrindoProrrogacaoId, setAbrindoProrrogacaoId] = useState<string | null>(null);
  const [prorrogacaoAlvo, setProrrogacaoAlvo] = useState<ProrrogacaoAlvo | null>(null);
  const [aditivosProrrogacao, setAditivosProrrogacao] = useState<AditivoExistenteParaProrrogacao[]>(
    [],
  );
  const [reposicaoAlvo, setReposicaoAlvo] = useState<ContratoComSaldoCritico | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const atualize = () => setRefresh((value) => value + 1);
    window.addEventListener("primus:renewal-followup", atualize);
    return () => window.removeEventListener("primus:renewal-followup", atualize);
  }, []);

  const marcados =
    andamento.tenantId === tenantIdAtual ? new Set(andamento.ids) : new Set<string>();
  const podeMarcar = andamento.tenantId === tenantIdAtual && andamento.canEdit;
  const podeCriar = andamento.tenantId === tenantIdAtual && andamento.canCreate;

  useEffect(() => {
    let ativo = true;
    const tenantId = selecionado?.id ?? "";

    // Limpa imediatamente os avisos anteriores para não exibir dados
    // da Secretaria anterior durante a troca de contexto.
    setAvisos([]);
    setAlertasSaldo([]);
    setContratosPorId({});
    setCotacoesRecebidas([]);
    setFalhaParcial(false);
    setAndamento({ tenantId: "", ids: [], canEdit: false, canCreate: false });
    setProrrogacaoAlvo(null);
    setAditivosProrrogacao([]);
    setReposicaoAlvo(null);
    if (tenantId.length === 0) {
      setCarregando(false);
      return;
    }

    setCarregando(true);
    const limite = dataLimiteAvisosISO(new Date());

    async function carregarAvisos() {
      const [contratos, documentos, followups, capabilities] = await Promise.all([
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("contracts")
            .select(
              "id,number,object,start_date,end_date,total_value,status,instrument_type,suppliers(legal_name,trade_name)",
            )
            .eq("tenant_id", tenantId)
            .eq("status", "vigente")
            .order("end_date")
            .order("id")
            .range(inicio, fim),
        )
          .then((data) => ({ data: data as ContratoAlertaRegistro[], falhou: false }))
          .catch(() => ({ data: [] as ContratoAlertaRegistro[], falhou: true })),
        carregarTodasAsPaginas((inicio, fim) =>
          db
            .from("supplier_documents")
            .select("id,title,expires_at,suppliers(legal_name,trade_name)")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .not("expires_at", "is", null)
            .lte("expires_at", limite)
            .order("expires_at")
            .order("id")
            .range(inicio, fim),
        )
          .then((data) => ({ data, falhou: false }))
          .catch(() => ({ data: [], falhou: true })),
        db
          .from("contract_renewal_followups")
          .select("contract_id")
          .eq("tenant_id", tenantId)
          .then(({ data, error }) => ({
            ids: (data ?? []).map((row) => row.contract_id),
            falhou: !!error,
          })),
        db.rpc("get_document_capabilities", { p_tenant_id: tenantId }),
      ]);

      // Carrega propostas eletrônicas recebidas (status = submitted) concorrentemente
      const cotacoesFetch = db
        .from("procurement_quote_requests")
        .select(
          "id,process_id,supplier_id,submission_protocol,submitted_at,suppliers(legal_name,trade_name),procurement_processes(number,title)",
        )
        .eq("tenant_id", tenantId)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: false })
        .limit(20)
        .then(({ data, error }) => ({ data: data ?? [], falhou: !!error }))
        .then(undefined, () => ({ data: [] as unknown[], falhou: true }));

      const contractIds = contratos.data.map((contract) => contract.id);
      const [itensContratos, movimentacoes] =
        contractIds.length > 0
          ? await Promise.all([
              carregarTodasAsPaginas((inicio, fim) =>
                db
                  .from("contract_items")
                  .select(
                    "id,contract_id,line_number,description,specification,unit,quantity_total,unit_value",
                  )
                  .eq("tenant_id", tenantId)
                  .in("contract_id", contractIds)
                  .order("line_number")
                  .order("id")
                  .range(inicio, fim),
              )
                .then((data) => ({ data, falhou: false }))
                .catch(() => ({ data: [], falhou: true })),
              carregarTodasAsPaginas((inicio, fim) =>
                db
                  .from("contract_item_movements")
                  .select("contract_item_id,movement_type,quantity")
                  .eq("tenant_id", tenantId)
                  .order("id")
                  .range(inicio, fim),
              )
                .then((data) => ({ data, falhou: false }))
                .catch(() => ({ data: [], falhou: true })),
            ])
          : [
              { data: [], falhou: false },
              { data: [], falhou: false },
            ];

      if (!ativo) return;

      type CotacaoRow = {
        id: string;
        process_id: string;
        submission_protocol: string | null;
        submitted_at: string | null;
        suppliers: { legal_name: string | null; trade_name: string | null } | null;
        procurement_processes: { number: string; title: string } | null;
      };

      const [cotacoesResult, mapaContratos] = await Promise.all([
        cotacoesFetch,
        Promise.resolve(
          Object.fromEntries(contratos.data.map((c) => [c.id, c])) as Record<
            string,
            ContratoAlertaRegistro
          >,
        ),
      ]);

      const contratosVencendo = contratos.data.filter((contract) => contract.end_date <= limite);
      setContratosPorId(mapaContratos);
      setAvisos(calcularAvisosVencimento(contratosVencendo, documentos.data));
      setAlertasSaldo(
        resumirContratosComSaldoCritico({
          contracts: contratos.data,
          items: itensContratos.data.map((item) => ({
            ...item,
            quantity_total: Number(item.quantity_total),
            unit_value: Number(item.unit_value),
          })),
          movements: movimentacoes.data.map((movement) => ({
            ...movement,
            quantity: Number(movement.quantity),
          })),
        }),
      );

      setCotacoesRecebidas(
        (cotacoesResult.data as CotacaoRow[])
          .filter((r) => r.submission_protocol && r.submitted_at && r.procurement_processes)
          .map((r) => ({
            id: r.id,
            processId: r.process_id,
            processNumber: r.procurement_processes!.number,
            processTitle: r.procurement_processes!.title,
            supplierName:
              r.suppliers?.trade_name?.trim() || r.suppliers?.legal_name?.trim() || "Fornecedor",
            protocol: r.submission_protocol!,
            submittedAt: r.submitted_at!,
          })),
      );

      setFalhaParcial(
        contratos.falhou ||
          documentos.falhou ||
          followups.falhou ||
          itensContratos.falhou ||
          movimentacoes.falhou,
      );
      setAndamento({
        tenantId,
        ids: followups.ids,
        canEdit: !capabilities.error && capabilities.data?.[0]?.can_update === true,
        canCreate: !capabilities.error && capabilities.data?.[0]?.can_create === true,
      });
      setCarregando(false);
    }

    void carregarAvisos();
    return () => {
      ativo = false;
    };
  }, [selecionado?.id, refresh]);

  async function marcarEmAndamento(contractId: string) {
    const tenantId = selecionado?.id;
    const userId = session?.user.id;
    if (!tenantId || !userId || !podeMarcar || marcandoId) return;
    setMarcandoId(contractId);
    const { error } = await db.from("contract_renewal_followups").insert({
      tenant_id: tenantId,
      contract_id: contractId,
      started_by: userId,
    });
    setMarcandoId(null);
    if (error && error.code !== "23505") {
      toast.error("Não foi possível registrar o acompanhamento. Verifique suas permissões.");
      return;
    }
    setAndamento((current) =>
      current.tenantId === tenantId
        ? { ...current, ids: Array.from(new Set([...current.ids, contractId])) }
        : current,
    );
    toast.success("Acompanhamento de renovação registrado para esta Secretaria.");
  }

  async function abrirProrrogacaoDireta(contractId: string) {
    const tenantId = selecionado?.id;
    const userId = session?.user.id;
    const contrato = contratosPorId[contractId];
    if (!tenantId || !userId || !podeMarcar || !contrato || abrindoProrrogacaoId) return;

    setAbrindoProrrogacaoId(contractId);
    const { data, error } = await db
      .from("contract_amendments")
      .select("id,number,kind,signed_at,new_end_date")
      .eq("tenant_id", tenantId)
      .eq("contract_id", contractId)
      .order("signed_at", { ascending: true });

    if (tenantRef.current !== tenantId) return;
    setAbrindoProrrogacaoId(null);

    if (error) {
      toast.error("Não foi possível carregar os aditivos do contrato para prorrogação.");
      return;
    }

    setAditivosProrrogacao((data ?? []) as AditivoExistenteParaProrrogacao[]);
    setProrrogacaoAlvo({
      contrato: {
        id: contrato.id,
        number: contrato.number,
        object: contrato.object,
        start_date: contrato.start_date,
        end_date: contrato.end_date,
        total_value: Number(contrato.total_value),
        status: contrato.status,
        instrument_type: contrato.instrument_type,
      },
      supplierName: contrato.suppliers?.trade_name || contrato.suppliers?.legal_name || undefined,
    });
    setPopoverAberto(false);
  }

  function abrirReposicaoDireta(alerta: ContratoComSaldoCritico) {
    if (!podeCriar || !session?.user.id) return;
    setReposicaoAlvo(alerta);
    setPopoverAberto(false);
  }

  const totalAlertas = avisos.length + alertasSaldo.length + cotacoesRecebidas.length;
  const ariaLabel = carregando
    ? "Carregando alertas de vencimento"
    : falhaParcial
      ? `Alertas de vencimento, saldo e cotações parcialmente carregados: ${totalAlertas}`
      : `Alertas de vencimento e saldo: ${totalAlertas}`;

  return (
    <>
      <Popover open={popoverAberto} onOpenChange={setPopoverAberto}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={ariaLabel}
            disabled={carregando}
          >
            <Bell className="h-5 w-5" />
            {totalAlertas > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground">
                {totalAlertas > 99 ? "99+" : totalAlertas}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[390px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-border/80 p-0 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/70 bg-muted/30 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                Central de alertas
              </p>
              <p className="mt-1 text-base font-semibold tracking-tight">
                Prazos e saldo contratual
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Vencimentos em 120 dias e itens com saldo esgotado ou crítico.
              </p>
            </div>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary">
              <CalendarClock className="size-5" aria-hidden="true" />
            </span>
          </div>
          <div className="px-4 py-4">
            {carregando ? (
              <p
                className="flex items-center gap-2 px-1 py-5 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Consultando vencimentos e saldos…
              </p>
            ) : (
              <>
                {falhaParcial && (
                  <p role="status" className="mb-2 text-xs text-destructive">
                    Alguns alertas não puderam ser carregados. Verifique a conexão ou as permissões.
                  </p>
                )}
                {totalAlertas === 0 ? (
                  <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-4 py-7 text-center">
                    <CheckCircle2 className="size-7 text-success" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold">
                      {falhaParcial ? "Consulta incompleta" : "Nenhum alerta crítico identificado"}
                    </p>
                    <p className="mt-1 max-w-[255px] text-xs leading-relaxed text-muted-foreground">
                      {falhaParcial
                        ? "Não foi possível confirmar todos os vencimentos e saldos."
                        : "Nenhum vencimento em 120 dias nem saldo crítico identificado."}
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-[430px] space-y-2.5 overflow-y-auto pr-1">
                    {cotacoesRecebidas.map((cot) => {
                      const processHref = `/processos?processo=${encodeURIComponent(cot.processId)}`;
                      const submittedLabel = new Date(cot.submittedAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <li
                          key={`cotacao-${cot.id}`}
                          className="rounded-xl border border-l-[3px] border-l-emerald-500 bg-card p-3.5 text-sm transition-colors hover:bg-muted/30"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge
                              variant="outline"
                              className="border-emerald-400/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            >
                              Proposta recebida
                            </Badge>
                            <span className="text-xs text-muted-foreground">{submittedLabel}</span>
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-snug">
                            {cot.supplierName}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Processo nº {cot.processNumber} · Protocolo {cot.protocol}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="default"
                              className="rounded-lg"
                              asChild
                              onClick={() => setPopoverAberto(false)}
                            >
                              <a href={processHref}>
                                <ClipboardCheck className="mr-1 size-3.5" aria-hidden="true" />
                                Importar na Matriz
                              </a>
                            </Button>
                            <Button size="sm" variant="outline" className="rounded-lg" asChild>
                              <a href={processHref}>
                                Abrir processo
                                <ArrowUpRight className="ml-1 size-3.5" aria-hidden="true" />
                              </a>
                            </Button>
                          </div>
                        </li>
                      );
                    })}

                    {alertasSaldo.map((alerta) => {
                      const detailHref = `/contratos?contrato=${encodeURIComponent(alerta.contractId)}`;
                      const temEsgotado = alerta.esgotadosCount > 0;
                      const statusClass = temEsgotado
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-warning/35 bg-warning/15 text-foreground";
                      return (
                        <li
                          key={`Saldo-${alerta.contractId}`}
                          className={`rounded-xl border border-l-[3px] bg-card p-3.5 text-sm transition-colors hover:bg-muted/30 ${temEsgotado ? "border-l-destructive" : "border-l-warning"}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant="outline" className={statusClass}>
                              {temEsgotado ? "Saldo esgotado" : "Saldo crítico"}
                            </Badge>
                            <Badge variant="secondary">
                              {alerta.itensCriticos.length}{" "}
                              {alerta.itensCriticos.length === 1 ? "item" : "itens"}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-snug">
                            Saldo crítico: Contrato nº {alerta.contractNumber}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {alerta.esgotadosCount > 0 && `${alerta.esgotadosCount} esgotado(s)`}
                            {alerta.esgotadosCount > 0 && alerta.criticosCount > 0 && " · "}
                            {alerta.criticosCount > 0 && `${alerta.criticosCount} com saldo ≤ 20%`}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button size="sm" variant="outline" className="rounded-lg" asChild>
                              <a href={detailHref}>
                                Ver detalhes
                                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                              </a>
                            </Button>
                            {podeCriar && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="rounded-lg"
                                onClick={() => abrirReposicaoDireta(alerta)}
                              >
                                <PackagePlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                Gerar Reposição
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}

                    {avisos.map((aviso) => {
                      const contrato = aviso.tipo === "Contrato";
                      const emAndamento = contrato && marcados.has(aviso.id);
                      const detailHref = `${aviso.destino}?${contrato ? "contrato" : "documento"}=${encodeURIComponent(aviso.id)}`;
                      const statusClass =
                        aviso.dias < 30
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : aviso.dias <= 60
                            ? "border-warning/35 bg-warning/15 text-foreground"
                            : "border-primary/30 bg-primary/10 text-primary";
                      return (
                        <li
                          key={`${aviso.tipo}-${aviso.id}`}
                          className={`rounded-xl border border-l-[3px] bg-card p-3.5 text-sm transition-colors hover:bg-muted/30 ${aviso.dias < 30 ? "border-l-destructive" : aviso.dias <= 60 ? "border-l-warning" : "border-l-primary"}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant="outline" className={statusClass}>
                              {aviso.dias < 0
                                ? `Vencido há ${-aviso.dias} dia(s)`
                                : aviso.dias === 0
                                  ? "Vence hoje"
                                  : `Vence em ${aviso.dias} dia(s)`}
                            </Badge>
                            {emAndamento && <Badge variant="secondary">Em andamento</Badge>}
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-snug">
                            {aviso.tipo}: {aviso.titulo}
                          </p>
                          {aviso.complemento && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {aviso.complemento}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button size="sm" variant="outline" className="rounded-lg" asChild>
                              <a href={detailHref}>
                                Ver detalhes
                                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                              </a>
                            </Button>
                            {contrato && podeMarcar && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-lg"
                                  disabled={abrindoProrrogacaoId === aviso.id}
                                  onClick={() => void abrirProrrogacaoDireta(aviso.id)}
                                >
                                  {abrindoProrrogacaoId === aviso.id ? (
                                    <Loader2
                                      className="mr-1 h-3.5 w-3.5 animate-spin"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <CalendarClock
                                      className="mr-1 h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  )}
                                  Prorrogar Vigência
                                </Button>
                                {!emAndamento && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={marcandoId === aviso.id}
                                    onClick={() => void marcarEmAndamento(aviso.id)}
                                  >
                                    {marcandoId === aviso.id && (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    )}
                                    Marcar como em andamento
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="border-t border-border/70 bg-muted/20 px-5 py-3">
            <Link
              to="/contratos"
              className="inline-flex min-h-8 items-center gap-2 text-xs font-semibold text-primary hover:underline"
            >
              Ver gestão de contratos
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </PopoverContent>
      </Popover>

      <ContractExtensionDialog
        open={Boolean(prorrogacaoAlvo)}
        onOpenChange={(open) => {
          if (!open) {
            setProrrogacaoAlvo(null);
            setAditivosProrrogacao([]);
          }
        }}
        contrato={prorrogacaoAlvo?.contrato ?? null}
        supplierName={prorrogacaoAlvo?.supplierName}
        aditivosContrato={aditivosProrrogacao}
        tenantId={tenantIdAtual}
        userId={session?.user.id ?? ""}
        onSucesso={() => {
          setProrrogacaoAlvo(null);
          setAditivosProrrogacao([]);
          setRefresh((value) => value + 1);
          window.dispatchEvent(new Event("primus:renewal-followup"));
        }}
        onIrParaRenovacoes={() => {
          const contractId = prorrogacaoAlvo?.contrato.id;
          setProrrogacaoAlvo(null);
          setAditivosProrrogacao([]);
          window.location.assign(
            contractId
              ? `/contratos?contrato=${encodeURIComponent(contractId)}&aba=renovacoes`
              : "/contratos",
          );
        }}
      />

      {reposicaoAlvo && (
        <StockReplenishmentDialog
          key={reposicaoAlvo.contractId}
          open
          onOpenChange={(open) => {
            if (!open) setReposicaoAlvo(null);
          }}
          contract={{
            id: reposicaoAlvo.contractId,
            number: reposicaoAlvo.contractNumber,
            object: reposicaoAlvo.contractObject,
          }}
          tenantId={tenantIdAtual}
          userId={session?.user.id ?? ""}
          itensCriticos={reposicaoAlvo.itensCriticos}
          onSucesso={() => {
            setReposicaoAlvo(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
