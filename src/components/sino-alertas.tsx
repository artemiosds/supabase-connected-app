import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { diasAte, nivelAlerta, ROTULO_ALERTA, type NivelAlerta } from "@/lib/contratacao";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Aviso = {
  id: string;
  tipo: "Contrato" | "Documento";
  titulo: string;
  complemento: string | null;
  dias: number;
  nivel: NivelAlerta;
  destino: "/contratos" | "/documentos";
};

function dataISO(data: Date): string {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

function descricaoPrazo(dias: number, nivel: NivelAlerta): string {
  return dias < 0 ? `Vencido há ${-dias} dia(s)` : ROTULO_ALERTA[nivel];
}

export function SinoAlertas() {
  const { selecionado } = useTenant();
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  useEffect(() => {
    let ativo = true;
    const tenantId = selecionado?.id;

    // Limpa imediatamente os avisos anteriores para não exibir dados
    // da Secretaria anterior durante a troca de contexto.
    setAvisos([]);
    if (!tenantId) return;

    const hoje = new Date();
    const limiteDate = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 120);
    const limite = dataISO(limiteDate);

    async function carregarAvisos() {
      try {
        const [contratosResult, documentosResult] = await Promise.all([
          db
            .from("contracts")
            .select("id,number,end_date")
            .eq("tenant_id", tenantId)
            .eq("status", "vigente")
            .lte("end_date", limite)
            .order("end_date")
            .limit(100),
          db
            .from("supplier_documents")
            .select("id,title,expires_at,suppliers(legal_name,trade_name)")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .not("expires_at", "is", null)
            .lte("expires_at", limite)
            .order("expires_at")
            .limit(100),
        ]);

        if (!ativo) return;

        const avisosContratos: Aviso[] = contratosResult.error
          ? []
          : (contratosResult.data ?? []).map((contrato) => {
              const dias = diasAte(contrato.end_date);
              return {
                id: contrato.id,
                tipo: "Contrato",
                titulo: `Contrato nº ${contrato.number}`,
                complemento: null,
                dias,
                nivel: nivelAlerta(dias),
                destino: "/contratos",
              };
            });

        const avisosDocumentos: Aviso[] = documentosResult.error
          ? []
          : (documentosResult.data ?? []).flatMap((documento) => {
              if (!documento.expires_at) return [];
              const dias = diasAte(documento.expires_at);
              const fornecedor = documento.suppliers?.trade_name || documento.suppliers?.legal_name;
              return [
                {
                  id: documento.id,
                  tipo: "Documento",
                  titulo: documento.title,
                  complemento: fornecedor ? `Fornecedor: ${fornecedor}` : null,
                  dias,
                  nivel: nivelAlerta(dias),
                  destino: "/documentos",
                },
              ];
            });

        setAvisos(
          [...avisosContratos, ...avisosDocumentos].sort(
            (a, b) => a.dias - b.dias || a.titulo.localeCompare(b.titulo, "pt-BR"),
          ),
        );
      } catch {
        if (ativo) setAvisos([]);
      }
    }

    void carregarAvisos();
    return () => {
      ativo = false;
    };
  }, [selecionado?.id]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Alertas de vencimento: ${avisos.length}`}
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
        {avisos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum vencimento identificado nos próximos 120 dias.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {avisos.map((aviso) => (
              <li key={`${aviso.tipo}-${aviso.id}`}>
                <Link
                  to={aviso.destino}
                  className="block rounded-md border p-2 text-sm transition-colors hover:bg-muted/60"
                >
                  <p className="font-medium">{aviso.tipo}: {aviso.titulo}</p>
                  {aviso.complemento && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{aviso.complemento}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {descricaoPrazo(aviso.dias, aviso.nivel)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
