import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { formatarData, formatarMoeda } from "@/lib/contratacao";
import { db } from "@/lib/db";
import { normalizeHealthUnit } from "@/lib/procurement-items-parser";
import {
  calcularEstatisticasPrecosPublicos,
  consultarPrecosPublicos,
  montarPayloadCotacaoPublica,
  type PublicPriceSearchMode,
  type PublicPriceSearchResult,
} from "@/lib/public-prices";

const ESTADOS_BR = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;

type ItemOption = {
  id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit: string;
  is_active: boolean;
};

type Props = {
  tenantId: string;
  userId: string;
  items: ItemOption[];
  canImport?: boolean;
  onSaved: () => Promise<void>;
};

export function PublicPriceSearchDialog({
  tenantId,
  userId,
  items,
  canImport = true,
  onSaved,
}: Props) {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const scope = useRef({ tenant: selecionado?.id, user: session?.user.id });
  scope.current = { tenant: selecionado?.id, user: session?.user.id };
  const inScope = () => scope.current.tenant === tenantId && scope.current.user === userId;

  const activeItems = useMemo(() => items.filter((item) => item.is_active), [items]);
  const [open, setOpen] = useState(false);
  const [targetItemId, setTargetItemId] = useState("");
  const [mode, setMode] = useState<PublicPriceSearchMode>("catmat");
  const [code, setCode] = useState("");
  const [uf, setUf] = useState("ALL");
  const [months, setMonths] = useState<"6" | "12" | "24">("12");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<PublicPriceSearchResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const importLockRef = useRef(false);

  useEffect(() => {
    if (!targetItemId && activeItems[0]) {
      setTargetItemId(activeItems[0].id);
    }
  }, [activeItems, targetItemId]);

  const targetItem = activeItems.find((item) => item.id === targetItemId) ?? activeItems[0];

  const selectedRecords = useMemo(() => {
    if (!result) return [];
    return result.records.filter((record) => selectedIds.has(record.id));
  }, [result, selectedIds]);

  const selectedStats = useMemo(
    () => calcularEstatisticasPrecosPublicos(selectedRecords.map((r) => r.unitPrice)),
    [selectedRecords],
  );

  async function handleSearch(requestedPage = 1) {
    if (!inScope()) {
      toast.error("A sessão ou a Secretaria mudou. Reabra o processo.");
      return;
    }
    const cleanCode = code.replace(/\D/g, "");
    if (!cleanCode) {
      toast.error("Informe o código numérico CATMAT, PDM ou CATSER.");
      return;
    }

    setLoading(true);
    setSelectedIds(new Set());
    try {
      const data = await consultarPrecosPublicos({
        tenantId,
        mode,
        code: cleanCode,
        ...(uf === "ALL" ? {} : { uf }),
        months: Number(months) as 6 | 12 | 24,
        page: requestedPage,
        pageSize: 20,
      });
      if (!inScope()) return;
      setResult(data);
      if (data.records.length === 0) {
        toast.info("Nenhum preço homologado encontrado para esses filtros no período.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao consultar o portal Compras.gov.br.",
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleRecord(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!result) return;
    if (selectedIds.size === result.records.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(result.records.map((r) => r.id)));
    }
  }

  async function handleImport() {
    if (importLockRef.current) return;
    if (!canImport) {
      toast.error("Seu perfil não possui permissão para importar cotações nesta Secretaria.");
      return;
    }
    if (!inScope()) {
      toast.error("A sessão ou a Secretaria mudou. Reabra o processo.");
      return;
    }
    if (!targetItem) {
      toast.error("Cadastre e selecione um item do processo antes de importar preços.");
      return;
    }
    if (!result || selectedRecords.length === 0) {
      toast.error("Selecione ao menos uma referência de preço para importar.");
      return;
    }

    importLockRef.current = true;
    setImporting(true);
    try {
      const access = await db.rpc("get_document_capabilities", { p_tenant_id: tenantId });
      if (access.error || !access.data?.[0]?.can_create) {
        throw new Error("Seu perfil não possui permissão para cadastrar cotações nesta Secretaria.");
      }
      if (!inScope()) return;
      const payloads = selectedRecords.map((record) =>
        montarPayloadCotacaoPublica({
          tenantId,
          procurementItemId: targetItem.id,
          itemQuantity: targetItem.quantity,
          userId,
          queriedAt: result.queriedAt,
          record,
        }),
      );
      const { error } = await db.from("procurement_price_quotes").insert(payloads);
      if (error) throw error;
      toast.success(
        `${payloads.length} referência(s) oficial(is) importada(s) para o item ${targetItem.line_number}.`,
      );
      setSelectedIds(new Set());
      await onSaved();
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível importar os preços selecionados.",
      );
    } finally {
      importLockRef.current = false;
      setImporting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={activeItems.length === 0 || !canImport}
        onClick={() => setOpen(true)}
      >
        <Database className="mr-2 h-4 w-4" />
        Preços Públicos (Compras.gov / PNCP)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Consulta Oficial de Preços Públicos — Compras.gov.br / PNCP
            </DialogTitle>
            <DialogDescription>
              Pesquisa gratuita em tempo real na base oficial de Dados Abertos do Governo Federal
              (Lei nº 14.133/2021, art. 23 e IN SEGES nº 65/2021) com rastreabilidade automática.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-12">
            <div className="space-y-1 sm:col-span-12">
              <Label>Item do processo que receberá as cotações *</Label>
              <Select value={targetItem?.id ?? ""} onValueChange={setTargetItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o item" />
                </SelectTrigger>
                <SelectContent>
                  {activeItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      Item {item.line_number} — {item.description} ({item.quantity} {item.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-3">
              <Label>Tipo de código</Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as PublicPriceSearchMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="catmat">CATMAT (Material)</SelectItem>
                  <SelectItem value="pdm">PDM (Grupo Material)</SelectItem>
                  <SelectItem value="catser">CATSER (Serviço)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-3">
              <Label>Código oficial *</Label>
              <Input
                inputMode="numeric"
                placeholder={
                  mode === "pdm" ? "Ex: 17708" : mode === "catser" ? "Ex: 5380" : "Ex: 267203"
                }
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSearch();
                  }
                }}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>UF (opcional)</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todo o Brasil</SelectItem>
                  {ESTADOS_BR.map((estado) => (
                    <SelectItem key={estado} value={estado}>
                      {estado}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>Janela IN 65/2021</Label>
              <Select value={months} onValueChange={(v) => setMonths(v as "6" | "12" | "24")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">Últimos 6 meses</SelectItem>
                  <SelectItem value="12">Últimos 12 meses</SelectItem>
                  <SelectItem value="24">Últimos 24 meses</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end sm:col-span-2">
              <Button
                type="button"
                className="w-full"
                disabled={loading}
                onClick={() => void handleSearch(1)}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Consultar
              </Button>
            </div>
          </div>

          {months === "24" && (
            <Alert className="border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs">
                Atenção à IN SEGES/ME nº 65/2021 (art. 5º, II): contratações similares de outros
                entes devem ter no máximo 1 ano até a data da pesquisa, salvo justificativa
                excepcional nos autos.
              </AlertDescription>
            </Alert>
          )}

          {result?.catalogItem && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">CATMAT {result.catalogItem.code}</Badge>
                {result.catalogItem.pdmCode && (
                  <Badge variant="outline">
                    PDM {result.catalogItem.pdmCode} — {result.catalogItem.pdmName}
                  </Badge>
                )}
                {result.catalogItem.ncm && (
                  <Badge variant="outline">NCM {result.catalogItem.ncm}</Badge>
                )}
              </div>
              <p className="mt-1 font-medium">{result.catalogItem.description}</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-5">
                <div className="rounded-md border p-2.5 text-xs">
                  <p className="text-muted-foreground">Amostras / Total API</p>
                  <p className="text-base font-semibold">
                    {result.records.length} / {result.totalRegistros}
                  </p>
                </div>
                <div className="rounded-md border p-2.5 text-xs">
                  <p className="text-muted-foreground">Menor preço</p>
                  <p className="text-base font-semibold">
                    {result.stats.min !== null ? formatarMoeda(result.stats.min) : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-2.5 text-xs">
                  <p className="text-muted-foreground">Mediana</p>
                  <p className="text-base font-semibold text-primary">
                    {result.stats.median !== null ? formatarMoeda(result.stats.median) : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-2.5 text-xs">
                  <p className="text-muted-foreground">Média</p>
                  <p className="text-base font-semibold">
                    {result.stats.average !== null ? formatarMoeda(result.stats.average) : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-2.5 text-xs">
                  <p className="text-muted-foreground">Coef. Variação (CV)</p>
                  <p className="text-base font-semibold">
                    {result.stats.cvPercent !== null ? `${result.stats.cvPercent}%` : "—"}
                    {result.stats.cvPercent !== null && (
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                        {result.stats.cvPercent <= 25 ? "(Homogênea)" : "(Alta dispersão)"}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {selectedRecords.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
                  <span>
                    <strong>{selectedRecords.length}</strong> selecionada(s) · Mediana da seleção:{" "}
                    <strong>
                      {selectedStats.median !== null ? formatarMoeda(selectedStats.median) : "—"}
                    </strong>
                  </span>
                  <a
                    href={result.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    Ver JSON oficial <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {result.records.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhum registro retornado pelo Compras.gov.br para o código e filtros informados.
                </p>
              ) : (
                <div className="max-h-[340px] overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-left">
                      <tr>
                        <th className="w-9 p-2">
                          <Checkbox
                            aria-label="Selecionar todos"
                            checked={
                              result.records.length > 0 &&
                              selectedIds.size === result.records.length
                            }
                            onCheckedChange={toggleAll}
                          />
                        </th>
                        <th className="p-2">Órgão / Localidade</th>
                        <th className="p-2">Fornecedor / Marca</th>
                        <th className="p-2">Data</th>
                        <th className="p-2">Unidade</th>
                        <th className="p-2 text-right">Preço Unit.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.records.map((rec) => {
                        const checked = selectedIds.has(rec.id);
                        return (
                          <tr
                            key={rec.id}
                            className={`border-t hover:bg-muted/40 ${checked ? "bg-primary/5" : ""}`}
                          >
                            <td className="p-2">
                              <Checkbox
                                aria-label={`Selecionar compra ${rec.idCompra}`}
                                checked={checked}
                                onCheckedChange={() => toggleRecord(rec.id)}
                              />
                            </td>
                            <td className="p-2">
                              <p className="font-medium">{rec.organName}</p>
                              <p className="text-muted-foreground">
                                {[rec.municipio, rec.uf].filter(Boolean).join("/") || "BR"} ·{" "}
                                {rec.referenceIdentifier}
                              </p>
                            </td>
                            <td className="p-2">
                              <p>{rec.supplierName || "Fornecedor não informado"}</p>
                              <p className="text-muted-foreground">
                                {[rec.supplierCnpj, rec.brand].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {formatarData(rec.purchaseDate)}
                            </td>
                            <td className="p-2">
                              <span>{rec.unit}</span>
                              {targetItem &&
                                rec.unit &&
                                normalizeHealthUnit(rec.unit) !==
                                  normalizeHealthUnit(targetItem.unit) && (
                                  <Badge
                                    variant="outline"
                                    className="ml-1.5 border-amber-400 text-[10px] text-amber-800"
                                    title={`Item usa ${targetItem.unit}`}
                                  >
                                    Difere de {targetItem.unit}
                                  </Badge>
                                )}
                            </td>
                            <td className="p-2 text-right font-semibold whitespace-nowrap">
                              {formatarMoeda(rec.unitPrice)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {result.totalPaginas > 1 && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Página {result.pagina} de {result.totalPaginas} ({result.totalRegistros}{" "}
                    registro(s) encontrados)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loading || result.pagina <= 1}
                      onClick={() => void handleSearch(result.pagina - 1)}
                    >
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Anterior
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loading || result.pagina >= result.totalPaginas}
                      onClick={() => void handleSearch(result.pagina + 1)}
                    >
                      Próxima <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              disabled={!canImport || importing || selectedRecords.length === 0 || !targetItem}
              onClick={() => void handleImport()}
            >
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckSquare className="mr-2 h-4 w-4" />
              )}
              Importar {selectedRecords.length > 0 ? `(${selectedRecords.length})` : ""} na Matriz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
