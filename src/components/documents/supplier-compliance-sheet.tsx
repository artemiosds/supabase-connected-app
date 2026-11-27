import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, ShieldCheck, XCircle } from "lucide-react";
import {
  CERTIDOES_ESSENCIAIS_ART68,
  avaliarConformidadeHabilitacaoFornecedores,
  type StatusCertidaoHabilitacao,
} from "@/lib/document-expiry-cockpit-helper";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData } from "@/lib/contratacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  fornecedores: Array<{
    id: string;
    legal_name?: string | null | undefined;
    trade_name?: string | null | undefined;
    cnpj?: string | null | undefined;
  }>;
  documentosFornecedor: Array<{
    id: string;
    supplier_id: string;
    document_type?: string | null | undefined;
    expires_at?: string | null | undefined;
  }>;
  busca: string;
  onFiltrarFornecedor?: (supplierId: string) => void;
}

function renderStatusPill(status: StatusCertidaoHabilitacao, expiresAt: string | null) {
  if (status === "regular") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        {expiresAt ? formatarData(expiresAt) : "Regular"}
      </Badge>
    );
  }
  if (status === "a_vencer") {
    return (
      <Badge variant="secondary" className="bg-amber-500/15 text-[10px] text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mr-1 h-3 w-3" />
        {expiresAt ? formatarData(expiresAt) : "Vence ≤30d"}
      </Badge>
    );
  }
  if (status === "vencida") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        <XCircle className="mr-1 h-3 w-3" />
        Vencida
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      <FileWarning className="mr-1 h-3 w-3" />
      Ausente
    </Badge>
  );
}

export function SupplierComplianceSheet(props: Props) {
  const [somentePendentes, setSomentePendentes] = useState(false);
  const [expandido, setExpandido] = useState(false);

  const fichas = useMemo(
    () =>
      avaliarConformidadeHabilitacaoFornecedores({
        fornecedores: props.fornecedores,
        documentosFornecedor: props.documentosFornecedor,
      }),
    [props.fornecedores, props.documentosFornecedor],
  );

  const totalAptos = useMemo(
    () => fichas.filter((f) => f.aptoParaEmpenhoPagamento).length,
    [fichas],
  );
  const totalComPendencia = fichas.length - totalAptos;

  const filtradas = useMemo(() => {
    const q = props.busca.trim().toLowerCase();
    return fichas.filter((f) => {
      if (somentePendentes && f.aptoParaEmpenhoPagamento) return false;
      if (!q) return true;
      return (
        f.fornecedorNome.toLowerCase().includes(q) ||
        (f.cnpj ? f.cnpj.toLowerCase().includes(q) : false)
      );
    });
  }, [fichas, somentePendentes, props.busca]);

  const visiveis = expandido ? filtradas : filtradas.slice(0, 6);

  if (props.fornecedores.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Ficha de Conformidade de Habilitação (Art. 68 — Empenho e Pagamento)
            </CardTitle>
            <CardDescription>
              Conferência das 5 certidões essenciais da Saúde (Federal, Estadual, Municipal, FGTS e
              CNDT) para liquidação e pagamento sem apontamentos do TCE.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
              Aptos: {totalAptos}
            </Badge>
            <Badge variant={totalComPendencia > 0 ? "destructive" : "secondary"}>
              Com pendências: {totalComPendencia}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant={somentePendentes ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setSomentePendentes((v) => !v)}
            >
              {somentePendentes ? "Mostrando pendentes" : "Filtrar pendentes"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {visiveis.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Nenhum fornecedor encontrado para os critérios selecionados.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-2.5 font-medium">Fornecedor</th>
                  {CERTIDOES_ESSENCIAIS_ART68.map((c) => (
                    <th key={c.tipo} className="p-2.5 font-medium">
                      {c.rotuloCurto}
                    </th>
                  ))}
                  <th className="p-2.5 font-medium">Situação p/ Empenho</th>
                  {props.onFiltrarFornecedor && (
                    <th className="p-2.5 text-right font-medium">Ação</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((f) => (
                  <tr key={f.fornecedorId} className="border-t">
                    <td className="p-2.5">
                      <p className="font-medium text-foreground">{f.fornecedorNome}</p>
                      {f.cnpj && (
                        <p className="text-[11px] text-muted-foreground">{formatarCnpj(f.cnpj)}</p>
                      )}
                    </td>
                    {f.certidoes.map((cert) => (
                      <td key={cert.tipo} className="p-2.5">
                        {renderStatusPill(cert.status, cert.expiresAt)}
                      </td>
                    ))}
                    <td className="p-2.5">
                      {f.aptoParaEmpenhoPagamento ? (
                        <Badge variant="default" className="bg-emerald-600 text-[10px]">
                          Apto (5/5)
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">
                          Pendência ({f.totalRegulares}/5)
                        </Badge>
                      )}
                    </td>
                    {props.onFiltrarFornecedor && (
                      <td className="p-2.5 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => props.onFiltrarFornecedor?.(f.fornecedorId)}
                        >
                          Filtrar docs
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtradas.length > 6 && (
          <div className="flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setExpandido((v) => !v)}
            >
              {expandido
                ? "Mostrar apenas os 6 primeiros fornecedores"
                : `Ver todos os ${filtradas.length} fornecedores na matriz Art. 68`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
