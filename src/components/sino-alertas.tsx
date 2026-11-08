import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { diasAte, nivelAlerta, ROTULO_ALERTA, type NivelAlerta } from "@/lib/contratacao";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Aviso = { id: string; number: string; dias: number; nivel: NivelAlerta };

export function SinoAlertas() {
  const { selecionado } = useTenant();
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  useEffect(() => {
    let ativo = true;
    if (!selecionado?.id) return;
    const limite = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    void db
      .from("contracts")
      .select("id, number, end_date")
      .eq("tenant_id", selecionado.id)
      .eq("status", "vigente")
      .lte("end_date", limite)
      .order("end_date")
      .then(({ data, error }) => {
        if (!ativo || error) return;
        setAvisos(
          (data ?? []).map((c) => {
            const dias = diasAte(c.end_date);
            return { id: c.id, number: c.number, dias, nivel: nivelAlerta(dias) };
          }),
        );
      });
    return () => {
      ativo = false;
    };
  }, [selecionado?.id]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Alertas de vencimento">
          <Bell className="h-5 w-5" />
          {avisos.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground">
              {avisos.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-sm font-semibold">Contratos perto do vencimento</p>
        {avisos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum alerta nos próximos 120 dias.</p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {avisos.map((a) => (
              <li key={a.id} className="rounded-md border p-2 text-sm">
                <p className="font-medium">Contrato nº {a.number}</p>
                <p className="text-muted-foreground">
                  {a.dias < 0 ? `Vencido há ${-a.dias} dia(s)` : ROTULO_ALERTA[a.nivel]}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Link to="/contratos" className="mt-3 block text-sm font-medium text-primary">
          Ver todos os contratos
        </Link>
      </PopoverContent>
    </Popover>
  );
}
