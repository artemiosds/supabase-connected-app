import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  History,
  Loader2,
  Pencil,
  Plus,
  Printer,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Json, Tables } from "@/integrations/supabase/types";
import { importarTextoDeModelo } from "@/lib/docx-import";
import {
  buildDocumentTemplateSchema,
  buildDocumentVariableValues,
  DOCUMENT_TEMPLATE_VARIABLES,
  renderDocumentTemplate,
  type DocumentVariableContext,
} from "@/lib/document-variables";
import {
  extractGoogleDriveFileId,
  normalizeExternalDocumentUrl,
} from "@/lib/external-document-url";

export const Route = createFileRoute("/_authenticated/documentos")({
  head: () => ({
    meta: [{ title: "Documentos e vencimentos — Gestão de Fornecedores da Saúde" }],
  }),
  component: Documentos,
});

type Fornecedor = Pick<Tables<"suppliers">, "id" | "legal_name" | "trade_name" | "cnpj">;
type DocumentoFornecedor = Tables<"supplier_documents">;
type Modelo = Tables<"document_templates">;
type ModeloCatalogo = Tables<"document_template_catalog">;
type VersaoModelo = Tables<"document_template_versions">;
type ProcessoContratacao = Pick<
  Tables<"procurement_processes">,
  | "id"
  | "number"
  | "title"
  | "description"
  | "modality"
  | "stage"
  | "status"
  | "priority"
  | "requesting_unit"
  | "responsible_name"
  | "estimated_value"
  | "due_date"
>;
type ContratoGeracao = Pick<
  Tables<"contracts">,
  | "id"
  | "number"
  | "object"
  | "process_id"
  | "supplier_id"
  | "status"
  | "modality"
  | "total_value"
  | "start_date"
  | "end_date"
  | "manager_name"
  | "inspector_name"
  | "ordinance"
>;
type CampoComplementar = {
  key: string;
  label: string;
  required?: boolean;
  source?: string;
};
type DocumentoGerado = Tables<"generated_documents">;
type FluxoDocumento = {
  document_id: string;
  status: string;
  submitted_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  events: Json;
};

const LIMITE_ARQUIVO_PRIVADO = 20 * 1024 * 1024;
const TIPOS_ARQUIVO_PRIVADO: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

async function validarArquivoPrivado(file: File): Promise<{ mimeType: string; extension: string }> {
  if (file.size < 1 || file.size > LIMITE_ARQUIVO_PRIVADO) {
    throw new Error("O arquivo precisa ter entre 1 byte e 20 MB.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = TIPOS_ARQUIVO_PRIVADO[extension];
  if (!mimeType) {
    throw new Error("Formato não permitido. Use PDF, DOC, DOCX, XLS, XLSX, JPG ou PNG.");
  }

  if (file.type && file.type !== "application/octet-stream" && file.type !== mimeType) {
    throw new Error("O tipo informado pelo navegador não corresponde à extensão do arquivo.");
  }

  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const startsWith = (expected: number[]) =>
    expected.every((byte, index) => signature[index] === byte);

  const validSignature =
    (extension === "pdf" && new TextDecoder().decode(signature.slice(0, 5)) === "%PDF-") ||
    ((extension === "jpg" || extension === "jpeg") && startsWith([0xff, 0xd8, 0xff])) ||
    (extension === "png" && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    ((extension === "doc" || extension === "xls") &&
      startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) ||
    ((extension === "docx" || extension === "xlsx") &&
      signature[0] === 0x50 &&
      signature[1] === 0x4b &&
      (signature[2] === 0x03 || signature[2] === 0x05 || signature[2] === 0x07));

  if (!validSignature) {
    throw new Error("O conteúdo do arquivo não corresponde ao formato selecionado.");
  }

  return { mimeType, extension };
}

function nomeSeguroArquivo(name: string): string {
  return name
    .normalize("NFC")
    .replace(/[\\/]/g, "_")
    .replace(/\p{Cc}/gu, "_")
    .trim()
    .slice(0, 255);
}
type Capacidades = {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_sign: boolean;
  can_manage_templates: boolean;
};

const TIPOS = [
  ["contrato", "Contrato"],
  ["certidao_federal", "Certidão federal"],
  ["certidao_estadual", "Certidão estadual"],
  ["certidao_municipal", "Certidão municipal"],
  ["fgts", "Regularidade do FGTS"],
  ["trabalhista", "Certidão trabalhista"],
  ["sanitaria", "Licença sanitária"],
  ["alvara", "Alvará"],
  ["proposta", "Proposta"],
  ["outros", "Outros"],
] as const;

function dataLocal(data: string | null): string {
  if (!data) return "Sem vencimento";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${data}T12:00:00Z`),
  );
}

function situacaoVencimento(data: string | null): {
  label: string;
  variant: "destructive" | "secondary" | "outline";
} {
  if (!data) return { label: "Sem vencimento", variant: "outline" };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const vencimento = new Date(`${data}T00:00:00`);
  const dias = Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) return { label: "Vencido", variant: "destructive" };
  if (dias <= 30)
    return {
      label: dias === 0 ? "Vence hoje" : `Vence em ${dias} dia(s)`,
      variant: "secondary",
    };
  return { label: "Em dia", variant: "outline" };
}

function Documentos() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [capacidades, setCapacidades] = useState<Capacidades>({
    can_view: false,
    can_create: false,
    can_update: false,
    can_sign: false,
    can_manage_templates: false,
  });
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [municipioSecretaria, setMunicipioSecretaria] = useState("");
  const [ufSecretaria, setUfSecretaria] = useState("");
  const [cnpjSecretaria, setCnpjSecretaria] = useState("");
  const [codigoIbgeSecretaria, setCodigoIbgeSecretaria] = useState("");
  const [documentos, setDocumentos] = useState<DocumentoFornecedor[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [catalogo, setCatalogo] = useState<ModeloCatalogo[]>([]);
  const [processos, setProcessos] = useState<ProcessoContratacao[]>([]);
  const [contratos, setContratos] = useState<ContratoGeracao[]>([]);
  const [gerados, setGerados] = useState<DocumentoGerado[]>([]);
  const [fluxosGerados, setFluxosGerados] = useState<FluxoDocumento[]>([]);
  const [podeEnviarAprovacao, setPodeEnviarAprovacao] = useState(false);
  const [podeAprovarDocumento, setPodeAprovarDocumento] = useState(false);
  const fluxoPorDocumento = useMemo(
    () => new Map(fluxosGerados.map((f) => [f.document_id, f])),
    [fluxosGerados],
  );
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState("vencimentos");
  const moduloModelosAtivo = selecionado?.enabled_modules["modelos"] === true;

  useEffect(() => {
    if (!moduloModelosAtivo && (aba === "modelos" || aba === "biblioteca")) {
      setAba("vencimentos");
    }
  }, [moduloModelosAtivo, aba]);

  const [dialogDocumento, setDialogDocumento] = useState(false);
  const [salvandoDocumento, setSalvandoDocumento] = useState(false);
  const [documentoEditando, setDocumentoEditando] = useState<DocumentoFornecedor | null>(null);
  const [fornecedorId, setFornecedorId] = useState("");
  const [tituloDocumento, setTituloDocumento] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState<string>("outros");
  const [emissao, setEmissao] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [linkDocumento, setLinkDocumento] = useState("");
  const [observacaoDocumento, setObservacaoDocumento] = useState("");
  const [arquivoDocumento, setArquivoDocumento] = useState<File | null>(null);

  const [dialogModelo, setDialogModelo] = useState(false);
  const [modeloEditando, setModeloEditando] = useState<Modelo | null>(null);
  const [tituloModelo, setTituloModelo] = useState("");
  const [descricaoModelo, setDescricaoModelo] = useState("");
  const [conteudoModelo, setConteudoModelo] = useState("");
  const conteudoModeloRef = useRef<HTMLTextAreaElement | null>(null);
  const [tipoModelo, setTipoModelo] = useState("custom");
  const [baseLegalModelo, setBaseLegalModelo] = useState("");
  const [fonteModelo, setFonteModelo] = useState("");
  const [resumoModelo, setResumoModelo] = useState("");
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  const [dialogHistoricoModelo, setDialogHistoricoModelo] = useState(false);
  const [modeloHistorico, setModeloHistorico] = useState<Modelo | null>(null);
  const [versoesModelo, setVersoesModelo] = useState<VersaoModelo[]>([]);
  const [carregandoVersoes, setCarregandoVersoes] = useState(false);

  const [dialogGerar, setDialogGerar] = useState(false);
  const [modeloSelecionado, setModeloSelecionado] = useState("");
  const [processoGeracao, setProcessoGeracao] = useState("");
  const [contratoGeracao, setContratoGeracao] = useState("");
  const [camposComplementares, setCamposComplementares] = useState<Record<string, string>>({});
  const [instalandoModelo, setInstalandoModelo] = useState<string | null>(null);
  const [fornecedorGeracao, setFornecedorGeracao] = useState("nenhum");
  const [tituloGerado, setTituloGerado] = useState("");
  const [conteudoGerado, setConteudoGerado] = useState("");
  const [salvandoGerado, setSalvandoGerado] = useState(false);
  const [documentoImpressao, setDocumentoImpressao] = useState<DocumentoGerado | null>(null);
  const [documentoGeradoEditando, setDocumentoGeradoEditando] = useState<DocumentoGerado | null>(
    null,
  );
  const [tituloEdicaoGerado, setTituloEdicaoGerado] = useState("");
  const [conteudoEdicaoGerado, setConteudoEdicaoGerado] = useState("");
  const [salvandoEdicaoGerado, setSalvandoEdicaoGerado] = useState(false);

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setCapacidades({
        can_view: false,
        can_create: false,
        can_update: false,
        can_sign: false,
        can_manage_templates: false,
      });
      setFornecedores([]);
      setDocumentos([]);
      setModelos([]);
      setCatalogo([]);
      setProcessos([]);
      setContratos([]);
      setGerados([]);
      setFluxosGerados([]);
      setPodeEnviarAprovacao(false);
      setPodeAprovarDocumento(false);
      setMunicipioSecretaria("");
      setUfSecretaria("");
      setCnpjSecretaria("");
      setCodigoIbgeSecretaria("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const [
        cap,
        suppliers,
        supplierDocs,
        templates,
        generated,
        tenantData,
        catalogTemplates,
        processRecords,
        contractRecords,
        workflowCapabilities,
        workflowRecords,
      ] = await Promise.all([
        db.rpc("get_document_capabilities", { p_tenant_id: selecionado.id }),
        carregarTodasAsPaginas<Fornecedor>((inicio, fim) =>
          db
            .from("suppliers")
            .select("id,legal_name,trade_name,cnpj")
            .eq("tenant_id", selecionado.id)
            .order("legal_name")
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<DocumentoFornecedor>((inicio, fim) =>
          db
            .from("supplier_documents")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .eq("status", "active")
            .order("expires_at", { ascending: true, nullsFirst: false })
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<Modelo>((inicio, fim) =>
          db
            .from("document_templates")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .eq("is_active", true)
            .order("title")
            .order("id")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<DocumentoGerado>((inicio, fim) =>
          db
            .from("generated_documents")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(inicio, fim),
        ),
        db.from("tenants").select("municipality,state,cnpj,ibge_code").eq("id", selecionado.id).maybeSingle(),
        carregarTodasAsPaginas<ModeloCatalogo>((inicio, fim) =>
          db
            .from("document_template_catalog")
            .select("*")
            .eq("is_active", true)
            .order("template_type")
            .order("id")
            .range(inicio, fim),
        ),
        selecionado.enabled_modules["processos"] === true
          ? carregarTodasAsPaginas<ProcessoContratacao>((inicio, fim) =>
              db
                .from("procurement_processes")
                .select("id,number,title,description,modality,stage,status,priority,requesting_unit,responsible_name,estimated_value,due_date")
                .eq("tenant_id", selecionado.id)
                .neq("status", "arquivado")
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .range(inicio, fim),
            )
          : Promise.resolve([] as ProcessoContratacao[]),
        selecionado.enabled_modules["contratos"] === true
          ? carregarTodasAsPaginas<ContratoGeracao>((inicio, fim) =>
              db
                .from("contracts")
                .select("id,number,object,process_id,supplier_id,status,modality,total_value,start_date,end_date,manager_name,inspector_name,ordinance")
                .eq("tenant_id", selecionado.id)
                .order("number")
                .order("id")
                .range(inicio, fim),
            )
          : Promise.resolve([] as ContratoGeracao[]),
        db.rpc("get_document_workflow_capabilities", {
          p_tenant_id: selecionado.id,
        }),
        db.rpc("list_generated_document_workflows", {
          p_tenant_id: selecionado.id,
        }),
      ]);
      for (const result of [cap, tenantData, workflowCapabilities, workflowRecords])
        if (result.error) throw result.error;
      const documentCapabilities = cap.data?.[0] ?? {
        can_view: false,
        can_create: false,
        can_update: false,
        can_sign: false,
        can_manage_templates: false,
      };
      setCapacidades({
        ...documentCapabilities,
        can_manage_templates:
          documentCapabilities.can_manage_templates &&
          selecionado.enabled_modules["modelos"] === true,
      });
      setFornecedores(suppliers);
      setDocumentos(supplierDocs);
      setModelos(templates);
      setCatalogo(catalogTemplates);
      setProcessos(processRecords);
      setContratos(contractRecords);
      setGerados(generated);
      setFluxosGerados((workflowRecords.data ?? []) as unknown as FluxoDocumento[]);
      setPodeEnviarAprovacao(Boolean(workflowCapabilities.data?.[0]?.can_submit));
      setPodeAprovarDocumento(Boolean(workflowCapabilities.data?.[0]?.can_approve));
      setMunicipioSecretaria(tenantData.data?.municipality ?? "");
      setUfSecretaria(tenantData.data?.state ?? "");
      setCnpjSecretaria(tenantData.data?.cnpj ?? "");
      setCodigoIbgeSecretaria(tenantData.data?.ibge_code ?? "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setDocumentos([]);
      setModelos([]);
      setCatalogo([]);
      setProcessos([]);
      setContratos([]);
      setGerados([]);
      setFluxosGerados([]);
      setPodeEnviarAprovacao(false);
      setPodeAprovarDocumento(false);
    } finally {
      setLoading(false);
    }
  }, [selecionado?.id, selecionado?.enabled_modules]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const fornecedorPorId = useMemo(
    () => new Map(fornecedores.map((f) => [f.id, f])),
    [fornecedores],
  );
  const contratoPorId = useMemo(
    () => new Map(contratos.map((contrato) => [contrato.id, contrato])),
    [contratos],
  );
  const vencidos = documentos.filter(
    (d) => d.expires_at && situacaoVencimento(d.expires_at).label === "Vencido",
  ).length;
  const proximos = documentos.filter(
    (d) => d.expires_at && situacaoVencimento(d.expires_at).variant === "secondary",
  ).length;

  function abrirNovoDocumento() {
    setDocumentoEditando(null);
    setFornecedorId("");
    setTituloDocumento("");
    setTipoDocumento("outros");
    setEmissao("");
    setVencimento("");
    setLinkDocumento("");
    setObservacaoDocumento("");
    setArquivoDocumento(null);
    setDialogDocumento(true);
  }
  function abrirEdicaoDocumento(d: DocumentoFornecedor) {
    setDocumentoEditando(d);
    setFornecedorId(d.supplier_id);
    setTituloDocumento(d.title);
    setTipoDocumento(d.document_type);
    setEmissao(d.issue_date ?? "");
    setVencimento(d.expires_at ?? "");
    setLinkDocumento(d.external_url ?? "");
    setObservacaoDocumento(d.notes ?? "");
    setArquivoDocumento(null);
    setDialogDocumento(true);
  }
  async function selecionarArquivoPrivado(file?: File) {
    setArquivoDocumento(null);
    if (!file) return;
    if (documentoEditando) {
      toast.error("Para substituir um arquivo, cadastre um novo documento e arquive o anterior.");
      return;
    }
    try {
      await validarArquivoPrivado(file);
      setArquivoDocumento(file);
      setLinkDocumento("");
      toast.success("Arquivo validado e pronto para envio privado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Arquivo inválido.");
    }
  }

  async function abrirArquivoPrivado(documento: DocumentoFornecedor) {
    if (
      documento.storage_provider !== "supabase_storage" ||
      !documento.storage_path ||
      documento.status !== "active"
    ) {
      toast.error("Este arquivo não está disponível para visualização.");
      return;
    }

    const { data, error: signedUrlError } = await db.storage
      .from("gfs-private-documents")
      .createSignedUrl(documento.storage_path, 60, {
        download: documento.file_name || true,
      });
    if (signedUrlError || !data?.signedUrl) {
      toast.error(signedUrlError?.message ?? "Não foi possível gerar o link temporário.");
      return;
    }

    const opened = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(data.signedUrl);
  }

  async function importarModelo(file?: File) {
    if (!file) return;
    try {
      const text = await importarTextoDeModelo(file);
      setConteudoModelo(text);
      if (!tituloModelo.trim())
        setTituloModelo(file.name.replace(/\\.(txt|md|docx)$/i, "").slice(0, 180));
      toast.success(
        file.name.toLowerCase().endsWith(".docx")
          ? "Texto do Word importado. Revise tabelas e espaçamentos antes de salvar."
          : "Texto do modelo importado.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível importar o arquivo. Tente novamente ou cole o texto.",
      );
    }
  }

  async function salvarDocumento(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || !fornecedorId) return;
    if (emissao && vencimento && vencimento < emissao) {
      toast.error("A data de vencimento não pode ser anterior à emissão.");
      return;
    }
    const linkInformado = linkDocumento.trim();
    const externalUrl = linkInformado ? normalizeExternalDocumentUrl(linkInformado) : null;
    if (linkInformado && !externalUrl) {
      toast.error(
        "Informe um link HTTP ou HTTPS válido, sem credenciais e com até 2.048 caracteres.",
      );
      return;
    }
    setSalvandoDocumento(true);

    const metadata = {
      title: tituloDocumento.trim(),
      document_type: tipoDocumento,
      issue_date: emissao || null,
      expires_at: vencimento || null,
      notes: observacaoDocumento.trim() || null,
    };

    if (documentoEditando) {
      const payload =
        documentoEditando.storage_provider === "supabase_storage"
          ? metadata
          : {
              ...metadata,
              external_url: externalUrl,
              storage_provider: extractGoogleDriveFileId(externalUrl ?? "")
                ? "google_drive"
                : "external_link",
              drive_file_id: extractGoogleDriveFileId(externalUrl ?? ""),
            };
      const { error: updateError } = await db
        .from("supplier_documents")
        .update(payload)
        .eq("id", documentoEditando.id)
        .eq("tenant_id", selecionado.id);
      setSalvandoDocumento(false);
      if (updateError) {
        toast.error(updateError.message);
        return;
      }
      toast.success("Documento atualizado. O arquivo original foi preservado.");
    } else if (arquivoDocumento) {
      let validated: { mimeType: string; extension: string };
      try {
        validated = await validarArquivoPrivado(arquivoDocumento);
      } catch (error) {
        setSalvandoDocumento(false);
        toast.error(error instanceof Error ? error.message : "Arquivo inválido.");
        return;
      }

      const documentId = crypto.randomUUID();
      const objectId = crypto.randomUUID();
      const storagePath = [
        selecionado.id,
        "supplier-documents",
        fornecedorId,
        documentId,
        `${objectId}.${validated.extension}`,
      ].join("/");
      const { error: uploadError } = await db.storage
        .from("gfs-private-documents")
        .upload(storagePath, arquivoDocumento, {
          contentType: validated.mimeType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setSalvandoDocumento(false);
        toast.error(`Não foi possível enviar o arquivo: ${uploadError.message}`);
        return;
      }

      const { error: insertError } = await db.from("supplier_documents").insert({
        id: documentId,
        tenant_id: selecionado.id,
        supplier_id: fornecedorId,
        ...metadata,
        storage_provider: "supabase_storage",
        storage_path: storagePath,
        file_name: nomeSeguroArquivo(arquivoDocumento.name),
        mime_type: validated.mimeType,
        file_size: arquivoDocumento.size,
        external_url: null,
        drive_file_id: null,
        status: "active",
      });

      if (insertError) {
        const { error: cleanupError } = await db.storage
          .from("gfs-private-documents")
          .remove([storagePath]);
        setSalvandoDocumento(false);
        toast.error(
          cleanupError
            ? `O registro não foi salvo (${insertError.message}). O arquivo permanece privado e sem vínculo; solicite a limpeza ao suporte.`
            : `O cadastro não foi salvo e o arquivo enviado foi removido: ${insertError.message}`,
        );
        return;
      }
      setSalvandoDocumento(false);
      toast.success("Documento e arquivo privado registrados com sucesso.");
    } else {
      const driveFileId = extractGoogleDriveFileId(externalUrl ?? "");
      const { error: insertError } = await db.from("supplier_documents").insert({
        tenant_id: selecionado.id,
        supplier_id: fornecedorId,
        ...metadata,
        external_url: externalUrl,
        storage_provider: driveFileId ? "google_drive" : "external_link",
        drive_file_id: driveFileId,
        status: "active",
      });
      setSalvandoDocumento(false);
      if (insertError) {
        toast.error(insertError.message);
        return;
      }
      toast.success("Documento registrado.");
    }

    setArquivoDocumento(null);
    setDialogDocumento(false);
    await carregar();
  }

  async function arquivarDocumento(d: DocumentoFornecedor) {
    if (!selecionado) return;
    const { error: updateError } = await db
      .from("supplier_documents")
      .update({ status: "archived" })
      .eq("id", d.id)
      .eq("tenant_id", selecionado.id);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success("Documento arquivado.");
    await carregar();
  }

  function iniciarNovoModelo() {
    setModeloEditando(null);
    setTituloModelo("");
    setDescricaoModelo("");
    setConteudoModelo("");
    setTipoModelo("custom");
    setBaseLegalModelo("");
    setFonteModelo("");
    setResumoModelo("");
    setDialogModelo(true);
  }

  function iniciarEdicaoModelo(modelo: Modelo) {
    setModeloEditando(modelo);
    setTituloModelo(modelo.title);
    setDescricaoModelo(modelo.description ?? "");
    setConteudoModelo(modelo.content);
    setTipoModelo(modelo.template_type);
    setBaseLegalModelo(modelo.legal_basis ?? "");
    setFonteModelo(modelo.source_reference ?? "");
    setResumoModelo("");
    setDialogModelo(true);
  }

  function inserirCampoModelo(key: string) {
    const textarea = conteudoModeloRef.current;
    const token = "{{" + key + "}}";
    const start = textarea?.selectionStart ?? conteudoModelo.length;
    const end = textarea?.selectionEnd ?? start;
    const updated = conteudoModelo.slice(0, start) + token + conteudoModelo.slice(end);
    setConteudoModelo(updated);
    requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = start + token.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  async function abrirHistoricoModelo(modelo: Modelo) {
    if (!selecionado) return;
    setModeloHistorico(modelo);
    setVersoesModelo([]);
    setDialogHistoricoModelo(true);
    setCarregandoVersoes(true);
    const { data, error: historyError } = await db
      .from("document_template_versions")
      .select("*")
      .eq("tenant_id", selecionado.id)
      .eq("template_id", modelo.id)
      .order("version", { ascending: false });
    setCarregandoVersoes(false);
    if (historyError) {
      toast.error(historyError.message);
      return;
    }
    setVersoesModelo(data ?? []);
  }

  async function restaurarVersaoModelo(versao: VersaoModelo) {
    if (!selecionado || !capacidades.can_manage_templates || !modeloHistorico) return;
    const confirmou = window.confirm(
      `Restaurar a versão ${versao.version} de "${modeloHistorico.title}"? O conteúdo atual será preservado no histórico e a restauração criará uma nova versão.`,
    );
    if (!confirmou) return;

    setCarregandoVersoes(true);
    const { error: restoreError } = await db
      .from("document_templates")
      .update({
        title: versao.title,
        description: versao.description,
        content: versao.content,
        template_type: versao.template_type,
        template_code: versao.template_code,
        legal_basis: versao.legal_basis,
        source_reference: versao.source_reference,
        variables_schema: versao.variables_schema,
        change_summary: `Restauração da versão histórica ${versao.version}.`,
      })
      .eq("id", modeloHistorico.id)
      .eq("tenant_id", selecionado.id);

    if (restoreError) {
      setCarregandoVersoes(false);
      toast.error(restoreError.message);
      return;
    }

    toast.success("Versão restaurada. Uma nova versão foi registrada no histórico.");
    setDialogHistoricoModelo(false);
    setModeloHistorico(null);
    await carregar();
  }

  async function salvarModelo(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setSalvandoModelo(true);
    const payload = {
      title: tituloModelo.trim(),
      description: descricaoModelo.trim() || null,
      content: conteudoModelo.trim(),
      template_type: tipoModelo,
      legal_basis: baseLegalModelo.trim() || null,
      source_reference: fonteModelo.trim() || null,
      variables_schema: buildDocumentTemplateSchema(
        conteudoModelo.trim(),
        modeloEditando?.variables_schema,
      ) as Json,
      change_summary:
        resumoModelo.trim() ||
        (modeloEditando ? "Modelo editado pela Secretaria." : "Modelo criado pela Secretaria."),
    };
    const result = modeloEditando
      ? await db
          .from("document_templates")
          .update(payload)
          .eq("id", modeloEditando.id)
          .eq("tenant_id", selecionado.id)
      : await db.from("document_templates").insert({
          tenant_id: selecionado.id,
          ...payload,
        });
    setSalvandoModelo(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      modeloEditando
        ? "Modelo atualizado. Uma nova versão foi registrada."
        : "Modelo salvo nesta Secretaria.",
    );
    setDialogModelo(false);
    setModeloEditando(null);
    setTituloModelo("");
    setDescricaoModelo("");
    setConteudoModelo("");
    setTipoModelo("custom");
    setBaseLegalModelo("");
    setFonteModelo("");
    setResumoModelo("");
    await carregar();
  }

  function iniciarGeracao(processoId = "") {
    setModeloSelecionado("");
    setProcessoGeracao(processoId);
    setCamposComplementares({});
    setFornecedorGeracao("nenhum");
    setTituloGerado("");
    setConteudoGerado("");
    setDialogGerar(true);
  }

  useEffect(() => {
    if (loading || !selecionado?.id || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const processoId = params.get("processo");
    const tipoSolicitado = params.get("tipo");
    if (!processoId || !tipoSolicitado) return;

    const processoExiste = processos.some((processo) => processo.id === processoId);
    if (!processoExiste) {
      toast.error("O processo solicitado não está disponível nesta Secretaria.");
      params.delete("processo");
      params.delete("tipo");
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
      return;
    }

    iniciarGeracao(processoId);
    const modelo = modelos.find((item) => item.is_active && item.template_type === tipoSolicitado);
    if (modelo) {
      setModeloSelecionado(modelo.id);
      setTituloGerado(modelo.title);
      setConteudoGerado(modelo.content);
    } else {
      toast.info("Instale o modelo correspondente na Biblioteca-base para gerar este documento.");
    }

    params.delete("processo");
    params.delete("tipo");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [loading, selecionado?.id, processos, modelos]);

  function selecionarModelo(id: string) {
    setModeloSelecionado(id);
    setCamposComplementares({});
    const modelo = modelos.find((m) => m.id === id);
    if (modelo) {
      setTituloGerado(modelo.title);
      setConteudoGerado(modelo.content);
    }
  }
  async function gerarDocumento(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setSalvandoGerado(true);
    if (processoGeracao) {
      if (!modeloSelecionado) {
        setSalvandoGerado(false);
        toast.error("Selecione um modelo instalado nesta Secretaria.");
        return;
      }
      const contratoSelecionado = contratos.find((item) => item.id === contratoGeracao);
      if (contratoGeracao && contratoSelecionado?.process_id !== processoGeracao) {
        setSalvandoGerado(false);
        toast.error("O contrato selecionado não pertence ao processo escolhido.");
        return;
      }
      const declaredKeys = new Set(
        (modeloDoGerador?.variables_schema as unknown as CampoComplementar[] | undefined)?.map(
          (field) => field.key,
        ) ?? [],
      );
      const overrides = {
        ...Object.fromEntries(
          Object.entries(camposComplementares).filter(
            ([key]) => declaredKeys.has(key) && !valoresAutomaticosGeracao[key]?.trim(),
          ),
        ),
        ...(contratoGeracao ? { contract_id: contratoGeracao } : {}),
      };
      const { error: rpcError } = await db.rpc("generate_document_from_process", {
        p_process_id: processoGeracao,
        p_template_id: modeloSelecionado,
        p_overrides: overrides as Json,
      });
      setSalvandoGerado(false);
      if (rpcError) {
        toast.error(rpcError.message);
        return;
      }
      toast.success("Documento vinculado ao processo e salvo como rascunho.");
    } else {
      const snapshot = previaGeracao.content;
      const contratoSelecionado = contratos.find((item) => item.id === contratoGeracao);
      const { error: insertError } = await db.from("generated_documents").insert({
        tenant_id: selecionado.id,
        process_id: contratoSelecionado?.process_id ?? null,
        contract_id: contratoSelecionado?.id ?? null,
        supplier_id:
          contratoSelecionado?.supplier_id ??
          (fornecedorGeracao === "nenhum" ? null : fornecedorGeracao),
        template_id: modeloSelecionado || null,
        title: tituloGerado.trim(),
        content_snapshot: snapshot,
        status: "draft",
      });
      setSalvandoGerado(false);
      if (insertError) {
        toast.error(insertError.message);
        return;
      }
      toast.success("Documento gerado como rascunho.");
    }
    setDialogGerar(false);
    setAba("gerados");
    await carregar();
  }

  async function instalarModeloBase(m: ModeloCatalogo) {
    if (!selecionado || !capacidades.can_manage_templates) return;
    setInstalandoModelo(m.id);
    const { error: installError } = await db.rpc("install_document_template", {
      p_tenant_id: selecionado.id,
      p_catalog_template_id: m.id,
    });
    setInstalandoModelo(null);
    if (installError) {
      toast.error(installError.message);
      return;
    }
    toast.success(
      "Modelo-base instalado. Agora ele pertence a esta Secretaria e pode ser editado.",
    );
    await carregar();
  }

  const contratoDoGerador = contratos.find((contrato) => contrato.id === contratoGeracao) ?? null;
  const fornecedorIdDoGerador =
    contratoDoGerador?.supplier_id ??
    (fornecedorGeracao === "nenhum" ? null : fornecedorGeracao);
  const fornecedorDoGerador = fornecedores.find((fornecedor) => fornecedor.id === fornecedorIdDoGerador);
  const processoIdDoGerador = contratoDoGerador?.process_id ?? processoGeracao;
  const processoDoGerador = processos.find((processo) => processo.id === processoIdDoGerador) ?? null;
  const contextoVariaveisGeracao: DocumentVariableContext = {
    organization: {
      name: selecionado?.nome ?? null,
      municipality: municipioSecretaria || null,
      state: ufSecretaria || null,
      cnpj: cnpjSecretaria || null,
      ibgeCode: codigoIbgeSecretaria || null,
    },
    user: { name: null, email: session?.user.email ?? null },
    supplier: fornecedorDoGerador
      ? {
          legalName: fornecedorDoGerador.legal_name,
          tradeName: fornecedorDoGerador.trade_name,
          cnpj: fornecedorDoGerador.cnpj,
          email: null,
          phone: null,
        }
      : null,
    process: processoDoGerador
      ? {
          number: processoDoGerador.number,
          title: processoDoGerador.title,
          description: processoDoGerador.description,
          modality: processoDoGerador.modality,
          stage: processoDoGerador.stage,
          status: processoDoGerador.status,
          priority: processoDoGerador.priority,
          requestingUnit: processoDoGerador.requesting_unit,
          responsibleName: processoDoGerador.responsible_name,
          estimatedValue: processoDoGerador.estimated_value,
          dueDate: processoDoGerador.due_date,
        }
      : null,
    contract: contratoDoGerador
      ? {
          number: contratoDoGerador.number,
          object: contratoDoGerador.object,
          modality: contratoDoGerador.modality,
          totalValue: contratoDoGerador.total_value,
          startDate: contratoDoGerador.start_date,
          endDate: contratoDoGerador.end_date,
          managerName: contratoDoGerador.manager_name,
          inspectorName: contratoDoGerador.inspector_name,
          ordinance: contratoDoGerador.ordinance,
        }
      : null,
  };
  const valoresAutomaticosGeracao = buildDocumentVariableValues(contextoVariaveisGeracao);
  const previaGeracao = renderDocumentTemplate(conteudoGerado, valoresAutomaticosGeracao);
  const modeloDoGerador = modelos.find((m) => m.id === modeloSelecionado);
  const camposDoModelo = (
    (modeloDoGerador?.variables_schema as unknown as CampoComplementar[]) ?? []
  ).filter(
    (campo) =>
      !campo.source?.startsWith("process.") &&
      !valoresAutomaticosGeracao[campo.key]?.trim(),
  );
  const modelosInstalados = new Set(
    modelos
      .filter((m) => m.catalog_template_id && m.is_active)
      .map((m) => m.catalog_template_id as string),
  );

  function abrirEdicaoGerado(documento: DocumentoGerado) {
    setDocumentoGeradoEditando(documento);
    setTituloEdicaoGerado(documento.title);
    setConteudoEdicaoGerado(documento.content_snapshot);
  }

  async function salvarEdicaoGerado(event: FormEvent) {
    event.preventDefault();
    if (!selecionado || !documentoGeradoEditando || !capacidades.can_update || salvandoEdicaoGerado)
      return;
    if (tituloEdicaoGerado.trim().length < 2 || !conteudoEdicaoGerado.trim()) {
      toast.error("Informe título e conteúdo do documento.");
      return;
    }
    setSalvandoEdicaoGerado(true);
    const { error } = await db
      .from("generated_documents")
      .update({
        title: tituloEdicaoGerado.trim(),
        content_snapshot: conteudoEdicaoGerado,
      })
      .eq("id", documentoGeradoEditando.id)
      .eq("tenant_id", selecionado.id);
    setSalvandoEdicaoGerado(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDocumentoGeradoEditando(null);
    toast.success("Rascunho atualizado. O histórico de aprovação anterior foi preservado.");
    await carregar();
  }

  async function tramitarDocumento(d: DocumentoGerado, action: "submit" | "approve" | "reject") {
    if (!selecionado) return;
    const comment =
      action === "reject" ? window.prompt("Informe o motivo da devolução para correção:") : null;
    if (action === "reject" && (!comment || comment.trim().length < 5)) {
      if (comment !== null) toast.error("Informe um motivo com pelo menos 5 caracteres.");
      return;
    }
    const { data, error } = await db.rpc("transition_generated_document_workflow", {
      p_tenant_id: selecionado.id,
      p_document_id: d.id,
      p_action: action,
      p_comment: comment?.trim() ?? null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const labels: Record<string, string> = {
      pending_approval: "Documento enviado para aprovação.",
      approved: "Documento aprovado.",
      rejected: "Documento devolvido para correção.",
    };
    toast.success(labels[String(data)] ?? "Tramitação registrada.");
    await carregar();
  }

  async function assinarDocumento(d: DocumentoGerado) {
    if (!selecionado || !capacidades.can_sign || fluxoPorDocumento.get(d.id)?.status !== "approved")
      return;
    const confirmou = window.confirm(
      "Confirma a assinatura eletrônica simples deste documento? A assinatura ficará registrada com sua conta, nome e data, e o conteúdo será bloqueado.",
    );
    if (!confirmou) return;
    const { error: updateError } = await db
      .from("generated_documents")
      .update({ status: "signed" })
      .eq("id", d.id)
      .eq("tenant_id", selecionado.id);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success("Assinatura registrada.");
    await carregar();
  }

  async function cancelarGerado(d: DocumentoGerado) {
    if (!selecionado || d.status === "signed") return;
    const { error: updateError } = await db
      .from("generated_documents")
      .update({ status: "cancelled" })
      .eq("id", d.id)
      .eq("tenant_id", selecionado.id);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success("Documento cancelado.");
    await carregar();
  }

  if (!selecionado)
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>
          Documentos, modelos e alertas pertencem à Secretaria selecionada.
        </AlertDescription>
      </Alert>
    );
  if (!capacidades.can_view && !loading)
    return (
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Acesso não autorizado</AlertTitle>
        <AlertDescription>
          Seu perfil não possui permissão para consultar documentos nesta Secretaria.
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-6">
      <div className="print:hidden flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documentos e vencimentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Certidões, contratos, modelos e documentos gerados — {selecionado.nome}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {moduloModelosAtivo && capacidades.can_manage_templates && (
            <Button variant="outline" onClick={iniciarNovoModelo}>
              <Plus className="h-4 w-4" /> Novo modelo
            </Button>
          )}
          {capacidades.can_create && (
            <Button variant="outline" onClick={abrirNovoDocumento}>
              <FilePlus2 className="h-4 w-4" /> Registrar documento
            </Button>
          )}
          {capacidades.can_create && (
            <Button onClick={() => iniciarGeracao()}>
              <FileText className="h-4 w-4" /> Gerar documento
            </Button>
          )}
        </div>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Erro ao carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="print:hidden grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Documentos ativos</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{documentos.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Vencidos</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-destructive">{vencidos}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Vencem em até 30 dias
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{proximos}</p>
              </CardContent>
            </Card>
          </div>

          <Tabs value={aba} onValueChange={setAba} className="print:hidden">
            <TabsList>
              <TabsTrigger value="vencimentos">Vencimentos</TabsTrigger>
              {moduloModelosAtivo && (
                <TabsTrigger value="modelos">Modelos ({modelos.length})</TabsTrigger>
              )}
              <TabsTrigger value="gerados">Gerados ({gerados.length})</TabsTrigger>
              {moduloModelosAtivo && capacidades.can_manage_templates && (
                <TabsTrigger value="biblioteca">Biblioteca-base ({catalogo.length})</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="vencimentos" className="mt-4">
              <div className="overflow-hidden rounded-lg border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-3 font-medium">Documento</th>
                        <th className="p-3 font-medium">Fornecedor</th>
                        <th className="p-3 font-medium">Emissão</th>
                        <th className="p-3 font-medium">Vencimento</th>
                        <th className="p-3 font-medium">Situação</th>
                        <th className="p-3 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documentos.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-muted-foreground">
                            Nenhum documento de fornecedor registrado.
                          </td>
                        </tr>
                      ) : (
                        documentos.map((d) => {
                          const f = fornecedorPorId.get(d.supplier_id);
                          const status = situacaoVencimento(d.expires_at);
                          const safeExternalUrl = d.external_url
                            ? normalizeExternalDocumentUrl(d.external_url)
                            : null;
                          return (
                            <tr key={d.id} className="border-t">
                              <td className="p-3">
                                <p className="font-medium">{d.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {TIPOS.find(([v]) => v === d.document_type)?.[1] ??
                                    d.document_type}
                                  {d.storage_provider === "supabase_storage" && d.file_name
                                    ? ` · Arquivo privado: ${d.file_name}`
                                    : ""}
                                </p>
                              </td>
                              <td className="p-3">
                                {f?.trade_name || f?.legal_name || "Fornecedor"}
                              </td>
                              <td className="p-3">{dataLocal(d.issue_date)}</td>
                              <td className="p-3">{dataLocal(d.expires_at)}</td>
                              <td className="p-3">
                                <Badge variant={status.variant}>{status.label}</Badge>
                              </td>
                              <td className="p-3">
                                <div className="flex justify-end gap-1">
                                  {d.storage_provider === "supabase_storage" && d.storage_path && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => void abrirArquivoPrivado(d)}
                                      aria-label="Baixar arquivo privado"
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {safeExternalUrl && (
                                    <Button size="icon" variant="ghost" asChild>
                                      <a
                                        href={safeExternalUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label="Abrir documento"
                                      >
                                        <ExternalLink className="h-4 w-4" />
                                      </a>
                                    </Button>
                                  )}
                                  {capacidades.can_update && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => abrirEdicaoDocumento(d)}
                                      aria-label="Editar documento"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {capacidades.can_update && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => void arquivarDocumento(d)}
                                      aria-label="Arquivar documento"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Os avisos de vencimento são calculados pelo prazo informado. As listas consultam
                todas as páginas disponíveis; os arquivos permanecem no endereço externo informado
                até a integração OAuth e sincronização automática com o Drive.
              </p>
            </TabsContent>
            {moduloModelosAtivo && (
              <TabsContent value="modelos" className="mt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {modelos.map((m) => (
                    <Card key={m.id}>
                      <CardHeader>
                        <CardTitle className="text-base">{m.title}</CardTitle>
                        {m.description && (
                          <p className="text-sm text-muted-foreground">{m.description}</p>
                        )}
                      </CardHeader>
                      <CardContent>
                        <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
                          {m.content}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">Versão {m.version}</Badge>
                          <Badge variant="outline">{m.template_type.toUpperCase()}</Badge>
                          {m.legal_basis && <span>{m.legal_basis}</span>}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Campos automáticos: processo, objeto, Secretaria, município, unidade,
                          responsável, prioridade e prazo quando cadastrados.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void abrirHistoricoModelo(m)}
                          >
                            <History className="h-4 w-4" /> Histórico
                          </Button>
                          {capacidades.can_manage_templates && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => iniciarEdicaoModelo(m)}
                            >
                              <Pencil className="h-4 w-4" /> Editar modelo
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {modelos.length === 0 && (
                    <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground md:col-span-2">
                      Nenhum modelo cadastrado. Use “Novo modelo” para importar ou colar um
                      texto-base.
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
            {moduloModelosAtivo && capacidades.can_manage_templates && (
              <TabsContent value="biblioteca" className="mt-4">
                <div className="mb-3 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Modelos-base orientativos da plataforma. A instalação cria uma cópia independente
                  nesta Secretaria. Revise e adapte o conteúdo à regulamentação municipal e ao
                  objeto antes de utilizar.
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {catalogo.length === 0 && (
                    <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground md:col-span-2">
                      Nenhum modelo-base está disponível para instalação.
                    </div>
                  )}
                  {catalogo.map((m) => {
                    const instalado = modelosInstalados.has(m.id);
                    return (
                      <Card key={m.id}>
                        <CardHeader className="pb-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="text-base">{m.title}</CardTitle>
                            <Badge variant="outline">v{m.version}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{m.description}</p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Base legal:</strong> {m.legal_basis}
                          </p>
                          <a
                            href={m.source_reference.split(" | ")[0]}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary underline underline-offset-4"
                          >
                            Consultar referência normativa
                          </a>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">{m.template_code}</span>
                            {instalado ? (
                              <Badge variant="secondary">Já instalado</Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => void instalarModeloBase(m)}
                                disabled={instalandoModelo !== null}
                              >
                                {instalandoModelo === m.id && (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                )}
                                Instalar nesta Secretaria
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>
            )}
            <TabsContent value="gerados" className="mt-4">
              <div className="overflow-hidden rounded-lg border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-3 font-medium">Documento</th>
                        <th className="p-3 font-medium">Vínculo</th>
                        <th className="p-3 font-medium">Data</th>
                        <th className="p-3 font-medium">Situação</th>
                        <th className="p-3 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gerados.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-10 text-center text-muted-foreground">
                            Nenhum documento gerado.
                          </td>
                        </tr>
                      ) : (
                        gerados.map((d) => (
                          <tr key={d.id} className="border-t">
                            <td className="p-3">
                              <p className="font-medium">{d.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {d.process_id
                                  ? "Processo de contratação vinculado"
                                  : (fornecedorPorId.get(d.supplier_id ?? "")?.legal_name ??
                                    "Sem fornecedor vinculado")}
                              </p>
                            </td>
                            <td className="p-3">
                              <span className="font-medium">
                                {d.contract_id
                                  ? `Contrato ${contratoPorId.get(d.contract_id)?.number ?? "vinculado"}`
                                  : d.process_id
                                    ? `Processo ${processos.find((processo) => processo.id === d.process_id)?.number ?? "vinculado"}`
                                    : d.supplier_id
                                      ? (fornecedorPorId.get(d.supplier_id)?.legal_name ??
                                        "Fornecedor vinculado")
                                      : "Documento avulso"}
                              </span>
                              {d.contract_id && contratoPorId.get(d.contract_id)?.object && (
                                <p className="text-xs text-muted-foreground">
                                  {contratoPorId.get(d.contract_id)?.object}
                                </p>
                              )}
                            </td>
                            <td className="p-3">
                              {new Intl.DateTimeFormat("pt-BR").format(new Date(d.created_at))}
                            </td>
                            <td className="p-3">
                              <Badge
                                variant={
                                  d.status === "signed"
                                    ? "secondary"
                                    : d.status === "cancelled"
                                      ? "outline"
                                      : "default"
                                }
                              >
                                {d.status === "signed"
                                  ? "Assinado"
                                  : d.status === "cancelled"
                                    ? "Cancelado"
                                    : "Rascunho"}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setDocumentoImpressao(d)}
                                  aria-label="Visualizar e imprimir"
                                >
                                  <Printer className="h-4 w-4" />
                                </Button>
                                {(() => {
                                  const workflow = fluxoPorDocumento.get(d.id);
                                  const status = workflow?.status ?? "draft";
                                  const labels: Record<string, string> = {
                                    draft: "Em elaboração",
                                    pending_approval: "Aguardando aprovação",
                                    approved: "Aprovado",
                                    rejected: "Devolvido para correção",
                                    signed: "Assinado",
                                    cancelled: "Cancelado",
                                  };
                                  return (
                                    <div className="flex flex-wrap items-center justify-end gap-1">
                                      <Badge
                                        variant={status === "approved" ? "secondary" : "outline"}
                                      >
                                        {labels[status] ?? status}
                                      </Badge>
                                      {d.status === "draft" &&
                                        ["draft", "rejected"].includes(status) &&
                                        capacidades.can_update && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => abrirEdicaoGerado(d)}
                                          >
                                            <Pencil className="h-3.5 w-3.5" /> Editar
                                          </Button>
                                        )}
                                      {d.status === "draft" &&
                                        status !== "pending_approval" &&
                                        podeEnviarAprovacao && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => void tramitarDocumento(d, "submit")}
                                          >
                                            Enviar para aprovação
                                          </Button>
                                        )}
                                      {d.status === "draft" &&
                                        status === "pending_approval" &&
                                        podeAprovarDocumento && (
                                          <>
                                            <Button
                                              size="sm"
                                              onClick={() => void tramitarDocumento(d, "approve")}
                                            >
                                              Aprovar
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => void tramitarDocumento(d, "reject")}
                                            >
                                              Devolver
                                            </Button>
                                          </>
                                        )}
                                      {d.status === "draft" &&
                                        capacidades.can_sign &&
                                        status === "approved" && (
                                          <Button
                                            size="sm"
                                            onClick={() => void assinarDocumento(d)}
                                          >
                                            <CheckCircle2 className="h-4 w-4" /> Assinar
                                          </Button>
                                        )}
                                      {workflow?.decision_comment && (
                                        <span className="basis-full text-right text-xs text-muted-foreground">
                                          Observação: {workflow.decision_comment}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                                {d.status !== "signed" &&
                                  d.status !== "cancelled" &&
                                  capacidades.can_update && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void cancelarGerado(d)}
                                    >
                                      Cancelar
                                    </Button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={dialogDocumento} onOpenChange={setDialogDocumento}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {documentoEditando
                ? "Editar documento de fornecedor"
                : "Registrar documento de fornecedor"}
            </DialogTitle>
            <DialogDescription>
              Informe o documento, as datas e um link para o arquivo armazenado externamente.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salvarDocumento} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Fornecedor *</Label>
                <Select
                  value={fornecedorId}
                  onValueChange={setFornecedorId}
                  disabled={!!documentoEditando}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.legal_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Título *</Label>
                <Input
                  required
                  minLength={2}
                  maxLength={180}
                  value={tituloDocumento}
                  onChange={(e) => setTituloDocumento(e.target.value)}
                  placeholder="Ex.: Certidão de regularidade fiscal"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data de emissão</Label>
                <Input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Data de vencimento</Label>
                <Input
                  type="date"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                />
              </div>
              {!documentoEditando && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Arquivo privado (opcional)</Label>
                  <Input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png"
                    onChange={(event) => void selecionarArquivoPrivado(event.target.files?.[0])}
                  />
                  {arquivoDocumento && (
                    <p className="text-xs text-muted-foreground">
                      Selecionado: {arquivoDocumento.name} ·{" "}
                      {(arquivoDocumento.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    PDF, Word, Excel, JPG ou PNG. Limite de 20 MB. O arquivo ficará em armazenamento
                    privado e só poderá ser acessado por usuários autorizados desta Secretaria.
                  </p>
                </div>
              )}
              {documentoEditando?.storage_provider === "supabase_storage" && (
                <Alert className="sm:col-span-2">
                  <AlertDescription>
                    Arquivo privado: {documentoEditando.file_name ?? "anexo"}. O conteúdo é
                    imutável. Para substituir, cadastre um novo documento e arquive este registro.
                  </AlertDescription>
                </Alert>
              )}
              {(!documentoEditando || documentoEditando.storage_provider !== "supabase_storage") &&
                !arquivoDocumento && (
                  <div className="space-y-2">
                    <Label>Link do arquivo (Drive ou outro)</Label>
                    <Input
                      type="url"
                      placeholder="https://"
                      value={linkDocumento}
                      onChange={(e) => setLinkDocumento(e.target.value)}
                    />
                  </div>
                )}
              <div className="space-y-2 sm:col-span-2">
                <Label>Observações</Label>
                <Textarea
                  rows={3}
                  maxLength={2000}
                  value={observacaoDocumento}
                  onChange={(e) => setObservacaoDocumento(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogDocumento(false)}>
                <X className="h-4 w-4" /> Cancelar
              </Button>
              <Button type="submit" disabled={salvandoDocumento || !fornecedorId}>
                {salvandoDocumento ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}{" "}
                Salvar documento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogModelo}
        onOpenChange={(open) => {
          setDialogModelo(open);
          if (!open) setModeloEditando(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {modeloEditando ? "Editar modelo de documento" : "Novo modelo de documento"}
            </DialogTitle>
            <DialogDescription>
              {modeloEditando
                ? "A alteração cria uma nova versão e preserva as versões anteriores e os documentos já gerados."
                : "Cole ou importe o conteúdo do modelo que será usado para gerar documentos. A versão original fica salva nesta Secretaria."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salvarModelo} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do modelo *</Label>
              <Input
                required
                minLength={2}
                maxLength={180}
                value={tituloModelo}
                onChange={(e) => setTituloModelo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria do modelo</Label>
              <Select value={tipoModelo} onValueChange={setTipoModelo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dfd">DFD</SelectItem>
                  <SelectItem value="etp">ETP</SelectItem>
                  <SelectItem value="risk_analysis">Análise de riscos</SelectItem>
                  <SelectItem value="risk_matrix">Matriz contratual de riscos</SelectItem>
                  <SelectItem value="tr">Termo de Referência</SelectItem>
                  <SelectItem value="custom">Outro documento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                maxLength={1000}
                value={descricaoModelo}
                onChange={(e) => setDescricaoModelo(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Base normativa ou fundamento</Label>
                <Input
                  maxLength={2000}
                  value={baseLegalModelo}
                  onChange={(e) => setBaseLegalModelo(e.target.value)}
                  placeholder="Indique a referência a revisar localmente"
                />
              </div>
              <div className="space-y-2">
                <Label>Fonte oficial ou referência</Label>
                <Input
                  maxLength={2000}
                  value={fonteModelo}
                  onChange={(e) => setFonteModelo(e.target.value)}
                  placeholder="URL ou identificação da fonte"
                />
              </div>
            </div>
            {modeloEditando && (
              <div className="space-y-2">
                <Label>Resumo da alteração</Label>
                <Input
                  maxLength={500}
                  value={resumoModelo}
                  onChange={(e) => setResumoModelo(e.target.value)}
                  placeholder="Ex.: Adequação ao regulamento municipal e ao objeto."
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="arquivo-modelo">Importar modelo (.docx, .txt ou .md)</Label>
              <Input
                id="arquivo-modelo"
                type="file"
                accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                onChange={(e) => {
                  void importarModelo(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">
                No DOCX, parágrafos e tabelas simples são importados como texto editável.
                <br />
                Formatação visual, imagens, cabeçalhos e rodapés não são preservados. Também é
                possível copiar e colar o conteúdo no campo abaixo.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Texto do modelo *</Label>
              <Textarea
                ref={conteudoModeloRef}
                required
                rows={12}
                maxLength={50000}
                value={conteudoModelo}
                onChange={(e) => setConteudoModelo(e.target.value)}
                placeholder="Escreva ou importe o conteúdo e insira os campos que deseja preencher automaticamente."
              />
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Inserir campo automático
                </summary>
                <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                  {DOCUMENT_TEMPLATE_VARIABLES.map((variable) => (
                    <Button
                      key={variable.key}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="justify-start font-mono text-xs"
                      onClick={() => inserirCampoModelo(variable.key)}
                    >
                      { "{{" + variable.key + "}}" }
                      <span className="ml-2 truncate font-sans text-muted-foreground">
                        {variable.label}
                      </span>
                    </Button>
                  ))}
                </div>
              </details>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogModelo(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoModelo}>
                {salvandoModelo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}{" "}
                {modeloEditando ? "Salvar nova versão" : "Salvar modelo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogHistoricoModelo} onOpenChange={setDialogHistoricoModelo}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Histórico de versões</DialogTitle>
            <DialogDescription>
              {modeloHistorico?.title ?? "Modelo"} — as versões anteriores são somente para
              consulta.
            </DialogDescription>
          </DialogHeader>
          {carregandoVersoes ? (
            <div className="flex h-28 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : versoesModelo.length === 0 ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              Nenhuma versão histórica encontrada para este modelo.
            </div>
          ) : (
            <div className="space-y-3">
              {versoesModelo.map((versao) => (
                <Card key={versao.id}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">Versão {versao.version}</CardTitle>
                      <Badge variant="outline">
                        {new Date(versao.created_at).toLocaleString("pt-BR")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {versao.change_summary || "Versão arquivada automaticamente."}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">
                        Consultar conteúdo desta versão
                      </summary>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
                        {versao.content}
                      </pre>
                    </details>
                    {capacidades.can_manage_templates &&
                      modeloHistorico?.version !== versao.version && (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={carregandoVersoes}
                            onClick={() => void restaurarVersaoModelo(versao)}
                          >
                            <History className="h-4 w-4" aria-hidden />
                            Restaurar esta versão
                          </Button>
                        </div>
                      )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogHistoricoModelo(false)}>
              Fechar histórico
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogGerar} onOpenChange={setDialogGerar}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Gerar documento</DialogTitle>
            <DialogDescription>
              Gere um rascunho avulso ou vinculado a um processo. O conteúdo e os dados de origem
              ficam registrados como fotografia do documento.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={gerarDocumento} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {selecionado.enabled_modules["processos"] === true &&
                selecionado.enabled_modules["documentos"] === true &&
                selecionado.enabled_modules["modelos"] === true && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Vincular a processo de contratação (opcional)</Label>
                    <Select
                      value={processoGeracao || "sem_vinculo"}
                      onValueChange={(value) => {
                        setProcessoGeracao(value === "sem_vinculo" ? "" : value);
                        setContratoGeracao("");
                        setCamposComplementares({});
                        if (value !== "sem_vinculo") setFornecedorGeracao("nenhum");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Documento avulso ou selecione um processo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sem_vinculo">Documento avulso (sem processo)</SelectItem>
                        {processos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.number} — {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              {selecionado.enabled_modules["contratos"] === true && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Vincular a contrato (opcional)</Label>
                  <Select
                    value={contratoGeracao || "sem_contrato"}
                    onValueChange={(value) => {
                      const contratoId = value === "sem_contrato" ? "" : value;
                      const contrato = contratos.find((item) => item.id === contratoId);
                      setContratoGeracao(contratoId);
                      if (contrato) {
                        setProcessoGeracao(contrato.process_id ?? "");
                        setFornecedorGeracao(contrato.supplier_id ?? "nenhum");
                        setCamposComplementares({});
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Documento sem contrato vinculado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sem_contrato">Sem contrato</SelectItem>
                      {contratos
                        .filter((contrato) => contrato.status !== "arquivado")
                        .filter(
                          (contrato) => !processoGeracao || contrato.process_id === processoGeracao,
                        )
                        .map((contrato) => (
                          <SelectItem key={contrato.id} value={contrato.id}>
                            {contrato.number} — {contrato.object}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Ao selecionar um contrato, o sistema vincula também seu processo e fornecedor
                    cadastrados, quando existirem.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Modelo</Label>
                <Select value={modeloSelecionado} onValueChange={selecionarModelo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelos.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!processoGeracao && (
                <div className="space-y-2">
                  <Label>Fornecedor</Label>
                  <Select
                    value={fornecedorGeracao}
                    onValueChange={setFornecedorGeracao}
                    disabled={!!contratoGeracao}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vincular fornecedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">Sem fornecedor</SelectItem>
                      {fornecedores.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.legal_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!processoGeracao && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Título do documento *</Label>
                  <Input
                    required
                    minLength={2}
                    maxLength={180}
                    value={tituloGerado}
                    onChange={(e) => setTituloGerado(e.target.value)}
                  />
                </div>
              )}
              {processoGeracao && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Dados complementares do documento</Label>
                  <p className="text-xs text-muted-foreground">
                    Os campos com origem nos dados do processo serão preenchidos automaticamente.
                    Complete apenas os campos técnicos e administrativos abaixo; dados ausentes no
                    cadastro ficam identificados no rascunho para conferência.
                  </p>
                  {camposDoModelo.length === 0 ? (
                    <Alert>
                      <AlertDescription>
                        Selecione um modelo-base instalado que contenha os campos de preenchimento.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {camposDoModelo.map((campo) => (
                        <div key={campo.key} className="space-y-1.5">
                          <Label>
                            {campo.label || campo.key}
                            {campo.required ? " *" : ""}
                          </Label>
                          <Textarea
                            rows={2}
                            maxLength={12000}
                            required={campo.required === true}
                            value={camposComplementares[campo.key] ?? ""}
                            onChange={(event) =>
                              setCamposComplementares((current) => ({
                                ...current,
                                [campo.key]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!processoGeracao && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Conteúdo do documento *</Label>
                  <Textarea
                    required
                    rows={14}
                    maxLength={100000}
                    value={conteudoGerado}
                    onChange={(e) => setConteudoGerado(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Campos automáticos disponíveis: Secretaria, fornecedor, processo, contrato,
                    responsáveis, valores, vigência e usuário.
                  </p>
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Pré-visualizar o conteúdo preenchido
                    </summary>
                    <div className="mt-3 space-y-3">
                      {(previaGeracao.missingKeys.length > 0 ||
                        previaGeracao.unknownKeys.length > 0) && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Campos que precisam de conferência</AlertTitle>
                          <AlertDescription>
                            {previaGeracao.missingKeys.length > 0 && (
                              <p>
                                Dados não encontrados: {previaGeracao.missingKeys.join(", ")}.
                              </p>
                            )}
                            {previaGeracao.unknownKeys.length > 0 && (
                              <p>
                                Campos sem configuração: {previaGeracao.unknownKeys.join(", ")}.
                              </p>
                            )}
                            O rascunho manterá marcadores visíveis para impedir que dados ausentes
                            pareçam preenchidos.
                          </AlertDescription>
                        </Alert>
                      )}
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
                        {previaGeracao.content}
                      </pre>
                    </div>
                  </details>
                </div>
              )}
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground sm:col-span-2">
                <AlertCircle className="mr-1 inline h-3.5 w-3.5" /> A assinatura disponível nesta
                fase é uma assinatura eletrônica simples vinculada à sessão autenticada. Não
                substitui certificado ICP-Brasil nem assinatura qualificada.
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogGerar(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  salvandoGerado ||
                  (processoGeracao
                    ? !modeloSelecionado ||
                      camposDoModelo.some(
                        (campo) => campo.required && !camposComplementares[campo.key]?.trim(),
                      )
                    : !tituloGerado.trim() || !conteudoGerado.trim())
                }
              >
                {salvandoGerado ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FilePlus2 className="h-4 w-4" />
                )}{" "}
                Gerar rascunho
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!documentoGeradoEditando}
        onOpenChange={(open) => !salvandoEdicaoGerado && !open && setDocumentoGeradoEditando(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Editar rascunho documental</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarEdicaoGerado} className="space-y-4">
            <div className="space-y-1">
              <Label>Título do documento *</Label>
              <Input
                required
                minLength={2}
                maxLength={180}
                value={tituloEdicaoGerado}
                onChange={(event) => setTituloEdicaoGerado(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Conteúdo *</Label>
              <Textarea
                required
                rows={18}
                maxLength={100000}
                value={conteudoEdicaoGerado}
                onChange={(event) => setConteudoEdicaoGerado(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A edição só fica disponível enquanto o documento não estiver aguardando aprovação,
                aprovado ou assinado.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDocumentoGeradoEditando(null)}
                disabled={salvandoEdicaoGerado}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  salvandoEdicaoGerado || !tituloEdicaoGerado.trim() || !conteudoEdicaoGerado.trim()
                }
              >
                {salvandoEdicaoGerado ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}{" "}
                Salvar alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {documentoImpressao && (
        <div className="hidden print:block print:p-12">
          <div className="mx-auto max-w-4xl">
            <p className="mb-8 text-center text-sm">{selecionado.nome}</p>
            <h1 className="mb-8 text-center text-2xl font-bold">{documentoImpressao.title}</h1>
            {documentoImpressao.process_id && (
              <p className="mb-5 text-center text-sm">
                Documento vinculado ao processo de contratação.
              </p>
            )}
            <div className="whitespace-pre-wrap text-sm leading-7">
              {documentoImpressao.content_snapshot}
            </div>
            {documentoImpressao.status === "signed" && (
              <div className="mt-12 border-t pt-4 text-sm">
                <p>Assinatura eletrônica simples registrada no sistema.</p>
                <p>{documentoImpressao.signed_name}</p>
                <p>{documentoImpressao.signed_email}</p>
                <p>
                  {documentoImpressao.signed_at
                    ? new Date(documentoImpressao.signed_at).toLocaleString("pt-BR")
                    : ""}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {documentoImpressao && (
        <div className="print:hidden fixed bottom-5 right-5 z-50 flex gap-2 rounded-lg border bg-background p-2 shadow-lg">
          <Button variant="outline" onClick={() => setDocumentoImpressao(null)}>
            Fechar impressão
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Salvar / imprimir PDF
          </Button>
        </div>
      )}
    </div>
  );
}
