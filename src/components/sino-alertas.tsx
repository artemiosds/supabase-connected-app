import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
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
  const [avisos, setAvisos] = useState<AvisoVencimento[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [falhaParcial, setFalhaParcial] = useState(false);

  useEffect(() => {
    let ativo = true;
    const tenantId = selecionado?.id;

    // Limpa imediatamente os avisos anteriores para não exibir dados
    // da Secretaria anterior durante a troca de contexto.
    setAvisos([]);
    setFalhaParcial(false);
    if (!tenantId) {
      setCarregando(false);
      return;
    }

    setCarregando(true);
    const limite = dataLimiteAvisosISO(new Date());

    async function carregarAvisos() {
      const [contratos, documentos] = await Promise.all([
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
      ]);

      if (!ativo) return;
      setAvisos(calcularAvisosVencimento(contratos.data, documentos.data));
      setFalhaParcial(contratos.falhou || documentos.falhou);
      setCarregando(false);
    }

    void carregarAvisos();
    return () => {
      ativo = false;
    };
  }, [selecionado?.id]);

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
                {avisos.map((aviso) => (
                  <li key={`${aviso.tipo}-${aviso.id}`}>
                    <Link
                      to={aviso.destino}
                      className="block rounded-md border p-2 text-sm transition-colors hover:bg-muted/60"
                    >
                      <p className="font-medium">
                        {aviso.tipo}: {aviso.titulo}
                      </p>
                      {aviso.complemento && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{aviso.complemento}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {aviso.dias < 0
                          ? `Vencido há ${-aviso.dias} dia(s)`
                          : aviso.nivel === "ok"
                            ? "Em dia"
                            : aviso.nivel === "30"
                              ? "Vence em até 30 dias"
                              : aviso.nivel === "60"
                                ? "Vence em até 60 dias"
                                : aviso.nivel === "90"
                                  ? "Vence em até 90 dias"
                                  : "Vence em até 120 dias"}
                      </p>
                    </Link>
                  </li>
                ))}
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
