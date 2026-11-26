import { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  PlusCircle,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Sparkles,
  FileBadge,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listarVerificacoesRegularidade,
  registrarVerificacaoRegularidade,
  rotuloStatusRegularidade,
  FONTES_OFICIAIS,
  type SupplierRegularityCheck,
  type RegularitySource,
  type RegularityStatus,
} from "@/lib/supplier-regularity";
import { consultarRegularidadeAutomatica } from "@/lib/supplier-regularity-lookup";
import { formatarData } from "@/lib/contratacao";
import { formatarCnpj } from "@/lib/cnpj";

interface SupplierRegularityPanelProps {
  tenantId: string;
  supplierId: string;
  supplierCnpj: string;
  canEdit?: boolean;
}

export function SupplierRegularityPanel({
  tenantId,
  supplierId,
  supplierCnpj,
  canEdit = true,
}: SupplierRegularityPanelProps) {
  const [verificacoes, setVerificacoes] = useState<SupplierRegularityCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Modal de registro
  const [modalAberta, setModalAberta] = useState(false);
  const [fonte, setFonte] = useState<RegularitySource>("rfb_cnpj");
  const [status, setStatus] = useState<RegularityStatus>("regular");
  const [certidaoNumero, setCertidaoNumero] = useState("");
  const [validade, setValidade] = useState("");
  const [evidenciaUrl, setEvidenciaUrl] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [exigeProvidencia, setExigeProvidencia] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [consultandoAuto, setConsultandoAuto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLoading(true);
      setErro(null);
      const lista = await listarVerificacoesRegularidade(tenantId, supplierId);
      setVerificacoes(lista);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar verificações de regularidade.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supplierId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSalvando(true);
      await registrarVerificacaoRegularidade({
        tenantId,
        supplierId,
        source: fonte,
        status,
        certificateNumber: certidaoNumero.trim() || undefined,
        validUntil: validade || undefined,
        evidenceUrl: evidenciaUrl.trim() || undefined,
        notes: observacoes.trim() || undefined,
        requiresAction: exigeProvidencia,
      });

      setModalAberta(false);
      setCertidaoNumero("");
      setValidade("");
      setEvidenciaUrl("");
      setObservacoes("");
      setExigeProvidencia(false);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao registrar verificação de regularidade.");
    } finally {
      setSalvando(false);
    }
  };

  const handleConsultaAutomatica = async () => {
    const cleanCnpj = supplierCnpj.replace(/\D/g, "");
    if (cleanCnpj.length !== 14) {
      toast.error("Esta consulta automática exige CNPJ com 14 dígitos.");
      return;
    }
    try {
      setConsultandoAuto(true);
      setErro(null);
      const res = await consultarRegularidadeAutomatica({ tenantId, cnpj: cleanCnpj });
      if (res.checks.length === 0) {
        toast.warning(res.warnings[0] || "Nenhum portal respondeu à consulta automática.");
        return;
      }
      await Promise.all(
        res.checks.map((item) =>
          registrarVerificacaoRegularidade({
            tenantId,
            supplierId,
            source: item.source,
            sourceLabel: item.sourceLabel,
            status: item.status,
            certificateNumber: item.certificateNumber ?? undefined,
            evidenceUrl: item.evidenceUrl ?? undefined,
            notes: item.notes,
            requiresAction: item.requiresAction,
          }),
        ),
      );
      await carregar();
      const irregulares = res.checks.filter((c) => c.status === "irregular").length;
      if (irregulares > 0) {
        toast.error(
          `${res.checks.length} fonte(s) registrada(s): ${irregulares} apontou/apontaram ocorrência ou restrição!`,
        );
      } else {
        toast.success(
          `${res.checks.length} verificação(ões) oficial(is) registrada(s) automaticamente (TCU/CNJ/CEIS/CNEP/RFB).`,
        );
      }
      if (res.warnings.length > 0) {
        toast.warning(res.warnings.join(" "));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha na consulta automática de regularidade.";
      setErro(msg);
      toast.error(msg);
    } finally {
      setConsultandoAuto(false);
    }
  };

  const temIrregularidade = verificacoes.some((v) => v.status === "irregular" || v.requires_action);

  return (
    <div className="space-y-4">
      {erro && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Alerta de regularidade ativa */}
      {temIrregularidade && (
        <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="font-semibold">Atenção: Consta Ocorrência ou Providência Pendente</p>
            <p className="mt-0.5 text-rose-800 dark:text-rose-300">
              Foram registradas verificações apontando irregularidades ou pendências que demandam
              análise pela autoridade competente antes de atos de contratação ou pagamento.
            </p>
          </div>
        </div>
      )}

      {/* Fontes Oficiais - Consultas Rápidas */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Search className="h-4 w-4" /> Portais Oficiais de Consulta
              </CardTitle>
              <CardDescription className="text-xs">
                Acesse as fontes oficiais para consulta em tempo real do CNPJ{" "}
                {formatarCnpj(supplierCnpj)}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={carregar} disabled={loading}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleConsultaAutomatica()}
                  disabled={consultandoAuto}
                  title="Consulta gratuita em tempo real no TCU (Inidôneos), CNJ (CNIA), CGU (CEIS/CNEP) e Receita Federal"
                >
                  <Sparkles
                    className={`mr-1.5 h-3.5 w-3.5 ${consultandoAuto ? "animate-pulse" : ""}`}
                  />
                  {consultandoAuto ? "Consultando portais..." : "Verificar TCU / CEIS / RFB"}
                </Button>
              )}
              {canEdit && (
                <Button size="sm" onClick={() => setModalAberta(true)}>
                  <PlusCircle className="mr-1.5 h-4 w-4" />
                  Registrar Verificação
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {(
              [
                "rfb_cnpj",
                "ceis_cgu",
                "cnep_cgu",
                "tst_cndt",
                "caixa_fgts",
                "anvisa_afe",
              ] as RegularitySource[]
            ).map((key) => {
              const info = FONTES_OFICIAIS[key];
              return (
                <div
                  key={key}
                  className="rounded-lg border p-2.5 text-xs bg-muted/20 flex flex-col justify-between gap-2"
                >
                  <div>
                    <span className="font-semibold text-foreground block">{info.label}</span>
                    <span className="text-[11px] text-muted-foreground line-clamp-2">
                      {info.description}
                    </span>
                  </div>
                  {info.url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs w-full justify-between px-2 text-primary"
                      asChild
                    >
                      <a href={info.url} target="_blank" rel="noopener noreferrer">
                        <span>Acessar Portal Oficial</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Histórico de Verificações Realizadas */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <FileBadge className="h-4 w-4" /> Histórico de Regularidade e Consultas Registradas
          </CardTitle>
          <CardDescription className="text-xs">
            Registro auditável de consultas com número da certidão, validade e comprovação de
            evidências.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Carregando histórico de regularidade...
            </div>
          ) : verificacoes.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground border rounded-md border-dashed">
              <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
              <p className="font-medium">Nenhuma verificação oficial registrada</p>
              <p className="text-[11px] mt-0.5">
                Utilize os links oficiais acima para consultar e registre o resultado formalmente.
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px] bg-muted/40">
                    <TableHead>Fonte Consultada</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Certidão / Protocolo</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Data da Consulta</TableHead>
                    <TableHead className="text-right">Evidência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {verificacoes.map((item) => {
                    const statusMeta = rotuloStatusRegularidade(item.status);
                    return (
                      <TableRow key={item.id} className="text-xs">
                        <TableCell className="font-medium">
                          {item.source_label}
                          {item.requires_action && (
                            <Badge variant="destructive" className="ml-1.5 text-[9px] px-1 py-0">
                              Exige Providência
                            </Badge>
                          )}
                          {item.notes && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                              Obs: {item.notes}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusMeta.badgeVariant}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {statusMeta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-[11px]">
                          {item.certificate_number || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[11px]">
                          {formatarData(item.valid_until)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[11px]">
                          {formatarData(item.checked_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.evidence_url ? (
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" asChild>
                              <a href={item.evidence_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Abrir
                              </a>
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal: Registrar Verificação */}
      <Dialog open={modalAberta} onOpenChange={setModalAberta}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSalvar}>
            <DialogHeader>
              <DialogTitle>Registrar Consulta de Regularidade</DialogTitle>
              <DialogDescription>
                Registro formal de verificação oficial com dados da certidão e evidência.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="fonte">Fonte Oficial / Órgão Consultador</Label>
                <Select value={fonte} onValueChange={(v) => setFonte(v as RegularitySource)}>
                  <SelectTrigger id="fonte">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FONTES_OFICIAIS).map(([key, info]) => (
                      <SelectItem key={key} value={key}>
                        {info.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="status">Resultado da Verificação</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as RegularityStatus)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular / Nada Consta</SelectItem>
                    <SelectItem value="irregular">Irregular / Consta Ocorrência</SelectItem>
                    <SelectItem value="pending_review">Em Análise / Divergência</SelectItem>
                    <SelectItem value="not_found">Não Localizado</SelectItem>
                    <SelectItem value="exempt">Dispensado / Não Aplicável</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="certidao">Nº da Certidão / Hash</Label>
                  <Input
                    id="certidao"
                    placeholder="Ex: 2026.0482.91"
                    value={certidaoNumero}
                    onChange={(e) => setCertidaoNumero(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="validade">Validade da Certidão</Label>
                  <Input
                    id="validade"
                    type="date"
                    value={validade}
                    onChange={(e) => setValidade(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="evidencia">Link da Evidência / Comprovante</Label>
                <Input
                  id="evidencia"
                  placeholder="https://... ou protocolo público"
                  value={evidenciaUrl}
                  onChange={(e) => setEvidenciaUrl(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="obs">Observações / Detalhamento</Label>
                <Textarea
                  id="obs"
                  placeholder="Informações adicionais apuradas na consulta oficial..."
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-2 rounded-md border p-2 text-xs bg-muted/30">
                <input
                  type="checkbox"
                  id="providencia"
                  checked={exigeProvidencia}
                  onChange={(e) => setExigeProvidencia(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="providencia" className="cursor-pointer font-medium">
                  Exige providência administrativa ou saneamento formal
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalAberta(false)}
                disabled={salvando}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? "Registrando..." : "Registrar Consulta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
