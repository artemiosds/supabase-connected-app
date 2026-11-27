import { useState } from "react";
import { Calculator, Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { dataHojeLocalISO, formatarMoeda } from "@/lib/contratacao";
import {
  calcularReajusteAcumulado,
  INDICES_REAJUSTE_BCB,
  parseBcbSeriesPayload,
  sugerirPeriodo12Meses,
  type CodigoIndiceReajuste,
  type ResultadoReajuste,
} from "@/lib/contract-readjustment-helper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  valorBase: number;
  onApply: (valorReajuste: number, memorialCalculo: string) => void;
}

export function ContractReadjustmentCalculator({ valorBase, onApply }: Props) {
  const hoje = dataHojeLocalISO();
  const periodoPadrao = sugerirPeriodo12Meses(hoje);

  const [aberto, setAberto] = useState(true);
  const [indice, setIndice] = useState<CodigoIndiceReajuste>("ipca");
  const [dataInicial, setDataInicial] = useState(periodoPadrao.dataInicialISO);
  const [dataFinal, setDataFinal] = useState(periodoPadrao.dataFinalISO);
  const [consultando, setConsultando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoReajuste | null>(null);
  const [percentualManual, setPercentualManual] = useState("");

  async function consultarBcb() {
    if (!db) {
      toast.error("Cliente Supabase indisponível.");
      return;
    }
    if (!dataInicial || !dataFinal || dataFinal < dataInicial) {
      toast.error("Informe um período válido para consulta ao Banco Central.");
      return;
    }
    setConsultando(true);
    try {
      const { data, error } = await db.functions.invoke("fetch-bcb-index", {
        body: {
          indexCode: indice,
          dataInicialISO: dataInicial,
          dataFinalISO: dataFinal,
        },
      });
      if (error) {
        throw new Error(error.message || "Falha ao consultar API do Banco Central.");
      }
      const payload = data as { error?: string; pontos?: unknown } | null;
      if (payload?.error) {
        throw new Error(payload.error);
      }
      const pontos = parseBcbSeriesPayload(payload?.pontos);
      if (pontos.length === 0) {
        toast.warning(
          "O Banco Central ainda não divulgou índices para o intervalo exato selecionado. Ajuste as datas ou informe o % manualmente.",
        );
        return;
      }
      const calculado = calcularReajusteAcumulado({
        valorBase,
        pontosMensais: pontos,
        indice,
        dataInicialISO: dataInicial,
        dataFinalISO: dataFinal,
      });
      setResultado(calculado);
      toast.success(
        `${INDICES_REAJUSTE_BCB[indice].sigla} apurado (${calculado.mesesConsiderados} meses): ${calculado.percentualAcumulado.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `${err.message} Você pode informar o percentual acumulado manualmente abaixo.`
          : "Erro ao consultar Banco Central.",
      );
    } finally {
      setConsultando(false);
    }
  }

  function calcularManual() {
    const pct = Number(percentualManual.replace(",", ".").trim());
    if (!Number.isFinite(pct) || pct <= 0) {
      toast.error("Informe um percentual acumulado positivo válido.");
      return;
    }
    const calculado = calcularReajusteAcumulado({
      valorBase,
      pontosMensais: [{ data: `01/${dataFinal.slice(5, 7)}/${dataFinal.slice(0, 4)}`, valor: pct }],
      indice,
      dataInicialISO: dataInicial,
      dataFinalISO: dataFinal,
    });
    setResultado(calculado);
  }

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => setAberto(true)}
      >
        <Calculator className="mr-2 h-4 w-4" /> Abrir calculadora oficial BCB (IPCA/INPC/IGP-M)
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <Calculator className="h-4 w-4 text-primary" />
          Calculadora Oficial de Reajuste (Banco Central — SGS)
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setAberto(false)}
        >
          Ocultar
        </Button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label className="text-xs">Índice oficial</Label>
          <Select value={indice} onValueChange={(v) => setIndice(v as CodigoIndiceReajuste)}>
            <SelectTrigger className="h-8 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(INDICES_REAJUSTE_BCB).map((def) => (
                <SelectItem key={def.codigo} value={def.codigo}>
                  {def.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Início da apuração</Label>
          <Input
            type="date"
            className="h-8 bg-background text-xs"
            value={dataInicial}
            onChange={(e) => setDataInicial(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Fim da apuração</Label>
          <Input
            type="date"
            className="h-8 bg-background text-xs"
            value={dataFinal}
            onChange={(e) => setDataFinal(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" size="sm" onClick={consultarBcb} disabled={consultando}>
          {consultando ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Consultar BCB e Calcular
        </Button>

        <div className="flex items-end gap-1.5">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Ou % manual</Label>
            <Input
              className="h-8 w-24 bg-background text-xs"
              inputMode="decimal"
              placeholder="Ex: 4,62"
              value={percentualManual}
              onChange={(e) => setPercentualManual(e.target.value)}
            />
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={calcularManual}>
            Simular %
          </Button>
        </div>
      </div>

      {resultado && (
        <div className="space-y-2 rounded border bg-background p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Acumulado ({resultado.mesesConsiderados} comp.):{" "}
              <strong>
                {resultado.percentualAcumulado.toLocaleString("pt-BR", {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4,
                })}
                %
              </strong>
            </span>
            <span>
              Reajuste: <strong className="text-primary">{formatarMoeda(resultado.valorReajuste)}</strong>{" "}
              → Novo total: <strong>{formatarMoeda(resultado.valorAtualizado)}</strong>
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">{resultado.memorialCalculo}</p>
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => {
              onApply(resultado.valorReajuste, resultado.memorialCalculo);
              toast.success("Valor e memória de cálculo aplicados ao termo de reajuste.");
            }}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> Aplicar valor e memória de cálculo no termo
          </Button>
        </div>
      )}
    </div>
  );
}
