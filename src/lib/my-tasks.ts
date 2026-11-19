import { diasAte } from "@/lib/contratacao";
import type { Tables } from "@/integrations/supabase/types";

export type ProcessoMinhaTarefa = Pick<
  Tables<"procurement_processes">,
  | "id"
  | "number"
  | "title"
  | "stage"
  | "status"
  | "responsible_user_id"
  | "responsible_name"
  | "due_date"
>;
export type EtapaMinhaTarefa = Pick<
  Tables<"process_items">,
  "process_id" | "stage" | "title" | "is_done" | "responsible_user_id" | "responsible_name"
>;
export type ContratoMinhaTarefa = Pick<
  Tables<"contracts">,
  "id" | "number" | "supplier_id" | "end_date" | "status" | "manager_user_id" | "inspector_user_id"
>;
export type DocumentoMinhaTarefa = Pick<
  Tables<"supplier_documents">,
  "id" | "supplier_id" | "title" | "document_type" | "expires_at" | "status"
>;

export type MinhaTarefa = {
  id: string;
  tipo: "processo" | "contrato" | "certidao";
  titulo: string;
  descricao: string;
  dias: number | null;
  destino: "/processos" | "/contratos" | "/documentos";
  entityId: string;
};

const TIPOS_CERTIDAO = new Set([
  "certidao_federal",
  "certidao_estadual",
  "certidao_municipal",
  "fgts",
  "trabalhista",
]);

const mesmaPessoa = (
  responsavelId: string | null,
  responsavelNome: string | null,
  userId: string,
  nomeConfirmado: string | null,
) =>
  responsavelId === userId ||
  (!responsavelId &&
    !!nomeConfirmado &&
    responsavelNome?.trim().toLocaleLowerCase("pt-BR") ===
      nomeConfirmado.trim().toLocaleLowerCase("pt-BR"));

export function montarMinhasTarefas(
  userId: string,
  nomeConfirmado: string | null,
  processos: ProcessoMinhaTarefa[],
  etapas: EtapaMinhaTarefa[],
  contratos: ContratoMinhaTarefa[],
  documentos: DocumentoMinhaTarefa[],
  hoje = new Date(),
): MinhaTarefa[] {
  if (!userId) return [];
  const tarefas: MinhaTarefa[] = [];

  for (const processo of processos) {
    if (processo.status === "concluido" || processo.status === "arquivado") continue;
    const minhasEtapas = etapas.filter(
      (etapa) =>
        etapa.process_id === processo.id &&
        etapa.stage === processo.stage &&
        !etapa.is_done &&
        mesmaPessoa(etapa.responsible_user_id, etapa.responsible_name, userId, nomeConfirmado),
    );
    if (
      !mesmaPessoa(
        processo.responsible_user_id,
        processo.responsible_name,
        userId,
        nomeConfirmado,
      ) &&
      minhasEtapas.length === 0
    )
      continue;
    tarefas.push({
      id: `processo-${processo.id}`,
      tipo: "processo",
      titulo: `Processo nº ${processo.number}`,
      descricao: minhasEtapas.length
        ? `Etapa atual: ${minhasEtapas
            .map((item) => item.title)
            .slice(0, 2)
            .join("; ")}`
        : processo.title,
      dias: processo.due_date ? diasAte(processo.due_date, hoje) : null,
      destino: "/processos",
      entityId: processo.id,
    });
  }

  const meusContratos = contratos.filter(
    (contrato) =>
      contrato.status === "vigente" &&
      (contrato.manager_user_id === userId || contrato.inspector_user_id === userId),
  );
  for (const contrato of meusContratos) {
    const dias = diasAte(contrato.end_date, hoje);
    if (dias > 120) continue;
    tarefas.push({
      id: `contrato-${contrato.id}`,
      tipo: "contrato",
      titulo: `Contrato nº ${contrato.number}`,
      descricao:
        contrato.inspector_user_id === userId
          ? "Revisar vigência do contrato sob sua fiscalização"
          : "Planejar providências para o contrato sob sua gestão",
      dias,
      destino: "/contratos",
      entityId: contrato.id,
    });
  }

  const meusFornecedores = new Set(
    meusContratos.map((contrato) => contrato.supplier_id).filter((id): id is string => !!id),
  );
  for (const documento of documentos) {
    if (
      documento.status !== "active" ||
      !documento.expires_at ||
      !meusFornecedores.has(documento.supplier_id) ||
      !TIPOS_CERTIDAO.has(documento.document_type)
    )
      continue;
    const dias = diasAte(documento.expires_at, hoje);
    if (dias > 120) continue;
    tarefas.push({
      id: `certidao-${documento.id}`,
      tipo: "certidao",
      titulo: documento.title,
      descricao: "Certidão de fornecedor sob sua fiscalização ou gestão",
      dias,
      destino: "/documentos",
      entityId: documento.id,
    });
  }

  return tarefas.sort((a, b) => {
    if (a.dias === null && b.dias !== null) return 1;
    if (b.dias === null && a.dias !== null) return -1;
    return (a.dias ?? 0) - (b.dias ?? 0) || a.titulo.localeCompare(b.titulo, "pt-BR");
  });
}

export function criticidadeTarefa(
  dias: number | null,
): "critical" | "attention" | "info" | "normal" {
  if (dias === null || dias > 120) return "normal";
  if (dias < 30) return "critical";
  if (dias <= 60) return "attention";
  return "info";
}
