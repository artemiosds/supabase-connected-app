import { isSanctionCurrentlyEffective } from "./supplier-sanctions";

type DocumentoPerfil = { status: string; expires_at: string | null };
type SancaoPerfil = { status: string; start_date: string; end_date: string | null };
type InstrumentoPerfil = { instrument_type: string; status: string; end_date: string };

export function dataLocalIso(data = new Date()): string {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

export function diasAteDataIso(data: string | null, hoje: string): number | null {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const valor = Date.parse(`${data}T00:00:00Z`);
  const referencia = Date.parse(`${hoje}T00:00:00Z`);
  if (!Number.isFinite(valor) || !Number.isFinite(referencia)) return null;
  return Math.round((valor - referencia) / 86_400_000);
}

export type SituacaoDocumentoPerfil =
  | "arquivado"
  | "sem_vencimento"
  | "vencido"
  | "vence_hoje"
  | "a_vencer"
  | "em_dia";

export function situacaoDocumentoPerfil(
  documento: DocumentoPerfil,
  hoje: string,
): SituacaoDocumentoPerfil {
  if (documento.status !== "active") return "arquivado";
  const dias = diasAteDataIso(documento.expires_at, hoje);
  if (dias === null) return "sem_vencimento";
  if (dias < 0) return "vencido";
  if (dias === 0) return "vence_hoje";
  if (dias <= 30) return "a_vencer";
  return "em_dia";
}

/** Contagens apenas de registros realmente visíveis ao usuário; não inferir ausência se uma consulta falhar. */
export function resumirFichaFornecedor(
  documentos: DocumentoPerfil[],
  cotacoes: readonly unknown[],
  instrumentos: InstrumentoPerfil[],
  sancoes: SancaoPerfil[],
  hoje: string,
) {
  return {
    documentos: documentos.filter((d) => d.status === "active").length,
    vencidos: documentos.filter((d) => situacaoDocumentoPerfil(d, hoje) === "vencido").length,
    aVencer: documentos.filter((d) =>
      ["vence_hoje", "a_vencer"].includes(situacaoDocumentoPerfil(d, hoje)),
    ).length,
    cotacoes: cotacoes.length,
    contratos: instrumentos.filter((c) => c.instrument_type !== "ata_registro_precos").length,
    atas: instrumentos.filter((c) => c.instrument_type === "ata_registro_precos").length,
    vencimentosContratuais: instrumentos.filter((c) => {
      const dias = diasAteDataIso(c.end_date, hoje);
      return c.status === "vigente" && dias !== null && dias >= 0 && dias <= 30;
    }).length,
    sancoesVigentes: sancoes.filter((s) => isSanctionCurrentlyEffective(s, hoje)).length,
  };
}
