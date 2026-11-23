import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Bell, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { db, carregarTodasAsPaginas } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import {
  calcularAvisosVencimento,
  dataLimiteAvisosISO,
  type AvisoVencimento,
} from "@/lib/expiry-alerts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SinoAlertas() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [avisos, setAvisos] = useState<AvisoVencimento[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [falhaParcial, setFalhaParcial] = useState(false);
  const [andamento, setAndamento] = useState<{ tenantId: string; ids: string[]; canEdit: boolean }>(
    {
      tenantId: "",
      ids: [],
      canEdit: false,
    },
  );
  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const atualize = () => setRefresh((value) => value + 1);
    window.addEventListener("primus:renewal-followup", atualize);
    return () => window.removeEventListener("primus:renewal-followup", atualize);
  }, []);
  const tenantIdAtual = selecionado?.id ?? "";
  const marcados =
    andamento.tenantId === tenantIdAtual ? new Set(andamento.ids) : new Set<string>();
  const podeMarcar = andamento.tenantId === tenantIdAtual && andamento.canEdit;

  useEffect(() => {
    let ativo = true;
    const tenantId = selecionado?.id ?? "";

    // Limpa imediatamente os avisos anteriores para não exibir dados
    // da Secretaria anterior durante a troca de contexto.
    setAvisos([]);
    setFalhaParcial(false);
    setAndamento({ tenantId: "", ids: [], canEdit: false });
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
            .select("id,number,end_date")
            .eq("tenant_id", tenantId)
            .eq("status", "vigente")
            .lte("end_date", limite)
            .order("end_date")
            .order("id")
            .range(inicio, fim),
        )
          .then((data) => ({ data, falhou: false }))
          .catch(() => ({ data: [], falhou: true })),
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

      if (!ativo) return;
      setAvisos(calcularAvisosVencimento(contratos.data, documentos.data));
      setFalhaParcial(contratos.falhou || documentos.falhou || followups.falhou);
      setAndamento({
        tenantId,
        ids: followups.ids,
        canEdit: !capabilities.error && capabilities.data?.[0]?.can_update === true,
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

  const ariaLabel = carregando
    ? "Carregando alertas de vencimento"
    : falhaParcial
      ? `Alertas de vencimento parcialmente carregados: ${avisos.length}`
      : `Alertas de vencimento: ${avisos.length}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={ariaLabel}
          disabled={carregando}
        >
          <Bell className="h-5 w-5" />
          {avisos.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground">
              {avisos.length > 99 ? "99+" : avisos.length}
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
            <p className="mt-1 text-base font-semibold tracking-tight">Prazos e vencimentos</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Contratos e documentos dos próximos 120 dias.
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
              Consultando vencimentos…
            </p>
          ) : (
            <>
              {falhaParcial && (
                <p role="status" className="mb-2 text-xs text-destructive">
                  Alguns alertas não puderam ser carregados. Verifique a conexão ou as permissões.
                </p>
              )}
              {avisos.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-4 py-7 text-center">
                  <CheckCircle2 className="size-7 text-success" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold">
                    {falhaParcial ? "Consulta incompleta" : "Nenhum prazo crítico identificado"}
                  </p>
                  <p className="mt-1 max-w-[255px] text-xs leading-relaxed text-muted-foreground">
                    {falhaParcial
                      ? "Não foi possível confirmar todos os vencimentos."
                      : "Nenhum vencimento identificado nos próximos 120 dias."}
                  </p>
                </div>
              ) : (
                <ul className="max-h-[430px] space-y-2.5 overflow-y-auto pr-1">
                  {avisos.map((aviso) => {
                    const contrato = aviso.tipo === "Contrato";
                    const emAndamento = contrato && marcados.has(aviso.id);
                    const detailHref = `${aviso.destino}?${contrato ? "contrato" : "documento"}=${encodeURIComponent(aviso.id)}`;
                    const aditivoHref = `/contratos?contrato=${encodeURIComponent(aviso.id)}&aditivo=novo`;
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
                          <p className="mt-1 text-xs text-muted-foreground">{aviso.complemento}</p>
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
                              <Button size="sm" variant="outline" className="rounded-lg" asChild>
                                <a href={aditivoHref}>Iniciar aditivo</a>
                              </Button>
                              {!emAndamento && (
                                <Button
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
  );
}
