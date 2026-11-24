import { useState } from "react";
import { Printer, Download, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  gerarHtmlDossie,
  imprimirDossieAdministrativo,
  type DossieCompletoParams,
} from "@/lib/supplier-dossier";

interface SupplierDossierModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  params: DossieCompletoParams | null;
}

export function SupplierDossierModal({
  open,
  onOpenChange,
  params,
}: SupplierDossierModalProps) {
  const [downloading, setDownloading] = useState(false);

  if (!params) return null;

  const htmlContent = gerarHtmlDossie(params);

  const handleDownloadHtml = () => {
    try {
      setDownloading(true);
      const safeName = params.fornecedor.legal_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 50);
      const filename = `dossie-${safeName}-${new Date().toISOString().slice(0, 10)}.html`;

      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    imprimirDossieAdministrativo(params);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl flex flex-col p-6">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Dossiê Administrativo e Cadastral
              </DialogTitle>
              <DialogDescription>
                Documento oficial consolidado para instrução de processos administrativos e contratações (Lei nº 14.133/2021).
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDownloadHtml} disabled={downloading}>
                <Download className="w-4 h-4 mr-1.5" />
                Baixar HTML
              </Button>
              <Button size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-1.5" />
                Imprimir / PDF
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Pré-visualização do documento */}
        <div className="flex-1 overflow-y-auto my-4 border rounded-md p-6 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-inner">
          <iframe
            srcDoc={htmlContent}
            title="Dossiê Administrativo Preview"
            className="w-full min-h-[600px] border-0 rounded"
          />
        </div>

        <DialogFooter className="pt-2 border-t border-border flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            Documento com hash de verificação e termo de fé pública integrado.
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
