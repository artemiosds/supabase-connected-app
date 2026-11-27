import { useState } from "react";
import { Archive, CheckCircle2, Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { dataHojeLocalISO } from "@/lib/contratacao";

interface Props {
  tenantId: string;
  tenantName: string;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      for (const k of Object.keys(row)) set.add(k);
      return set;
    }, new Set<string>()),
  );
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (/[;"\r\n,]/.test(str)) {
      return `"${str.replaceAll('"', '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(";")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

async function fetchTenantTable(
  table: string,
  tenantId: string,
  orderColumn = "id",
): Promise<Record<string, unknown>[]> {
  try {
    return await carregarTodasAsPaginas<Record<string, unknown>>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db.from(table as any) as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .order(orderColumn, { ascending: true })
        .range(from, to),
    );
  } catch {
    return [];
  }
}

export function TenantManualBackupCard({ tenantId, tenantName }: Props) {
  const [exportando, setExportando] = useState(false);
  const [ultimoResumo, setUltimoResumo] = useState<{
    arquivo: string;
    totalRegistros: number;
    geradoEm: string;
  } | null>(null);

  async function handleExportarBackup() {
    if (!tenantId || exportando) return;
    setExportando(true);
    try {
      const [
        tenantRes,
        complianceRes,
        suppliers,
        demands,
        processes,
        processItems,
        contracts,
        amendments,
        supplierDocs,
        generatedDocs,
        auditEvents,
      ] = await Promise.all([
        db.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
        db.from("tenant_procurement_compliance").select("*").eq("tenant_id", tenantId).maybeSingle(),
        fetchTenantTable("suppliers", tenantId),
        fetchTenantTable("annual_procurement_demands", tenantId),
        fetchTenantTable("procurement_processes", tenantId),
        fetchTenantTable("process_items", tenantId),
        fetchTenantTable("contracts", tenantId),
        fetchTenantTable("contract_amendments", tenantId),
        fetchTenantTable("supplier_documents", tenantId),
        fetchTenantTable("generated_documents", tenantId),
        fetchTenantTable("audit_events", tenantId),
      ]);

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const contagens = {
        fornecedores: suppliers.length,
        demandas_pca: demands.length,
        processos: processes.length,
        checklist_processos: processItems.length,
        contratos_atas: contracts.length,
        aditivos: amendments.length,
        certidoes_fornecedores: supplierDocs.length,
        documentos_gerados: generatedDocs.length,
        eventos_auditoria: auditEvents.length,
      };
      const totalRegistros = Object.values(contagens).reduce((a, b) => a + b, 0);

      const resumo = {
        sistema: "Primus Gestão — Saúde Pública",
        gerado_em: new Date().toISOString(),
        organizacao_id: tenantId,
        organizacao_nome: tenantName,
        dados_cadastrais: tenantRes.data ?? null,
        regulamento_municipal: complianceRes.data ?? null,
        contagens,
      };

      zip.file("00_RESUMO_ORGANIZACAO.json", JSON.stringify(resumo, null, 2));
      zip.file(
        "LEIA-ME.txt",
        [
          `BACKUP MANUAL DA ORGANIZACAO: ${tenantName}`,
          `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
          `Total de registros extraidos: ${totalRegistros}`,
          "",
          "Estrutura de pastas:",
          "- 01_fornecedores/: Cadastro de fornecedores (CSV para Excel + JSON completo)",
          "- 02_pca/: Demandas do Plano de Contratacoes Anual (CSV + JSON)",
          "- 03_processos/: Processos licitatorios e itens de checklist (CSV + JSON)",
          "- 04_contratos/: Contratos, Atas e Termos Aditivos (CSV + JSON)",
          "- 05_documentos/: Certidoes de fornecedores e documentos gerados (CSV + JSON)",
          "- 06_auditoria/: Trilha de eventos e auditoria (CSV + JSON)",
          "",
          "Observacao: Este pacote contem exclusivamente dados acessiveis ao seu perfil nesta Secretaria.",
        ].join("\r\n"),
      );

      const addPair = (folder: string, baseName: string, rows: Record<string, unknown>[]) => {
        const dir = zip.folder(folder);
        if (!dir) return;
        dir.file(`${baseName}.json`, JSON.stringify(rows, null, 2));
        if (rows.length > 0) {
          dir.file(`${baseName}.csv`, toCsv(rows));
        }
      };

      addPair("01_fornecedores", "fornecedores", suppliers);
      addPair("02_pca", "demandas_pca", demands);
      addPair("03_processos", "processos", processes);
      addPair("03_processos", "checklist_processos", processItems);
      addPair("04_contratos", "contratos_atas", contracts);
      addPair("04_contratos", "termos_aditivos", amendments);
      addPair("05_documentos", "certidoes_fornecedores", supplierDocs);
      addPair("05_documentos", "documentos_gerados", generatedDocs);
      addPair("06_auditoria", "eventos_auditoria", auditEvents);

      const blob = await zip.generateAsync({ type: "blob" });
      const slug = tenantName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `backup-${slug || "secretaria"}-${dataHojeLocalISO()}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setUltimoResumo({
        arquivo: filename,
        totalRegistros,
        geradoEm: new Date().toLocaleTimeString("pt-BR"),
      });
      toast.success(`Backup gerado com ${totalRegistros} registro(s) organizados em pastas!`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar o pacote de backup.",
      );
    } finally {
      setExportando(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4 text-primary" />
            Backup Manual e Extração de Dados (.zip)
          </CardTitle>
          <CardDescription>
            Baixe todos os dados desta Secretaria organizados por pastas (CSV para Excel + JSON
            estruturado): Fornecedores, PCA, Processos, Contratos, Aditivos, Documentos e Auditoria.
          </CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0">
          <ShieldCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" />
          Isolado por organização
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3.5">
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Pacote completo pronto para guarda local ou TCE</p>
            <p>
              Inclui ficha cadastral, regulamento municipal e 6 pastas temáticas com arquivos abertos.
            </p>
          </div>
          <Button type="button" onClick={() => void handleExportarBackup()} disabled={exportando}>
            {exportando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {exportando ? "Gerando pacote .zip..." : "Baixar Backup Completo (.zip)"}
          </Button>
        </div>

        {ultimoResumo && (
          <Alert className="border-emerald-500/35 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Backup exportado com sucesso</AlertTitle>
            <AlertDescription className="text-xs">
              Arquivo <strong>{ultimoResumo.arquivo}</strong> gerado às {ultimoResumo.geradoEm} com{" "}
              <strong>{ultimoResumo.totalRegistros}</strong> registro(s).
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
