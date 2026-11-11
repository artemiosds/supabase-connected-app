import { diasAte, formatarData, formatarMoeda, MODALIDADES } from "./contratacao";

export function selecionarContratosAVencerEm90Dias<T extends { status: string; end_date: string }>(
  contratos: T[],
  hoje: Date = new Date(),
): T[] {
  return contratos
    .filter((contrato) => {
      const dias = diasAte(contrato.end_date, hoje);
      return contrato.status === "vigente" && dias >= 0 && dias <= 90;
    })
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
}

export type LinhaRelatorioContrato = {
  number: string;
  object: string;
  supplier: string;
  process: string;
  modality: string;
  totalValue: number;
  endDate: string;
  manager: string;
  inspector: string;
  daysRemaining: number;
};

function celulaCsv(valor: string | number): string {
  let texto = String(valor).replace(/[\r\n]+/g, " ").trim();
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
  return '"' + texto.replace(/"/g, '""') + '"';
}

export function gerarCsvContratosAVencerEm90Dias(linhas: LinhaRelatorioContrato[]): string {
  const cabecalho = [
    "Contrato",
    "Objeto",
    "Fornecedor",
    "Processo",
    "Modalidade",
    "Valor total",
    "Fim da vigência",
    "Dias restantes",
    "Gestor",
    "Fiscal",
  ];
  const dados = linhas.map((linha) => [
    linha.number,
    linha.object,
    linha.supplier,
    linha.process,
    MODALIDADES[linha.modality] ?? linha.modality,
    formatarMoeda(linha.totalValue),
    formatarData(linha.endDate),
    linha.daysRemaining,
    linha.manager,
    linha.inspector,
  ]);
  return (
    "\uFEFF" + [cabecalho, ...dados].map((linha) => linha.map(celulaCsv).join(";")).join("\r\n")
  );
}
