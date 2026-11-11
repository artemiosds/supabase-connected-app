import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportarCsv, imprimirRelatorio, type CsvColumn } from "@/lib/csv-export";

export function ReportExportActions<Row>(props: {
  title: string;
  filename: string;
  columns: readonly CsvColumn<Row>[];
  rows: readonly Row[];
  disabled?: boolean;
}) {
  function imprimir() {
    if (!imprimirRelatorio(props.title, props.columns, props.rows)) {
      toast.error("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema.");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled || props.rows.length === 0}
        onClick={() => exportarCsv(props.filename, props.columns, props.rows)}
      >
        <Download className="h-4 w-4" aria-hidden /> Exportar Excel (CSV)
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled || props.rows.length === 0}
        onClick={imprimir}
      >
        <Printer className="h-4 w-4" aria-hidden /> Imprimir / salvar PDF
      </Button>
    </div>
  );
}
