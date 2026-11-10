import { diasAte, nivelAlerta, type NivelAlerta } from "@/lib/contratacao";

export type ContratoParaAlerta = {
  id: string;
  number: string;
  end_date: string;
};

export type DocumentoParaAlerta = {
  id: string;
  title: string;
  expires_at: string | null;
  suppliers:
    | {
        legal_name: string | null;
        trade_name: string | null;
      }
    | null;
};

export type AvisoVencimento = {
  id: string;
  tipo: "Contrato" | "Documento";
  titulo: string;
  complemento: string | null;
  dias: number;
  nivel: NivelAlerta;
  destino: "/contratos" | "/documentos";
};

export function dataLimiteAvisosISO(hoje: Date, diasAntecedencia = 120): string {
  const limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + diasAntecedencia);
  return [
    limite.getFullYear(),
    String(limite.getMonth() + 1).padStart(2, "0"),
    String(limite.getDate()).padStart(2, "0"),
  ].join("-");
}

export function calcularAvisosVencimento(
  contratos: ContratoParaAlerta[],
  documentos: DocumentoParaAlerta[],
  hoje = new Date(),
): AvisoVencimento[] {
  const avisosContratos: AvisoVencimento[] = contratos.map((contrato) => {
    const dias = diasAte(contrato.end_date, hoje);
    return {
      id: contrato.id,
      tipo: "Contrato",
      titulo: `Contrato nº ${contrato.number}`,
      complemento: null,
      dias,
      nivel: nivelAlerta(dias),
      destino: "/contratos",
    };
  });

  const avisosDocumentos: AvisoVencimento[] = documentos.flatMap((documento) => {
    if (!documento.expires_at) return [];
    const dias = diasAte(documento.expires_at, hoje);
    const fornecedor = documento.suppliers?.trade_name || documento.suppliers?.legal_name;
    return [
      {
        id: documento.id,
        tipo: "Documento",
        titulo: documento.title,
        complemento: fornecedor ? `Fornecedor: ${fornecedor}` : null,
        dias,
        nivel: nivelAlerta(dias),
        destino: "/documentos",
      },
    ];
  });

  return [...avisosContratos, ...avisosDocumentos].sort(
    (a, b) => a.dias - b.dias || a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
}
