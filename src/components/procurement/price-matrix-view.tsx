import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatarMoeda } from "@/lib/contratacao";
import { avaliarValidadeCotacoes } from "@/lib/pesquisa-precos";
import {
  buildPriceMatrix,
  isApproved,
  type MatrixItem,
  type MatrixQuote,
  type MatrixApproval,
} from "@/lib/price-matrix-helper";

export function PriceMatrixView({
  items,
  quotes,
  approvals,
}: {
  items: MatrixItem[];
  quotes: MatrixQuote[];
  approvals: MatrixApproval[];
}) {
  const matrix = useMemo(() => buildPriceMatrix(items, quotes), [items, quotes]);
  const validade = useMemo(
    () => avaliarValidadeCotacoes(quotes.filter((q) => q.is_active !== false)),
    [quotes],
  );
  const money = (value: number | null) => (value === null ? "—" : formatarMoeda(value));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Valores unitários efetivos com frete rateado. Cada cotação ativa aparece na célula da
        respectiva fonte, inclusive propostas distintas do mesmo fornecedor. Os indicadores
        consideram todas as amostras válidas.
      </p>
      {validade.expiradas.length > 0 && (
        <Alert className="border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs">
            {validade.expiradas.length} cotação(ões) ativa(s) excedem a janela recomendada pela IN
            SEGES/ME nº 65/2021 (12 meses para painéis/contratações públicas/NFs ou 6 meses para
            mídia/pesquisa direta). Revise as datas na guia Detalhamento.
          </AlertDescription>
        </Alert>
      )}
      <div className="max-h-[55vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              {[
                "Item",
                "Qtd / un.",
                ...matrix.columns.map((c) => c.label),
                "Menor",
                "Mediana",
                "Média",
                "CV%",
                "Situação",
              ].map((label, i) => (
                <th scope="col" key={i} className="min-w-24 border-b p-2 text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map(({ item, cells, summary }) => (
              <tr key={item.id} className="border-b">
                <th scope="row" className="min-w-48 p-2 text-left">
                  {item.line_number}. {item.description}
                </th>
                <td className="p-2">
                  {item.quantity} {item.unit}
                </td>
                {matrix.columns.map((c) => (
                  <td key={c.id} className="space-y-1 p-2 whitespace-nowrap">
                    {cells[c.id]?.map((v) => (
                      <div key={v.id}>
                        {v.price === summary.menor ? (
                          <Badge
                            className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100"
                            title="Menor preço do item"
                          >
                            {money(v.price)}
                          </Badge>
                        ) : (
                          money(v.price)
                        )}
                      </div>
                    )) ?? "—"}
                  </td>
                ))}
                <td className="p-2 whitespace-nowrap">{money(summary.menor)}</td>
                <td className="p-2 whitespace-nowrap">{money(summary.mediana)}</td>
                <td className="p-2 whitespace-nowrap">{money(summary.media)}</td>
                <td className="p-2">
                  {summary.coeficienteVariacao === null ? (
                    "—"
                  ) : summary.coeficienteVariacao > 25 ? (
                    <Badge
                      className="bg-amber-100 text-amber-950 hover:bg-amber-100"
                      title="Dispersão > 25%"
                    >
                      {summary.coeficienteVariacao.toFixed(2)}%
                    </Badge>
                  ) : (
                    summary.coeficienteVariacao.toFixed(2) + "%"
                  )}
                </td>
                <td className="p-2">
                  <Badge
                    className={
                      isApproved(item, approvals)
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-950"
                    }
                  >
                    {isApproved(item, approvals) ? "Aprovado" : "Pendente"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!matrix.rows.length && <p>Nenhum item ativo.</p>}
    </div>
  );
}
