import { useState } from "react";
import { Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportarCsv, imprimirRelatorio, type CsvColumn } from "@/lib/csv-export";
import { exportarXlsx } from "@/lib/xlsx-export";

export function ReportExportActions<Row>(props: {
  title: string;
  filename: string;
  columns: readonly CsvColumn<Row>[];
  rows: readonly Row[];
  disabled?: boolean;
}) {
  const [gerandoXlsx, setGerandoXlsx] = useState(false);

  function imprimir() {
    if (!imprimirRelatorio(props.title, props.columns, props.rows)) {
      toast.error("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema.");
    }
  }

  async function baixarXlsx() {
    setGerandoXlsx(true);
    try {
      await exportarXlsx(props.filename, props.columns, props.rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a planilha.");
    } finally {
      setGerandoXlsx(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled || props.rows.length === 0 || gerandoXlsx}
        onClick={() => exportarCsv(props.filename, props.columns, props.rows)}
      >
        <Download className="h-4 w-4" aria-hidden /> Baixar CSV
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled || props.rows.length === 0 || gerandoXlsx}
        onClick={() => void baixarXlsx()}
      >
        {gerandoXlsx ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
        )}
        Baixar Excel (.xlsx)
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled || props.rows.length === 0 || gerandoXlsx}
        onClick={imprimir}
      >
        <Printer className="h-4 w-4" aria-hidden /> Imprimir / salvar PDF
      </Button>
    </div>
  );
}
