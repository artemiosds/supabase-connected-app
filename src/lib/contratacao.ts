// Regras de negócio puras de Contratos e Processos de Contratação.

export const ETAPAS = [
  { id: "planejamento", nome: "Planejamento", descricao: "DFD e alinhamento com o PCA" },
  { id: "estudos", nome: "Estudos preliminares", descricao: "ETP e matriz de riscos" },
  { id: "objeto", nome: "Definição do objeto", descricao: "Termo de Referência ou Projeto Básico" },
  { id: "pesquisa", nome: "Pesquisa de preços", descricao: "Cotações e mapa comparativo" },
  { id: "parecer", nome: "Pareceres", descricao: "Jurídico e controle interno" },
  { id: "conclusao", nome: "Conclusão", descricao: "Envio à licitação ou ratificação" },
] as const;

export type EtapaId = (typeof ETAPAS)[number]["id"];

export const CHECKLIST_PADRAO: Record<EtapaId, string[]> = {
  planejamento: ["DFD — Documento de Formalização da Demanda", "Previsão no PCA"],
  estudos: ["ETP — Estudo Técnico Preliminar", "Matriz de gerenciamento de riscos"],
  objeto: ["Termo de Referência / Projeto Básico"],
  pesquisa: ["Cotações de preços (mín. 3)", "Mapa comparativo de preços"],
  parecer: ["Parecer jurídico", "Manifestação do controle interno"],
  conclusao: ["Autorização da autoridade competente", "Encaminhamento à licitação"],
};

export const MODALIDADES: Record<string, string> = {
  pregao: "Pregão",
  concorrencia: "Concorrência",
  dispensa: "Dispensa",
  inexigibilidade: "Inexigibilidade",
  adesao_ata: "Adesão a ata",
  outro: "Outro",
};

export function proximaEtapa(atual: EtapaId): EtapaId | null {
  const i = ETAPAS.findIndex((e) => e.id === atual);
  return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1]!.id : null;
}

export function etapaAnterior(atual: EtapaId): EtapaId | null {
  const i = ETAPAS.findIndex((e) => e.id === atual);
  return i > 0 ? ETAPAS[i - 1]!.id : null;
}

/** Régua de alertas de vencimento: 120, 90, 60 e 30 dias. */
export type NivelAlerta = "vencido" | "30" | "60" | "90" | "120" | "ok";

export function diasAte(dataFim: string, hoje: Date = new Date()): number {
  const [a = 0, m = 1, d = 1] = dataFim.split("-").map(Number);
  const fim = Date.UTC(a, m - 1, d);
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((fim - base) / 86_400_000);
}

export function nivelAlerta(dias: number): NivelAlerta {
  if (dias < 0) return "vencido";
  if (dias <= 30) return "30";
  if (dias <= 60) return "60";
  if (dias <= 90) return "90";
  if (dias <= 120) return "120";
  return "ok";
}

/**
 * Parses decimal text from Brazilian and international keyboards.
 * Examples: 1.234,56; 1234,56; 1,234.56; 1234.56.
 * Ambiguous single separators are treated as decimal separators, not grouping.
 */
export function numeroDecimal(valor: string): number {
  const texto = valor.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!texto) return Number.NaN;

  const ultimaVirgula = texto.lastIndexOf(",");
  const ultimoPonto = texto.lastIndexOf(".");
  let normalizado = texto;

  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    normalizado =
      ultimaVirgula > ultimoPonto
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto.replace(/,/g, "");
  } else if (ultimaVirgula >= 0) {
    const temVirgulasRepetidas = (texto.match(/,/g) ?? []).length > 1;
    normalizado =
      temVirgulasRepetidas && /^[-+]?\d{1,3}(,\d{3})+$/.test(texto)
        ? texto.replace(/,/g, "")
        : texto.replace(",", ".");
  } else if ((texto.match(/\./g) ?? []).length > 1) {
    normalizado = /^[-+]?\d{1,3}(\.\d{3})+$/.test(texto)
      ? texto.replace(/\./g, "")
      : texto;
  }

  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizado)) {
    return Number.NaN;
  }
  return Number(normalizado);
}

export const ROTULO_ALERTA: Record<NivelAlerta, string> = {
  vencido: "Vencido",
  "30": "Vence em até 30 dias",
  "60": "Vence em até 60 dias",
  "90": "Vence em até 90 dias",
  "120": "Vence em até 120 dias",
  ok: "Em dia",
};

export const ORIENTACAO_ALERTA: Record<NivelAlerta, string> = {
  vencido: "Contrato vencido: não execute serviços sem cobertura contratual.",
  "30": "Urgente: formalize o aditivo ou a nova contratação imediatamente.",
  "60": "Prazo crítico: abra o termo aditivo de prorrogação.",
  "90": "Notifique gestor e fiscal para definir as providências.",
  "120": "Planeje a renovação ou o novo processo de contratação.",
  ok: "Nenhuma ação necessária no momento.",
};

export function formatarMoeda(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
