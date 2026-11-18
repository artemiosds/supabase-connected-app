import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Loader2 } from "lucide-react";
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
  }, [selecionado?.id]);

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
      <PopoverContent align="end" className="w-80">
        <p className="mb-1 text-sm font-semibold">Alertas de vencimento</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Contratos vigentes e documentos ativos com vencimento nos próximos 120 dias.
        </p>
        {carregando ? (
          <p className="text-sm text-muted-foreground">Consultando vencimentos...</p>
        ) : (
          <>
            {falhaParcial && (
              <p role="status" className="mb-2 text-xs text-destructive">
                Alguns alertas não puderam ser carregados. Verifique a conexão ou as permissões.
              </p>
            )}
            {avisos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {falhaParcial
                  ? "Não foi possível confirmar todos os vencimentos."
                  : "Nenhum vencimento identificado nos próximos 120 dias."}
              </p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {avisos.map((aviso) => {
                  const contrato = aviso.tipo === "Contrato";
                  const emAndamento = contrato && marcados.has(aviso.id);
                  const detailHref = `${aviso.destino}?${contrato ? "contrato" : "documento"}=${encodeURIComponent(aviso.id)}`;
                  const aditivoHref = `/contratos?contrato=${encodeURIComponent(aviso.id)}&aditivo=novo`;
                  const statusClass =
                    aviso.dias < 30
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : aviso.dias <= 60
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-primary/30 bg-primary/10 text-primary";
                  return (
                    <li key={`${aviso.tipo}-${aviso.id}`} className="rounded-md border p-3 text-sm">
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
                      <p className="mt-2 font-medium">
                        {aviso.tipo}: {aviso.titulo}
                      </p>
                      {aviso.complemento && (
                        <p className="mt-1 text-xs text-muted-foreground">{aviso.complemento}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" asChild>
                          <a href={detailHref}>Ver detalhes</a>
                        </Button>
                        {contrato && podeMarcar && (
                          <>
                            <Button size="sm" variant="outline" asChild>
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
        <Link to="/contratos" className="mt-3 block text-sm font-medium text-primary">
          Ver contratos
        </Link>
      </PopoverContent>
    </Popover>
  );
}
