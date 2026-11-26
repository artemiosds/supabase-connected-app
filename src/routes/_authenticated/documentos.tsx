import { SupplierSelect } from "@/components/supplier-select";
import { AnnualDemandSource } from "@/components/annual-demand-source";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  History,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ReportExportActions } from "@/components/reports/report-export-actions";
import type { CsvColumn } from "@/lib/csv-export";
import { ETAPAS } from "@/lib/contratacao";
import {
  buildSamplePreviewContext,
  defaultTemplateScopeConfig,
  extractTemplatePlaceholders,
  filterAndSortTemplatesForContext,
  renderTemplateSamplePreview,
  ROTULOS_CATEGORIA_MODELO,
  ROTULOS_ESCOPO_MODELO,
  ROTULOS_ETAPA_MODELO,
  sanitizeAvailabilityScopes,
  sanitizeProcessStages,
  TEMPLATE_AVAILABILITY_SCOPES,
  TEMPLATE_CATEGORY_OPTIONS,
  type TemplateAvailabilityScope,
} from "@/lib/document-templates";
import { carregarTodasAsPaginas, db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import { DocumentViewerSheet } from "@/components/documents/document-viewer-sheet";
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
  isMissingDocumentTemplateSourcesTable,
  valuesForUneditedSource,
} from "@/lib/document-source";
import { uploadAndLinkDocumentSource } from "@/lib/document-source-upload";
import {
  buildDocumentTemplateSchema,
  buildDocumentVariableValues,
  DOCUMENT_TEMPLATE_VARIABLES,
  extractPendingDocumentFields,
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

type Fornecedor = Pick<Tables<"suppliers">, "id" | "legal_name" | "trade_name" | "cnpj" | "city">;
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
  | "instrument_type"
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
  const tenantIdRef = useRef<string | null>(selecionado?.id ?? null);
  tenantIdRef.current = selecionado?.id ?? null;
  const tenantAnteriorRef = useRef<string | null>(selecionado?.id ?? null);
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
  const [tenantCarregadoId, setTenantCarregadoId] = useState<string | null>(null);
  const requisicaoRef = useRef(0);
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
  const [supplierFilter, setSupplierFilter] = useState("");
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
  const [arquivoOriginalModelo, setArquivoOriginalModelo] = useState<File | null>(null);
  const [avisosModeloDocx, setAvisosModeloDocx] = useState<{ code: string; message: string }[]>([]);
  const conteudoModeloRef = useRef<HTMLTextAreaElement | null>(null);
  const [tipoModelo, setTipoModelo] = useState("custom");
  const [baseLegalModelo, setBaseLegalModelo] = useState("");
  const [fonteModelo, setFonteModelo] = useState("");
  const [resumoModelo, setResumoModelo] = useState("");
  const [escoposModelo, setEscoposModelo] = useState<TemplateAvailabilityScope[]>([
    "processos",
    "contratos",
    "fornecedores",
    "avulso",
  ]);
  const [etapasModelo, setEtapasModelo] = useState<string[]>([]);
  const [modeloAtivo, setModeloAtivo] = useState(true);
  const [abaEditorModelo, setAbaEditorModelo] = useState<"edicao" | "previa">("edicao");
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  const [carregandoOriginalModelo, setCarregandoOriginalModelo] = useState(false);
  const [dialogHistoricoModelo, setDialogHistoricoModelo] = useState(false);
  const [modeloHistorico, setModeloHistorico] = useState<Modelo | null>(null);
  const [versoesModelo, setVersoesModelo] = useState<VersaoModelo[]>([]);
  const [carregandoVersoes, setCarregandoVersoes] = useState(false);

  const [buscaVencimento, setBuscaVencimento] = useState("");
  const [situacaoVencimentoFiltro, setSituacaoVencimentoFiltro] = useState<
    "todos" | "vencidos" | "30dias" | "em_dia" | "sem_vencimento"
  >("todos");
  const [tipoVencimentoFiltro, setTipoVencimentoFiltro] = useState("todos");

  const [buscaModelo, setBuscaModelo] = useState("");
  const [categoriaModeloFiltro, setCategoriaModeloFiltro] = useState("todas");
  const [escopoModeloFiltro, setEscopoModeloFiltro] = useState<TemplateAvailabilityScope | "todos">(
    "todos",
  );
  const [statusModeloFiltro, setStatusModeloFiltro] = useState<"active" | "inactive" | "all">(
    "active",
  );

  const [modeloPrevia, setModeloPrevia] = useState<Modelo | null>(null);
  const [previaModo, setPreviaModo] = useState<"exemplo" | "real">("exemplo");
  const [previaProcessoId, setPreviaProcessoId] = useState("");
  const [previaContratoId, setPreviaContratoId] = useState("");
  const [previaFornecedorId, setPreviaFornecedorId] = useState("");

  const [modeloExcluindo, setModeloExcluindo] = useState<Modelo | null>(null);
  const [processandoExclusaoModelo, setProcessandoExclusaoModelo] = useState(false);
  const [processandoToggleModeloId, setProcessandoToggleModeloId] = useState<string | null>(null);

  const [buscaGerado, setBuscaGerado] = useState("");
  const [statusGeradoFiltro, setStatusGeradoFiltro] = useState("todos");
  const [mostrarTodosModelosGerador, setMostrarTodosModelosGerador] = useState(false);

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
  const [documentoVisualizando, setDocumentoVisualizando] = useState<DocumentoGerado | null>(null);
  const [baixandoRascunhoId, setBaixandoRascunhoId] = useState<string | null>(null);
  const [documentoGeradoEditando, setDocumentoGeradoEditando] = useState<DocumentoGerado | null>(
    null,
  );
  const [tituloEdicaoGerado, setTituloEdicaoGerado] = useState("");
  const [conteudoEdicaoGerado, setConteudoEdicaoGerado] = useState("");
  const [salvandoEdicaoGerado, setSalvandoEdicaoGerado] = useState(false);

  useEffect(() => {
    const tenantId = selecionado?.id ?? null;
    if (tenantAnteriorRef.current === tenantId) return;
    tenantAnteriorRef.current = tenantId;
    setDialogDocumento(false);
    setDocumentoEditando(null);
    setArquivoDocumento(null);
    setDialogModelo(false);
    setModeloEditando(null);
    setArquivoOriginalModelo(null);
    setAvisosModeloDocx([]);
    setCarregandoOriginalModelo(false);
    setDialogHistoricoModelo(false);
    setModeloHistorico(null);
    setVersoesModelo([]);
    setCarregandoVersoes(false);
    setDialogGerar(false);
    setDocumentoGeradoEditando(null);
    setDocumentoImpressao(null);
    setModeloPrevia(null);
    setModeloExcluindo(null);
    setSalvandoDocumento(false);
    setSalvandoModelo(false);
    setSalvandoGerado(false);
    setSalvandoEdicaoGerado(false);
    setInstalandoModelo(null);
    setBaixandoRascunhoId(null);
  }, [selecionado?.id]);

  const carregar = useCallback(async () => {
    const tenantId = selecionado?.id;
    if (tenantId !== tenantIdRef.current) return;
    const requisicaoAtual = ++requisicaoRef.current;
    setTenantCarregadoId(null);
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
    if (!tenantId) {
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
            .select("id,legal_name,trade_name,cnpj,city")
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
        db
          .from("tenants")
          .select("municipality,state,cnpj,ibge_code")
          .eq("id", selecionado.id)
          .maybeSingle(),
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
                .select(
                  "id,number,title,description,modality,stage,status,priority,requesting_unit,responsible_name,estimated_value,due_date",
                )
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
                .select(
                  "id,number,object,process_id,supplier_id,status,instrument_type,modality,total_value,start_date,end_date,manager_name,inspector_name,ordinance",
                )
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
      if (requisicaoAtual !== requisicaoRef.current || tenantIdRef.current !== tenantId) return;
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
      setTenantCarregadoId(tenantId);
    } catch (e) {
      if (requisicaoAtual !== requisicaoRef.current || tenantIdRef.current !== tenantId) return;
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
      setMunicipioSecretaria("");
      setUfSecretaria("");
      setCnpjSecretaria("");
      setCodigoIbgeSecretaria("");
      setTenantCarregadoId(tenantId);
    } finally {
      if (requisicaoAtual === requisicaoRef.current && tenantIdRef.current === tenantId)
        setLoading(false);
    }
  }, [selecionado?.id, selecionado?.enabled_modules]);

  useEffect(() => {
    void carregar();
    return () => {
      requisicaoRef.current += 1;
    };
  }, [carregar]);

  useEffect(() => {
    if (loading || tenantCarregadoId !== selecionado?.id) return;
    const url = new URL(window.location.href);
    const supplier = url.searchParams.get("fornecedor");
    if (!supplier) return;
    url.searchParams.delete("fornecedor");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    if (!fornecedores.some((row) => row.id === supplier)) {
      toast.error("Fornecedor indisponível nesta Secretaria.");
      return;
    }
    setSupplierFilter(supplier);
    setFornecedorId(supplier);
    setAba("vencimentos");
  }, [loading, tenantCarregadoId, selecionado?.id, fornecedores]);
  useEffect(() => {
    setSupplierFilter("");
  }, [selecionado?.id]);
  const fornecedorPorId = useMemo(
    () => new Map(fornecedores.map((f) => [f.id, f])),
    [fornecedores],
  );
  const contratoPorId = useMemo(
    () => new Map(contratos.map((contrato) => [contrato.id, contrato])),
    [contratos],
  );
  const visibleDocuments = useMemo(() => {
    const q = buscaVencimento.trim().toLocaleLowerCase("pt-BR");
    return documentos.filter((row) => {
      if (supplierFilter && row.supplier_id !== supplierFilter) return false;
      if (tipoVencimentoFiltro !== "todos" && row.document_type !== tipoVencimentoFiltro) return false;
      if (situacaoVencimentoFiltro !== "todos") {
        const sit = situacaoVencimento(row.expires_at);
        if (situacaoVencimentoFiltro === "vencidos" && sit.label !== "Vencido") return false;
        if (situacaoVencimentoFiltro === "30dias" && sit.variant !== "secondary") return false;
        if (situacaoVencimentoFiltro === "em_dia" && sit.label !== "Em dia") return false;
        if (situacaoVencimentoFiltro === "sem_vencimento" && row.expires_at !== null) return false;
      }
      if (q) {
        const supplier = fornecedorPorId.get(row.supplier_id);
        const texto = [
          row.title,
          row.document_type,
          row.notes ?? "",
          row.file_name ?? "",
          supplier?.legal_name ?? "",
          supplier?.trade_name ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase("pt-BR");
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [
    documentos,
    buscaVencimento,
    supplierFilter,
    tipoVencimentoFiltro,
    situacaoVencimentoFiltro,
    fornecedorPorId,
  ]);
  const colunasVencimentos: CsvColumn<DocumentoFornecedor>[] = [
    { header: "Documento", value: (d) => d.title },
    {
      header: "Tipo",
      value: (d) => TIPOS.find(([v]) => v === d.document_type)?.[1] ?? d.document_type,
    },
    {
      header: "Fornecedor",
      value: (d) =>
        fornecedorPorId.get(d.supplier_id)?.trade_name ||
        fornecedorPorId.get(d.supplier_id)?.legal_name ||
        "—",
    },
    { header: "Emissão", value: (d) => dataLocal(d.issue_date) },
    { header: "Vencimento", value: (d) => dataLocal(d.expires_at) },
    { header: "Situação", value: (d) => situacaoVencimento(d.expires_at).label },
  ];
  const vencidos = documentos.filter(
    (d) => d.expires_at && situacaoVencimento(d.expires_at).label === "Vencido",
  ).length;
  const proximos = documentos.filter(
    (d) => d.expires_at && situacaoVencimento(d.expires_at).variant === "secondary",
  ).length;

  function abrirNovoDocumento() {
    setDocumentoEditando(null);
    setFornecedorId(supplierFilter);
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
    const tenantId = selecionado?.id;
    setArquivoDocumento(null);
    if (!file || !tenantId) return;
    if (documentoEditando) {
      toast.error("Para substituir um arquivo, cadastre um novo documento e arquive o anterior.");
      return;
    }
    try {
      await validarArquivoPrivado(file);
      if (tenantIdRef.current !== tenantId) return;
      setArquivoDocumento(file);
      setLinkDocumento("");
      toast.success("Arquivo validado e pronto para envio privado.");
    } catch (error) {
      if (tenantIdRef.current !== tenantId) return;
      toast.error(error instanceof Error ? error.message : "Arquivo inválido.");
    }
  }

  async function abrirArquivoPrivado(documento: DocumentoFornecedor) {
    const tenantId = selecionado?.id;
    if (!tenantId || documento.tenant_id !== tenantId) return;
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
    if (tenantIdRef.current !== tenantId) return;
    if (signedUrlError || !data?.signedUrl) {
      toast.error(signedUrlError?.message ?? "Não foi possível gerar o link temporário.");
      return;
    }

    const opened = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(data.signedUrl);
  }

  async function importarModelo(file?: File) {
    const tenantId = selecionado?.id;
    if (!file || !tenantId) return;
    try {
      const text = await importarTextoDeModelo(file);
      if (tenantIdRef.current !== tenantId) return;
      let avisos: { code: string; message: string }[] = [];
      if (file.name.toLowerCase().endsWith(".docx")) {
        const { analyzeDocx } = await import("@/lib/docx-engine");
        const analysis = await analyzeDocx(await file.arrayBuffer());
        avisos = analysis.warnings;
      }
      setConteudoModelo(text);
      setArquivoOriginalModelo(file.name.toLowerCase().endsWith(".docx") ? file : null);
      setAvisosModeloDocx(avisos);
      if (!tituloModelo.trim())
        setTituloModelo(file.name.replace(/\.(txt|md|docx)$/i, "").slice(0, 180));
      toast.success(
        file.name.toLowerCase().endsWith(".docx")
          ? "Word analisado. A estrutura original será preservada na exportação Word; recursos não compatíveis com PDF serão sinalizados."
          : "Texto do modelo importado.",
      );
    } catch (error) {
      if (tenantIdRef.current !== tenantId) return;
      setArquivoOriginalModelo(null);
      setAvisosModeloDocx([]);
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
    const tenantId = selecionado.id;
    if (tenantIdRef.current !== tenantId) return;
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
        .eq("tenant_id", tenantId);
      if (tenantIdRef.current !== tenantId) return;
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
        if (tenantIdRef.current !== tenantId) return;
        setSalvandoDocumento(false);
        toast.error(error instanceof Error ? error.message : "Arquivo inválido.");
        return;
      }

      const documentId = crypto.randomUUID();
      const objectId = crypto.randomUUID();
      const storagePath = [
        tenantId,
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

      if (tenantIdRef.current !== tenantId) {
        await db.storage.from("gfs-private-documents").remove([storagePath]);
        return;
      }
      if (uploadError) {
        setSalvandoDocumento(false);
        toast.error(`Não foi possível enviar o arquivo: ${uploadError.message}`);
        return;
      }

      const { error: insertError } = await db.from("supplier_documents").insert({
        id: documentId,
        tenant_id: tenantId,
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
        if (tenantIdRef.current !== tenantId) return;
        toast.error(
          cleanupError
            ? `O registro não foi salvo (${insertError.message}). O arquivo permanece privado e sem vínculo; solicite a limpeza ao suporte.`
            : `O cadastro não foi salvo e o arquivo enviado foi removido: ${insertError.message}`,
        );
        return;
      }
      if (tenantIdRef.current !== tenantId) return;
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
      if (tenantIdRef.current !== tenantId) return;
      setSalvandoDocumento(false);
      if (insertError) {
        toast.error(insertError.message);
        return;
      }
      toast.success("Documento registrado.");
    }

    if (tenantIdRef.current !== tenantId) return;
    setArquivoDocumento(null);
    setDialogDocumento(false);
    await carregar();
  }

  async function arquivarDocumento(d: DocumentoFornecedor) {
    const tenantId = selecionado?.id;
    if (!tenantId || d.tenant_id !== tenantId) return;
    const { error: updateError } = await db
      .from("supplier_documents")
      .update({ status: "archived" })
      .eq("id", d.id)
      .eq("tenant_id", tenantId);
    if (tenantIdRef.current !== tenantId) return;
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success("Documento arquivado.");
    await carregar();
  }

  function iniciarNovoModelo() {
    setCarregandoOriginalModelo(false);
    setModeloEditando(null);
    setTituloModelo("");
    setDescricaoModelo("");
    setConteudoModelo("");
    setArquivoOriginalModelo(null);
    setAvisosModeloDocx([]);
    setTipoModelo("custom");
    const defaults = defaultTemplateScopeConfig("custom");
    setEscoposModelo(defaults.availability_scopes);
    setEtapasModelo(defaults.process_stages);
    setModeloAtivo(true);
    setAbaEditorModelo("edicao");
    setBaseLegalModelo("");
    setFonteModelo("");
    setResumoModelo("");
    setDialogModelo(true);
  }

  function duplicarModelo(modelo: Modelo) {
    setCarregandoOriginalModelo(false);
    setModeloEditando(null);
    setTituloModelo(`${modelo.title} (Cópia)`.slice(0, 180));
    setDescricaoModelo(modelo.description ?? "");
    setConteudoModelo(modelo.content);
    setArquivoOriginalModelo(null);
    setAvisosModeloDocx([]);
    setTipoModelo(modelo.template_type);
    setEscoposModelo(sanitizeAvailabilityScopes(modelo.availability_scopes, modelo.template_type));
    setEtapasModelo(sanitizeProcessStages(modelo.process_stages));
    setModeloAtivo(true);
    setAbaEditorModelo("edicao");
    setBaseLegalModelo(modelo.legal_basis ?? "");
    setFonteModelo(modelo.source_reference ?? "");
    setResumoModelo(`Duplicado a partir de "${modelo.title}" (v${modelo.version}).`);
    setDialogModelo(true);
  }

  async function alternarAtivoModelo(modelo: Modelo, nextActive: boolean) {
    if (!selecionado || !capacidades.can_manage_templates || processandoToggleModeloId) return;
    const tenantId = selecionado.id;
    setProcessandoToggleModeloId(modelo.id);
    const { error: toggleError } = await db.rpc("set_document_template_active", {
      p_tenant_id: tenantId,
      p_template_id: modelo.id,
      p_is_active: nextActive,
    });
    if (tenantIdRef.current !== tenantId) return;
    setProcessandoToggleModeloId(null);
    if (toggleError) {
      toast.error(toggleError.message);
      return;
    }
    toast.success(
      nextActive
        ? `Modelo "${modelo.title}" reativado e disponível nos fluxos configurados.`
        : `Modelo "${modelo.title}" inativado. Documentos já emitidos continuam preservados.`,
    );
    await carregar();
  }

  async function confirmarExcluirModelo() {
    if (!selecionado || !modeloExcluindo || !capacidades.can_manage_templates || processandoExclusaoModelo)
      return;
    const tenantId = selecionado.id;
    const target = modeloExcluindo;
    setProcessandoExclusaoModelo(true);
    const { data: storagePaths, error: deleteError } = await db.rpc("delete_document_template", {
      p_tenant_id: tenantId,
      p_template_id: target.id,
    });
    if (tenantIdRef.current !== tenantId) return;
    if (deleteError) {
      setProcessandoExclusaoModelo(false);
      toast.error(deleteError.message);
      return;
    }
    if (Array.isArray(storagePaths) && storagePaths.length > 0) {
      await db.storage.from("gfs-private-documents").remove(storagePaths);
    }
    if (tenantIdRef.current !== tenantId) return;
    setProcessandoExclusaoModelo(false);
    setModeloExcluindo(null);
    toast.success(`Modelo "${target.title}" excluído definitivamente.`);
    await carregar();
  }

  function abrirPreviaModelo(modelo: Modelo) {
    setPreviaModo("exemplo");
    setPreviaProcessoId("");
    setPreviaContratoId("");
    setPreviaFornecedorId("");
    setModeloPrevia(modelo);
  }

  function alternarEscopoModelo(scope: TemplateAvailabilityScope) {
    setEscoposModelo((atual) => {
      const existe = atual.includes(scope);
      if (existe && atual.length === 1) {
        toast.warning("Selecione pelo menos um local onde o modelo ficará disponível.");
        return atual;
      }
      const next = existe ? atual.filter((item) => item !== scope) : [...atual, scope];
      if (scope === "processos" && existe) {
        setEtapasModelo([]);
      }
      return next;
    });
  }

  function alternarEtapaModelo(stageId: string) {
    setEtapasModelo((atual) =>
      atual.includes(stageId) ? atual.filter((item) => item !== stageId) : [...atual, stageId],
    );
  }

  function usarModeloNoGerador(modelo: Modelo) {
    setModeloPrevia(null);
    setModeloSelecionado(modelo.id);
    setCamposComplementares({});
    setTituloGerado(modelo.title);
    setConteudoGerado(modelo.content);
    setProcessoGeracao("");
    setContratoGeracao("");
    setFornecedorGeracao("nenhum");
    setMostrarTodosModelosGerador(true);
    setDialogGerar(true);
  }

  async function iniciarEdicaoModelo(modelo: Modelo) {
    if (!selecionado) return;
    const tenantId = selecionado.id;
    setModeloEditando(modelo);
    setTituloModelo(modelo.title);
    setDescricaoModelo(modelo.description ?? "");
    setConteudoModelo(modelo.content);
    setArquivoOriginalModelo(null);
    setAvisosModeloDocx([]);
    setTipoModelo(modelo.template_type);
    setEscoposModelo(sanitizeAvailabilityScopes(modelo.availability_scopes, modelo.template_type));
    setEtapasModelo(sanitizeProcessStages(modelo.process_stages));
    setModeloAtivo(modelo.is_active);
    setAbaEditorModelo("edicao");
    setBaseLegalModelo(modelo.legal_basis ?? "");
    setFonteModelo(modelo.source_reference ?? "");
    setResumoModelo("");
    setDialogModelo(true);
    setCarregandoOriginalModelo(true);

    try {
      const { data: source, error: sourceError } = await db
        .from("document_template_sources")
        .select("storage_path, file_name")
        .eq("tenant_id", tenantId)
        .eq("template_id", modelo.id)
        .eq("version", modelo.version)
        .maybeSingle();
      if (tenantIdRef.current !== tenantId) return;
      if (sourceError && !isMissingDocumentTemplateSourcesTable(sourceError)) {
        throw sourceError;
      }
      if (source) {
        const { data: original, error: downloadError } = await db.storage
          .from("gfs-private-documents")
          .download(source.storage_path);
        if (tenantIdRef.current !== tenantId) return;
        if (downloadError || !original) {
          throw downloadError ?? new Error("O Word original desta versão não está disponível.");
        }
        const file = new File([original], source.file_name, {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const { analyzeDocx } = await import("@/lib/docx-engine");
        const analysis = await analyzeDocx(await file.arrayBuffer());
        if (tenantIdRef.current !== tenantId) return;
        setArquivoOriginalModelo(file);
        setAvisosModeloDocx(analysis.warnings);
      }
    } catch (error) {
      if (tenantIdRef.current !== tenantId) return;
      setDialogModelo(false);
      setModeloEditando(null);
      setArquivoOriginalModelo(null);
      setAvisosModeloDocx([]);
      toast.error(
        error instanceof Error ? error.message : "Não foi possível carregar o Word original.",
      );
    } finally {
      if (tenantIdRef.current === tenantId) setCarregandoOriginalModelo(false);
    }
  }

  function inserirCampoModelo(key: string) {
    const textarea = conteudoModeloRef.current;
    const token = "{{" + key + "}}";
    const start = textarea?.selectionStart ?? conteudoModelo.length;
    const end = textarea?.selectionEnd ?? start;
    const updated = conteudoModelo.slice(0, start) + token + conteudoModelo.slice(end);
    setConteudoModelo(updated);
    if (arquivoOriginalModelo) {
      toast.warning(
        "Inserir um campo altera o texto e desvincula o Word original desta nova versão.",
      );
    }
    setArquivoOriginalModelo(null);
    setAvisosModeloDocx([]);
    requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = start + token.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  async function abrirHistoricoModelo(modelo: Modelo) {
    if (!selecionado) return;
    const tenantId = selecionado.id;
    setModeloHistorico(modelo);
    setVersoesModelo([]);
    setDialogHistoricoModelo(true);
    setCarregandoVersoes(true);
    const { data, error: historyError } = await db
      .from("document_template_versions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("template_id", modelo.id)
      .order("version", { ascending: false });
    if (tenantIdRef.current !== tenantId) return;
    setCarregandoVersoes(false);
    if (historyError) {
      toast.error(historyError.message);
      return;
    }
    setVersoesModelo(data ?? []);
  }

  async function restaurarVersaoModelo(versao: VersaoModelo) {
    if (!selecionado || !capacidades.can_manage_templates || !modeloHistorico) return;
    const tenantId = selecionado.id;
    const confirmou = window.confirm(
      `Restaurar a versão ${versao.version} de "${modeloHistorico.title}"? O conteúdo atual será preservado no histórico e a restauração criará uma nova versão.`,
    );
    if (!confirmou) return;

    setCarregandoVersoes(true);
    try {
      let arquivoOriginal: File | null = null;
      const { data: source, error: sourceError } = await db
        .from("document_template_sources")
        .select("storage_path, file_name")
        .eq("tenant_id", tenantId)
        .eq("template_id", modeloHistorico.id)
        .eq("version", versao.version)
        .maybeSingle();
      if (tenantIdRef.current !== tenantId) return;
      if (sourceError && !isMissingDocumentTemplateSourcesTable(sourceError)) {
        throw sourceError;
      }
      if (source) {
        const { data: original, error: downloadError } = await db.storage
          .from("gfs-private-documents")
          .download(source.storage_path);
        if (tenantIdRef.current !== tenantId) return;
        if (downloadError || !original) {
          throw (
            downloadError ?? new Error("O Word original da versão histórica não está disponível.")
          );
        }
        arquivoOriginal = new File([original], source.file_name, {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      }

      const { data: restored, error: restoreError } = await db
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
        .eq("tenant_id", tenantId)
        .select("version")
        .single();
      if (restoreError || !restored) {
        throw restoreError ?? new Error("Não foi possível registrar a nova versão restaurada.");
      }
      if (tenantIdRef.current !== tenantId) return;

      let avisoOrigem: string | null = null;
      if (arquivoOriginal) {
        const path = `${tenantId}/template-sources/${modeloHistorico.id}/v${restored.version}/${crypto.randomUUID()}.docx`;
        const sourceResult = await uploadAndLinkDocumentSource({
          upload: async () =>
            await db.storage.from("gfs-private-documents").upload(path, arquivoOriginal, {
              contentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              upsert: false,
            }),
          insertMetadata: async () =>
            await db.from("document_template_sources").insert({
              tenant_id: tenantId,
              template_id: modeloHistorico.id,
              version: restored.version,
              storage_path: path,
              file_name: nomeSeguroArquivo(arquivoOriginal.name) || "modelo.docx",
              file_size: arquivoOriginal.size,
            }),
          remove: async () => await db.storage.from("gfs-private-documents").remove([path]),
          isTenantCurrent: () => tenantIdRef.current === tenantId,
        });
        if (sourceResult.status === "tenant_changed") {
          if (sourceResult.cleanupError) {
            toast.error(
              "A troca de Secretaria interrompeu a restauração, e a limpeza do arquivo temporário falhou. Solicite uma verificação administrativa.",
            );
          }
          return;
        }
        if (sourceResult.status === "upload_failed") {
          avisoOrigem = sourceResult.cleanupError
            ? `Versão restaurada, mas o Word original não foi reanexado (${sourceResult.error.message}) e a limpeza do arquivo temporário falhou (${sourceResult.cleanupError.message}).`
            : `Versão restaurada, mas o Word original não foi reanexado: ${sourceResult.error.message}`;
        } else if (sourceResult.status === "metadata_failed") {
          avisoOrigem = sourceResult.cleanupError
            ? `Versão restaurada, mas o Word original não foi vinculado (${sourceResult.error.message}) e a limpeza do arquivo órfão falhou (${sourceResult.cleanupError.message}).`
            : `Versão restaurada, mas o Word original não foi vinculado: ${sourceResult.error.message}`;
        }
      }

      if (tenantIdRef.current !== tenantId) return;
      if (avisoOrigem) {
        toast.warning(avisoOrigem);
      } else {
        toast.success(
          arquivoOriginal
            ? "Versão restaurada com o Word original preservado."
            : "Versão restaurada. Uma nova versão foi registrada no histórico.",
        );
      }
      setDialogHistoricoModelo(false);
      setModeloHistorico(null);
      await carregar();
    } catch (error) {
      if (tenantIdRef.current !== tenantId) return;
      toast.error(
        error instanceof Error ? error.message : "Não foi possível restaurar esta versão.",
      );
    } finally {
      if (tenantIdRef.current === tenantId) setCarregandoVersoes(false);
    }
  }

  async function salvarModelo(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    const tenantId = selecionado.id;
    const arquivoOriginal = arquivoOriginalModelo;
    const modeloAtual = modeloEditando;
    setSalvandoModelo(true);
    if (arquivoOriginal) {
      const { error: sourceTableError } = await db
        .from("document_template_sources")
        .select("template_id")
        .limit(1);
      if (tenantIdRef.current !== tenantId) return;
      if (sourceTableError) {
        setSalvandoModelo(false);
        toast.error(
          isMissingDocumentTemplateSourcesTable(sourceTableError)
            ? "O vínculo do Word original ainda não está habilitado no banco. Nenhuma versão foi salva; tente novamente após a implantação segura da migration."
            : `Não foi possível verificar o armazenamento do Word original: ${sourceTableError.message}`,
        );
        return;
      }
    }
    const escoposSanitizados = sanitizeAvailabilityScopes(escoposModelo, tipoModelo);
    const etapasSanitizadas = escoposSanitizados.includes("processos")
      ? sanitizeProcessStages(etapasModelo)
      : [];
    const payload = {
      title: tituloModelo.trim(),
      description: descricaoModelo.trim() || null,
      content: conteudoModelo.trim(),
      template_type: tipoModelo,
      legal_basis: baseLegalModelo.trim() || null,
      source_reference: fonteModelo.trim() || null,
      availability_scopes: escoposSanitizados,
      process_stages: etapasSanitizadas,
      is_active: modeloAtivo,
      variables_schema: buildDocumentTemplateSchema(
        conteudoModelo.trim(),
        modeloAtual?.variables_schema,
      ) as Json,
      change_summary:
        resumoModelo.trim() ||
        (modeloAtual ? "Modelo editado pela Secretaria." : "Modelo criado pela Secretaria."),
    };
    const result = modeloAtual
      ? await db
          .from("document_templates")
          .update(payload)
          .eq("id", modeloAtual.id)
          .eq("tenant_id", tenantId)
          .select("*")
          .single()
      : await db
          .from("document_templates")
          .insert({
            tenant_id: tenantId,
            ...payload,
          })
          .select("*")
          .single();
    if (result.error) {
      if (tenantIdRef.current !== tenantId) return;
      setSalvandoModelo(false);
      toast.error(result.error.message);
      return;
    }
    if (arquivoOriginal && result.data) {
      const { data: existingSource, error: sourceError } = await db
        .from("document_template_sources")
        .select("storage_path")
        .eq("tenant_id", tenantId)
        .eq("template_id", result.data.id)
        .eq("version", result.data.version)
        .maybeSingle();
      if (sourceError || existingSource) {
        if (tenantIdRef.current !== tenantId) return;
        setSalvandoModelo(false);
        setModeloEditando(result.data);
        toast.error(
          sourceError?.message ??
            "O texto foi salvo, mas esta versão já tem um Word original. Altere o texto para criar uma nova versão.",
        );
        return;
      }
      if (tenantIdRef.current !== tenantId) return;
      const path = `${tenantId}/template-sources/${result.data.id}/v${result.data.version}/${crypto.randomUUID()}.docx`;
      const sourceResult = await uploadAndLinkDocumentSource({
        upload: async () =>
          await db.storage.from("gfs-private-documents").upload(path, arquivoOriginal, {
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            upsert: false,
          }),
        insertMetadata: async () =>
          await db.from("document_template_sources").insert({
            tenant_id: tenantId,
            template_id: result.data.id,
            version: result.data.version,
            storage_path: path,
            file_name: nomeSeguroArquivo(arquivoOriginal.name) || "modelo.docx",
            file_size: arquivoOriginal.size,
          }),
        remove: async () => await db.storage.from("gfs-private-documents").remove([path]),
        isTenantCurrent: () => tenantIdRef.current === tenantId,
      });
      if (sourceResult.status === "tenant_changed") {
        if (sourceResult.cleanupError) {
          toast.error(
            "A troca de Secretaria interrompeu o salvamento, e a limpeza do arquivo temporário falhou. Solicite uma verificação administrativa.",
          );
        }
        return;
      }
      if (sourceResult.status === "upload_failed" || sourceResult.status === "metadata_failed") {
        if (tenantIdRef.current !== tenantId) return;
        setSalvandoModelo(false);
        setModeloEditando(result.data);
        const isUploadFailure = sourceResult.status === "upload_failed";
        const stageMessage = isUploadFailure ? "não foi enviado" : "não foi vinculado";
        const cleanupMessage = sourceResult.cleanupError
          ? ` e a limpeza do arquivo órfão falhou (${sourceResult.cleanupError.message})`
          : "";
        toast.error(
          `Texto salvo, mas o Word original ${stageMessage}: ${sourceResult.error.message}${cleanupMessage}`,
        );
        return;
      }
    }
    if (tenantIdRef.current !== tenantId) return;
    setSalvandoModelo(false);
    toast.success(
      modeloAtual
        ? "Modelo atualizado. Uma nova versão foi registrada."
        : "Modelo salvo nesta Secretaria.",
    );
    setDialogModelo(false);
    setModeloEditando(null);
    setTituloModelo("");
    setDescricaoModelo("");
    setConteudoModelo("");
    setArquivoOriginalModelo(null);
    setAvisosModeloDocx([]);
    setTipoModelo("custom");
    setBaseLegalModelo("");
    setFonteModelo("");
    setResumoModelo("");
    await carregar();
  }

  function iniciarGeracao(processoId = "", supplierId = "nenhum") {
    setModeloSelecionado("");
    setProcessoGeracao(processoId);
    setContratoGeracao("");
    setCamposComplementares({});
    setFornecedorGeracao(supplierId);
    setTituloGerado("");
    setConteudoGerado("");
    setMostrarTodosModelosGerador(false);
    setDialogGerar(true);
  }

  useEffect(() => {
    if (loading || !selecionado?.id || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const processoId = params.get("processo");
    const contratoId = params.get("contrato");
    const tipoSolicitado = params.get("tipo");
    const codigoModelo = params.get("modelo");
    const modeloIdSolicitado = params.get("modeloId");
    if ((!processoId && !contratoId) || (!tipoSolicitado && !codigoModelo && !modeloIdSolicitado))
      return;

    const limparParametros = () => {
      params.delete("processo");
      params.delete("contrato");
      params.delete("tipo");
      params.delete("modelo");
      params.delete("modeloId");
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    };

    if (!capacidades.can_create) {
      toast.error("Seu perfil não possui permissão para gerar documentos.");
      limparParametros();
      return;
    }

    const processo = processoId ? processos.find((item) => item.id === processoId) : null;
    if (processoId && !processo) {
      toast.error("O processo solicitado não está disponível nesta Secretaria.");
      limparParametros();
      return;
    }

    const contrato = contratoId ? contratos.find((item) => item.id === contratoId) : null;
    if (
      contratoId &&
      (!contrato || contrato.instrument_type !== "contrato" || contrato.status !== "vigente")
    ) {
      toast.error("O contrato solicitado não está disponível para preparar esta minuta.");
      limparParametros();
      return;
    }
    if (contrato && contrato.end_date < new Date().toLocaleDateString("sv-SE")) {
      toast.error(
        "A vigência deste contrato já terminou. Encaminhe a situação para análise jurídica.",
      );
      limparParametros();
      return;
    }
    if (processoId && contrato && contrato.process_id !== processoId) {
      toast.error("O contrato selecionado não pertence ao processo informado.");
      limparParametros();
      return;
    }

    const modelo = modelos.find(
      (item) =>
        item.is_active &&
        (modeloIdSolicitado
          ? item.id === modeloIdSolicitado
          : codigoModelo
            ? item.template_code === codigoModelo
            : item.template_type === tipoSolicitado),
    );
    if (contratoId && codigoModelo && !modelo) {
      if (moduloModelosAtivo && capacidades.can_manage_templates) {
        setAba("biblioteca");
        toast.info("Instale o modelo-base de prorrogação na Biblioteca-base para continuar.");
        return;
      }
      toast.info(
        "O modelo-base ainda não está instalado nesta Secretaria. Solicite a instalação a um administrador.",
      );
      limparParametros();
      return;
    }

    const processoVinculado =
      contrato?.process_id && processos.some((item) => item.id === contrato.process_id)
        ? contrato.process_id
        : "";
    iniciarGeracao(processoId || processoVinculado);
    if (contrato) {
      setContratoGeracao(contrato.id);
      setFornecedorGeracao(contrato.supplier_id ?? "nenhum");
    }
    if (modelo) {
      setModeloSelecionado(modelo.id);
      setTituloGerado(modelo.title);
      setConteudoGerado(modelo.content);
    } else {
      toast.info("Instale o modelo correspondente na Biblioteca-base para gerar este documento.");
    }

    limparParametros();
  }, [
    loading,
    selecionado?.id,
    processos,
    modelos,
    contratos,
    capacidades.can_create,
    capacidades.can_manage_templates,
    moduloModelosAtivo,
  ]);

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
    if (
      modeloSelecionado &&
      camposDoModelo.some((campo) => campo.required && !camposComplementares[campo.key]?.trim())
    ) {
      toast.error("Preencha todos os campos obrigatórios do modelo antes de gerar a minuta.");
      return;
    }
    if (modeloDoGerador?.template_type === "term_addendum_renewal" && !contratoGeracao) {
      toast.error("A minuta de prorrogação exige um contrato vinculado.");
      return;
    }
    setSalvandoGerado(true);
    if (processoGeracao && modeloDoGerador?.template_type !== "term_addendum_renewal") {
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
        document_type: modeloDoGerador?.template_type ?? "custom",
        template_version: modeloDoGerador?.version ?? null,
        variables_snapshot: valoresCompletosGeracao as unknown as Json,
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
    contratoDoGerador?.supplier_id ?? (fornecedorGeracao === "nenhum" ? null : fornecedorGeracao);
  const fornecedorDoGerador = fornecedores.find(
    (fornecedor) => fornecedor.id === fornecedorIdDoGerador,
  );
  const processoIdDoGerador = contratoDoGerador?.process_id ?? processoGeracao;
  const processoDoGerador =
    processos.find((processo) => processo.id === processoIdDoGerador) ?? null;
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
  const modeloDoGerador = modelos.find((m) => m.id === modeloSelecionado);
  const schemaCamposGeracao =
    (modeloDoGerador?.variables_schema as unknown as CampoComplementar[] | undefined) ?? [];
  const camposDoModelo = schemaCamposGeracao.filter(
    (campo) =>
      (!processoGeracao || !campo.source?.startsWith("process.")) &&
      !valoresAutomaticosGeracao[campo.key]?.trim(),
  );
  const chavesDeclaradasGeracao = new Set(schemaCamposGeracao.map((campo) => campo.key));
  const overridesGeracao = Object.fromEntries(
    Object.entries(camposComplementares).filter(
      ([key]) => chavesDeclaradasGeracao.has(key) && !valoresAutomaticosGeracao[key]?.trim(),
    ),
  );
  const valoresCompletosGeracao = {
    ...valoresAutomaticosGeracao,
    ...overridesGeracao,
  };
  const previaGeracao = renderDocumentTemplate(conteudoGerado, valoresCompletosGeracao);
  const modelosInstalados = new Set(
    modelos
      .filter((m) => m.catalog_template_id && m.is_active)
      .map((m) => m.catalog_template_id as string),
  );
  const modelosAtivosCount = useMemo(
    () => modelos.filter((m) => m.is_active).length,
    [modelos],
  );
  const geradosPorModeloCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of gerados) {
      if (item.template_id) {
        counts.set(item.template_id, (counts.get(item.template_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [gerados]);
  const modelosFiltradosNaAba = useMemo(
    () =>
      filterAndSortTemplatesForContext(modelos, {
        search: buscaModelo,
        category: categoriaModeloFiltro,
        scope: escopoModeloFiltro,
        status: statusModeloFiltro,
        includeOutOfScope: escopoModeloFiltro === "todos",
      }),
    [modelos, buscaModelo, categoriaModeloFiltro, escopoModeloFiltro, statusModeloFiltro],
  );
  const escopoGerador: TemplateAvailabilityScope = contratoGeracao
    ? "contratos"
    : processoGeracao
      ? "processos"
      : fornecedorGeracao !== "nenhum"
        ? "fornecedores"
        : "avulso";
  const modelosDisponiveisGerador = useMemo(
    () =>
      filterAndSortTemplatesForContext(modelos, {
        scope: escopoGerador,
        processStage: processoDoGerador?.stage ?? null,
        status: "active",
        includeOutOfScope: mostrarTodosModelosGerador,
      }),
    [modelos, escopoGerador, processoDoGerador?.stage, mostrarTodosModelosGerador],
  );
  const geradosFiltrados = useMemo(() => {
    const q = buscaGerado.trim().toLocaleLowerCase("pt-BR");
    return gerados.filter((d) => {
      const wfStatus = fluxoPorDocumento.get(d.id)?.status ?? "draft";
      if (statusGeradoFiltro !== "todos" && wfStatus !== statusGeradoFiltro) return false;
      if (q) {
        const texto = [
          d.title,
          d.document_type,
          fornecedorPorId.get(d.supplier_id ?? "")?.legal_name ?? "",
          contratoPorId.get(d.contract_id ?? "")?.number ?? "",
          processos.find((p) => p.id === d.process_id)?.number ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase("pt-BR");
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [gerados, buscaGerado, statusGeradoFiltro, fluxoPorDocumento, fornecedorPorId, contratoPorId, processos]);

  const previaEditorResultado = useMemo(() => {
    if (!dialogModelo) return null;
    const context = buildSamplePreviewContext({
      tenantName: selecionado?.nome ?? null,
      municipality: municipioSecretaria || null,
      state: ufSecretaria || null,
      cnpj: cnpjSecretaria || null,
      ibgeCode: codigoIbgeSecretaria || null,
      userEmail: session?.user.email ?? null,
    });
    return renderTemplateSamplePreview({ content: conteudoModelo || "", context });
  }, [
    dialogModelo,
    conteudoModelo,
    selecionado?.nome,
    municipioSecretaria,
    ufSecretaria,
    cnpjSecretaria,
    codigoIbgeSecretaria,
    session?.user.email,
  ]);

  const previaModalResultado = useMemo(() => {
    if (!modeloPrevia) return null;
    const proc =
      previaModo === "real" && previaProcessoId
        ? processos.find((item) => item.id === previaProcessoId) ?? null
        : null;
    const cont =
      previaModo === "real" && previaContratoId
        ? contratos.find((item) => item.id === previaContratoId) ?? null
        : null;
    const fornId = cont?.supplier_id ?? (previaModo === "real" ? previaFornecedorId : "");
    const forn = fornId ? fornecedorPorId.get(fornId) ?? null : null;

    const context = buildSamplePreviewContext({
      tenantName: selecionado?.nome ?? null,
      municipality: municipioSecretaria || null,
      state: ufSecretaria || null,
      cnpj: cnpjSecretaria || null,
      ibgeCode: codigoIbgeSecretaria || null,
      userEmail: session?.user.email ?? null,
      ...(previaModo === "real"
        ? {
            overrideContext: {
              process: proc
                ? {
                    number: proc.number,
                    title: proc.title,
                    description: proc.description,
                    modality: proc.modality,
                    stage: proc.stage,
                    status: proc.status,
                    priority: proc.priority,
                    requestingUnit: proc.requesting_unit,
                    responsibleName: proc.responsible_name,
                    estimatedValue: proc.estimated_value,
                    dueDate: proc.due_date,
                  }
                : null,
              contract: cont
                ? {
                    number: cont.number,
                    object: cont.object,
                    modality: cont.modality,
                    totalValue: cont.total_value,
                    startDate: cont.start_date,
                    endDate: cont.end_date,
                    managerName: cont.manager_name,
                    inspectorName: cont.inspector_name,
                    ordinance: cont.ordinance,
                  }
                : null,
              supplier: forn
                ? {
                    legalName: forn.legal_name,
                    tradeName: forn.trade_name,
                    cnpj: forn.cnpj,
                    email: null,
                    phone: null,
                  }
                : null,
            },
          }
        : {}),
    });

    return renderTemplateSamplePreview({ content: modeloPrevia.content, context });
  }, [
    modeloPrevia,
    previaModo,
    previaProcessoId,
    previaContratoId,
    previaFornecedorId,
    processos,
    contratos,
    fornecedorPorId,
    selecionado?.nome,
    municipioSecretaria,
    ufSecretaria,
    cnpjSecretaria,
    codigoIbgeSecretaria,
    session?.user.email,
  ]);

  function abrirEdicaoGerado(documento: DocumentoGerado) {
    setDocumentoGeradoEditando(documento);
    setTituloEdicaoGerado(documento.title);
    setConteudoEdicaoGerado(documento.content_snapshot);
  }

  async function baixarRascunho(
    documento: DocumentoGerado,
    formato: "docx" | "pdf",
    retornarBytes = false,
  ): Promise<Uint8Array | null> {
    if (!selecionado || !["draft", "signed"].includes(documento.status) || baixandoRascunhoId)
      return null;
    setBaixandoRascunhoId(documento.id);
    try {
      if (documento.status === "signed") {
        if (
          formato !== "pdf" ||
          !documento.signed_pdf_storage_path ||
          !documento.signed_pdf_sha256
        ) {
          toast.error(
            "Este documento não possui PDF final imutável associado à assinatura. Não é possível apresentar uma cópia regenerada como arquivo assinado.",
          );
          return null;
        }
        const { data: signedPdf, error: downloadError } = await db.storage
          .from("gfs-private-documents")
          .download(documento.signed_pdf_storage_path);
        if (downloadError || !signedPdf)
          throw downloadError ?? new Error("PDF assinado indisponível.");
        const bytes = new Uint8Array(await signedPdf.arrayBuffer());
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const actualHash = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        if (actualHash !== documento.signed_pdf_sha256) {
          toast.error(
            "Falha na verificação de integridade: o SHA-256 do PDF não corresponde ao registro de assinatura. O download foi bloqueado.",
          );
          return null;
        }
        const url = URL.createObjectURL(signedPdf);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${documento.title.replace(/[^a-zA-Z0-9._-]+/gu, "-")}-assinado.pdf`;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        toast.success("Integridade do PDF assinado confirmada por SHA-256.");
        return null;
      }
      const { assertPdfCompatible, buildDocxFromText, docxToModel, generateDocx, renderPdf } =
        await import("@/lib/docx-engine");
      const { carregarTimbradoSecretaria } = await import("@/lib/document-branding");
      const branding = await carregarTimbradoSecretaria(selecionado.id, selecionado.nome);
      if (!branding.footerText.trim()) {
        branding.footerText =
          documento.status === "signed"
            ? "Documento assinado eletronicamente"
            : "Rascunho para revisão";
      }
      let template: ArrayBuffer | Uint8Array = await buildDocxFromText(
        documento.status === "signed"
          ? documento.content_snapshot +
              "\n\nASSINATURA ELETRÔNICA SIMPLES\n" +
              [
                documento.signed_name,
                documento.signed_email,
                documento.signed_at,
                documento.signature_statement,
                "Documento: " + documento.id,
              ]
                .filter(Boolean)
                .join("\n")
          : documento.content_snapshot,
        documento.title,
        documento.process_snapshot &&
          typeof documento.process_snapshot === "object" &&
          !Array.isArray(documento.process_snapshot) &&
          documento.process_snapshot["document_kind"] === "price_map"
          ? "landscape"
          : "portrait",
      );
      let values: Record<string, string> = {};
      let originalUsado = false;
      if (documento.template_id && documento.template_version) {
        const [{ data: source, error: sourceError }, { data: version, error: versionError }] =
          await Promise.all([
            db
              .from("document_template_sources")
              .select("storage_path")
              .eq("tenant_id", selecionado.id)
              .eq("template_id", documento.template_id)
              .eq("version", documento.template_version)
              .maybeSingle(),
            db
              .from("document_template_versions")
              .select("content")
              .eq("tenant_id", selecionado.id)
              .eq("template_id", documento.template_id)
              .eq("version", documento.template_version)
              .maybeSingle(),
          ]);
        if (versionError) throw versionError;
        if (sourceError && !isMissingDocumentTemplateSourcesTable(sourceError)) {
          throw sourceError;
        }
        if (!sourceError && source && version) {
          const snapshotValues = valuesForUneditedSource(
            version.content,
            documento.content_snapshot,
            documento.variables_snapshot,
          );
          if (snapshotValues) {
            const { data: original, error: downloadError } = await db.storage
              .from("gfs-private-documents")
              .download(source.storage_path);
            if (downloadError || !original)
              throw downloadError ?? new Error("Word original indisponível.");
            template = await original.arrayBuffer();
            values = snapshotValues;
            originalUsado = true;
          }
        }
      }
      const generated = await generateDocx({
        template,
        values,
        items: [],
        branding,
      });
      const bytes =
        formato === "docx"
          ? generated.bytes
          : await (async () => {
              assertPdfCompatible(generated.warnings);
              const preservarConfiguracaoOriginal = !generated.brandingApplied;
              const pdfBranding = preservarConfiguracaoOriginal
                ? {
                    ...branding,
                    headerTitle: "",
                    headerSubtitle: "",
                    logoBase64: null,
                    logoMime: null,
                    footerText: "",
                  }
                : branding;
              return renderPdf(await docxToModel(generated.bytes), {
                branding: pdfBranding,
                title: documento.title,
                useTemplatePageSetup: preservarConfiguracaoOriginal,
                useTemplatePageSize: true,
              });
            })();
      if (retornarBytes) return new Uint8Array(bytes);
      const mimeType =
        formato === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf";
      const fileName =
        documento.title
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/gu, "")
          .replace(/[^a-zA-Z0-9._-]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 80) || "documento";
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName}-${documento.status === "signed" ? "assinado" : "rascunho"}.${formato}`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      if (generated.pending.length) {
        toast.warning("O rascunho contém campos pendentes. Revise o arquivo antes de usá-lo.");
      }
      if (documento.template_id && !originalUsado) {
        toast.info(
          (formato === "docx" ? "Word" : "PDF") +
            " criado a partir do texto revisado; a formatação do DOCX original não está vinculada a este rascunho.",
        );
      }
      return null;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível exportar o documento.",
      );
      return null;
    } finally {
      setBaixandoRascunhoId(null);
    }
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
      ...(comment?.trim() ? { p_comment: comment.trim() } : {}),
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
    if (
      !selecionado ||
      !session?.user?.id ||
      !capacidades.can_sign ||
      fluxoPorDocumento.get(d.id)?.status !== "approved" ||
      d.status !== "draft" ||
      baixandoRascunhoId
    )
      return;
    const confirmou = window.confirm(
      "Confirma a assinatura eletrônica simples? O Primus vai gerar o PDF final com uma folha de identificação do assinante, arquivá-lo sem sobrescrita, conferir o arquivo no servidor e registrar o SHA-256 vinculado à sua conta. Esta assinatura não é qualificada ICP-Brasil.",
    );
    if (!confirmou) return;

    let storagePath: string | null = null;
    let uploaded = false;
    try {
      const pdfBytes = await baixarRascunho(d, "pdf", true);
      if (!pdfBytes) return;

      const [{ data: signerProfile }, { PDFDocument, StandardFonts, rgb }] = await Promise.all([
        db.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle(),
        import("pdf-lib"),
      ]);
      const signerName = signerProfile?.full_name?.trim() || "Usuário autenticado";
      const signerEmail = session.user.email ?? "Não informado";

      // Append an audit page without changing the source document's original
      // pages or template layout. The server hashes this complete final PDF.
      const finalPdf = await PDFDocument.load(pdfBytes);
      finalPdf.setTitle(d.title);
      finalPdf.setAuthor(signerName);
      finalPdf.setSubject("Registro de assinatura eletrônica simples");
      finalPdf.setCreator("Primus — Gestão de Documentos");
      const page = finalPdf.addPage([595.28, 841.89]);
      const regular = await finalPdf.embedFont(StandardFonts.Helvetica);
      const bold = await finalPdf.embedFont(StandardFonts.HelveticaBold);
      const ink = rgb(0.12, 0.17, 0.25);
      const muted = rgb(0.32, 0.38, 0.46);
      const left = 48;
      const contentWidth = 499;
      let y = 770;

      page.drawText("REGISTRO DE ASSINATURA ELETRÔNICA SIMPLES", {
        x: left,
        y,
        size: 13,
        font: bold,
        color: ink,
      });
      y -= 26;
      page.drawLine({
        start: { x: left, y },
        end: { x: left + contentWidth, y },
        thickness: 1,
        color: muted,
      });
      y -= 32;

      const paragraphs = [
        `Documento: ${d.title}`,
        `Identificador do documento: ${d.id}`,
        `Secretaria: ${selecionado.nome}`,
        `Assinante: ${signerName}`,
        `Conta autenticada: ${signerEmail}`,
        "Declaração: o usuário identificado acima confirmou a assinatura eletrônica simples deste documento no sistema.",
        "Integridade: o arquivo PDF completo, incluindo esta folha, é identificado por um hash SHA-256 calculado no servidor e vinculado ao registro imutável de assinatura.",
        "Data e hora oficiais, identificação da conta, hash do arquivo e histórico de aprovação ficam registrados na trilha de auditoria do sistema.",
        "Natureza da assinatura: modalidade eletrônica simples. Este registro não equivale a uma assinatura eletrônica qualificada ICP-Brasil nem representa, por si só, certificação digital.",
      ];

      for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/);
        let line = "";
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (regular.widthOfTextAtSize(candidate, 10) > contentWidth && line) {
            page.drawText(line, { x: left, y, size: 10, font: regular, color: ink });
            y -= 16;
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line) {
          page.drawText(line, { x: left, y, size: 10, font: regular, color: ink });
          y -= 16;
        }
        y -= 12;
      }

      page.drawLine({
        start: { x: left, y: 84 },
        end: { x: left + contentWidth, y: 84 },
        thickness: 0.5,
        color: muted,
      });
      page.drawText("Primus · Registro eletrônico e trilha de auditoria", {
        x: left,
        y: 64,
        size: 8,
        font: regular,
        color: muted,
      });

      const finalPdfBytes = await finalPdf.save();
      storagePath = `${selecionado.id}/generated-documents/${d.id}/${crypto.randomUUID()}.pdf`;
      const pdfBuffer = new ArrayBuffer(finalPdfBytes.byteLength);
      new Uint8Array(pdfBuffer).set(finalPdfBytes);
      const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });
      const { error: uploadError } = await db.storage
        .from("gfs-private-documents")
        .upload(storagePath, pdfBlob, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { data, error } = await db.functions.invoke("sign-generated-document", {
        body: {
          tenantId: selecionado.id,
          documentId: d.id,
          storagePath,
        },
      });
      if (error || !data?.success) {
        await db.storage.from("gfs-private-documents").remove([storagePath]);
        uploaded = false;
        throw new Error(
          error?.message ?? data?.error ?? "Não foi possível validar e registrar a assinatura.",
        );
      }

      uploaded = false;
      toast.success(`Assinatura registrada. SHA-256 do PDF: ${String(data.sha256).slice(0, 16)}…`);
      await carregar();
    } catch (error) {
      if (uploaded && storagePath) {
        await db.storage.from("gfs-private-documents").remove([storagePath]);
      }
      const { data: latestDocument } = await db
        .from("generated_documents")
        .select("status,signed_pdf_sha256")
        .eq("id", d.id)
        .eq("tenant_id", selecionado.id)
        .maybeSingle();
      if (latestDocument?.status === "signed" && latestDocument.signed_pdf_sha256) {
        toast.success("A assinatura foi concluída e o PDF final está arquivado.");
        await carregar();
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Não foi possível concluir a assinatura.",
      );
    }
  }
  async function cancelarGerado(d: DocumentoGerado) {
    if (!selecionado || d.status === "signed" || d.status === "cancelled") return;
    const confirmou = window.confirm(
      "Confirma o cancelamento deste documento? O conteúdo e o histórico de aprovação serão preservados.",
    );
    if (!confirmou) return;
    const { error } = await db.rpc("cancel_generated_document_workflow", {
      p_tenant_id: selecionado.id,
      p_document_id: d.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Documento cancelado e fluxo encerrado.");
    await carregar();
  }

  useEffect(() => {
    if (loading || !selecionado?.id || tenantCarregadoId !== selecionado.id) return;
    const url = new URL(window.location.href);
    const documentoId = url.searchParams.get("documento");
    if (!documentoId) return;
    const gerado = gerados.some((item) => item.id === documentoId);
    if (!gerado && !documentos.some((item) => item.id === documentoId)) {
      toast.error("O documento solicitado não está disponível nesta Secretaria.");
    } else {
      setAba(gerado ? "gerados" : "vencimentos");
      window.requestAnimationFrame(() => {
        document
          .getElementById(`${gerado ? "gerado" : "documento"}-${documentoId}`)
          ?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
      });
    }
    url.searchParams.delete("documento");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [loading, selecionado?.id, tenantCarregadoId, documentos, gerados]);

  if (!selecionado)
    return (
      <Alert>
        <AlertTitle>Selecione uma Secretaria</AlertTitle>
        <AlertDescription>
          Documentos, modelos e alertas pertencem à Secretaria selecionada.
        </AlertDescription>
      </Alert>
    );
  if (loading || tenantCarregadoId !== selecionado.id)
    return (
      <div className="flex h-40 items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span className="sr-only">Carregando documentos da Secretaria selecionada…</span>
      </div>
    );

  if (erro)
    return (
      <Alert variant="destructive">
        <AlertTitle>Erro ao carregar documentos</AlertTitle>
        <AlertDescription>{erro}</AlertDescription>
      </Alert>
    );

  if (!capacidades.can_view)
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
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="vencimentos">Vencimentos ({documentos.length})</TabsTrigger>
              {moduloModelosAtivo && (
                <TabsTrigger value="modelos">
                  Modelos ({modelosAtivosCount}
                  {modelos.length > modelosAtivosCount ? ` / ${modelos.length}` : ""})
                </TabsTrigger>
              )}
              <TabsTrigger value="gerados">Gerados ({gerados.length})</TabsTrigger>
              {moduloModelosAtivo && capacidades.can_manage_templates && (
                <TabsTrigger value="biblioteca">Biblioteca-base ({catalogo.length})</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="vencimentos" className="mt-4 space-y-3">
              {supplierFilter && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">
                    Documentos de {fornecedorPorId.get(supplierFilter)?.legal_name}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setSupplierFilter("")}>
                    Ver todos os fornecedores
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      aria-label="Pesquisar documentos e fornecedores"
                      placeholder="Buscar documento, fornecedor ou arquivo"
                      value={buscaVencimento}
                      onChange={(e) => setBuscaVencimento(e.target.value)}
                    />
                  </div>
                  <Select
                    value={situacaoVencimentoFiltro}
                    onValueChange={(value) =>
                      setSituacaoVencimentoFiltro(value as typeof situacaoVencimentoFiltro)
                    }
                  >
                    <SelectTrigger className="w-[185px]" aria-label="Filtrar por situação">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas as situações</SelectItem>
                      <SelectItem value="vencidos">Vencidos ({vencidos})</SelectItem>
                      <SelectItem value="30dias">Vencem em até 30d ({proximos})</SelectItem>
                      <SelectItem value="em_dia">Em dia</SelectItem>
                      <SelectItem value="sem_vencimento">Sem vencimento</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={tipoVencimentoFiltro} onValueChange={setTipoVencimentoFiltro}>
                    <SelectTrigger className="w-[180px]" aria-label="Filtrar por tipo documental">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os tipos</SelectItem>
                      {TIPOS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ReportExportActions
                  title="Documentos e Controle de Vencimentos"
                  filename={`documentos-vencimentos-${new Date().toISOString().slice(0, 10)}`}
                  columns={colunasVencimentos}
                  rows={visibleDocuments}
                />
              </div>
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
                      {visibleDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-muted-foreground">
                            Nenhum documento de fornecedor registrado.
                          </td>
                        </tr>
                      ) : (
                        visibleDocuments.map((d) => {
                          const f = fornecedorPorId.get(d.supplier_id);
                          const status = situacaoVencimento(d.expires_at);
                          const safeExternalUrl = d.external_url
                            ? normalizeExternalDocumentUrl(d.external_url)
                            : null;
                          return (
                            <tr key={d.id} id={`documento-${d.id}`} className="border-t">
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
                                  {capacidades.can_create &&
                                    (status.label === "Vencido" || status.variant === "secondary") && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          iniciarGeracao("", d.supplier_id);
                                          const notifModel = modelos.find(
                                            (mod) =>
                                              mod.is_active && mod.template_type === "notificacao",
                                          );
                                          if (notifModel) {
                                            setModeloSelecionado(notifModel.id);
                                            setTituloGerado(
                                              `Notificação de vencimento — ${d.title}`.slice(0, 180),
                                            );
                                            setConteudoGerado(notifModel.content);
                                          } else {
                                            setTituloGerado(
                                              `Solicitação de renovação — ${d.title}`.slice(0, 180),
                                            );
                                            setConteudoGerado(
                                              `Prezado fornecedor {{fornecedor}} (CNPJ {{cnpj}}),\n\nSolicitamos o envio atualizado do documento "${d.title}" (${TIPOS.find(([v]) => v === d.document_type)?.[1] ?? d.document_type}), com vencimento registrado em ${dataLocal(d.expires_at)}, visando manter a regularidade fiscal e cadastral junto à {{secretaria}}.\n\nAtenciosamente,\n{{usuario}}\n{{secretaria}}`,
                                            );
                                          }
                                        }}
                                        title="Gerar notificação de renovação para este fornecedor"
                                      >
                                        <Sparkles className="h-3.5 w-3.5" /> Cobrar renovação
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
              <TabsContent value="modelos" className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      aria-label="Pesquisar modelos de documentos"
                      placeholder="Buscar por nome, descrição ou base normativa"
                      value={buscaModelo}
                      onChange={(e) => setBuscaModelo(e.target.value)}
                    />
                  </div>
                  <Select value={categoriaModeloFiltro} onValueChange={setCategoriaModeloFiltro}>
                    <SelectTrigger className="w-[190px]" aria-label="Filtrar por categoria">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas as categorias</SelectItem>
                      {TEMPLATE_CATEGORY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={escopoModeloFiltro}
                    onValueChange={(value) =>
                      setEscopoModeloFiltro(value as TemplateAvailabilityScope | "todos")
                    }
                  >
                    <SelectTrigger className="w-[205px]" aria-label="Filtrar por onde usar">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os fluxos de uso</SelectItem>
                      {TEMPLATE_AVAILABILITY_SCOPES.map((scope) => (
                        <SelectItem key={scope.id} value={scope.id}>
                          {scope.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={statusModeloFiltro}
                    onValueChange={(value) =>
                      setStatusModeloFiltro(value as "active" | "inactive" | "all")
                    }
                  >
                    <SelectTrigger className="w-[140px]" aria-label="Filtrar por status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Somente ativos</SelectItem>
                      <SelectItem value="inactive">Inativos</SelectItem>
                      <SelectItem value="all">Todos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {modelosFiltradosNaAba.map((m) => {
                    const docsCount = geradosPorModeloCount.get(m.id) ?? 0;
                    const placeholders = extractTemplatePlaceholders(m.content);
                    const etapasResumo = sanitizeProcessStages(m.process_stages);
                    return (
                      <Card key={m.id} className={!m.is_active ? "opacity-75" : undefined}>
                        <CardHeader className="pb-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <CardTitle className="text-base">{m.title}</CardTitle>
                              {m.description && (
                                <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                              )}
                            </div>
                            <Badge variant={m.is_active ? "secondary" : "outline"}>
                              {m.is_active ? "Ativo" : "Inativo"}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="line-clamp-4 whitespace-pre-wrap rounded bg-muted/30 p-2.5 text-sm text-muted-foreground">
                            {m.content}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline">Versão {m.version}</Badge>
                            <Badge variant="outline">
                              {ROTULOS_CATEGORIA_MODELO[m.template_type] ?? m.template_type}
                            </Badge>
                            {m.legal_basis && <span className="truncate">{m.legal_basis}</span>}
                          </div>
                          <div className="mt-2.5 space-y-1 text-xs">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-medium text-foreground">
                                Disponível em:
                              </span>
                              {m.scopesResolved.map((scope) => (
                                <Badge key={scope} variant="outline" className="text-[11px]">
                                  {ROTULOS_ESCOPO_MODELO[scope] ?? scope}
                                </Badge>
                              ))}
                            </div>
                            {m.scopesResolved.includes("processos") && etapasResumo.length > 0 && (
                              <p className="text-muted-foreground">
                                <strong>Etapas do processo:</strong>{" "}
                                {etapasResumo.map((e) => ROTULOS_ETAPA_MODELO[e] ?? e).join(" · ")}
                              </p>
                            )}
                            <p className="text-muted-foreground">
                              Campos: {placeholders.automatic.length} automático(s) ·{" "}
                              {placeholders.manualOrCustom.length} complementar(es)
                              {docsCount > 0 ? ` · ${docsCount} documento(s) gerado(s)` : ""}
                            </p>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {capacidades.can_create && m.is_active && (
                              <Button size="sm" onClick={() => usarModeloNoGerador(m)}>
                                <FilePlus2 className="h-4 w-4" /> Usar modelo
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirPreviaModelo(m)}
                            >
                              <Eye className="h-4 w-4" /> Prévia
                            </Button>
                            {capacidades.can_manage_templates && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void iniciarEdicaoModelo(m)}
                              >
                                <Pencil className="h-4 w-4" /> Editar
                              </Button>
                            )}
                            {capacidades.can_manage_templates && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => duplicarModelo(m)}
                                title="Criar uma cópia editável deste modelo"
                              >
                                <Copy className="h-4 w-4" /> Duplicar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void abrirHistoricoModelo(m)}
                            >
                              <History className="h-4 w-4" /> Histórico
                            </Button>
                            {capacidades.can_manage_templates && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={processandoToggleModeloId === m.id}
                                onClick={() => void alternarAtivoModelo(m, !m.is_active)}
                              >
                                {m.is_active ? (
                                  <>
                                    <Archive className="h-4 w-4" /> Inativar
                                  </>
                                ) : (
                                  <>
                                    <RotateCcw className="h-4 w-4" /> Reativar
                                  </>
                                )}
                              </Button>
                            )}
                            {capacidades.can_manage_templates && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setModeloExcluindo(m)}
                              >
                                <Trash2 className="h-4 w-4" /> Excluir
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {modelosFiltradosNaAba.length === 0 && (
                    <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground md:col-span-2">
                      {modelos.length === 0
                        ? "Nenhum modelo cadastrado. Use “Novo modelo” para importar ou colar um texto-base."
                        : "Nenhum modelo encontrado para os filtros atuais."}
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
            <TabsContent value="gerados" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    aria-label="Pesquisar documentos gerados"
                    placeholder="Buscar título, processo, contrato ou fornecedor"
                    value={buscaGerado}
                    onChange={(e) => setBuscaGerado(e.target.value)}
                  />
                </div>
                <Select value={statusGeradoFiltro} onValueChange={setStatusGeradoFiltro}>
                  <SelectTrigger className="w-[210px]" aria-label="Filtrar situação do fluxo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas as situações</SelectItem>
                    <SelectItem value="draft">Em elaboração</SelectItem>
                    <SelectItem value="pending_approval">Aguardando aprovação</SelectItem>
                    <SelectItem value="approved">Aprovado (pronto p/ assinatura)</SelectItem>
                    <SelectItem value="rejected">Devolvido para correção</SelectItem>
                    <SelectItem value="signed">Assinado</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                      {geradosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-10 text-center text-muted-foreground">
                            {gerados.length === 0
                              ? "Nenhum documento gerado."
                              : "Nenhum documento corresponde aos filtros aplicados."}
                          </td>
                        </tr>
                      ) : (
                        geradosFiltrados.map((d) => {
                          const camposPendentes = extractPendingDocumentFields(d.content_snapshot);
                          return (
                            <tr key={d.id} id={`gerado-${d.id}`} className="border-t">
                              <td className="p-3">
                                <p className="font-medium">{d.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {d.process_id
                                    ? "Processo de contratação vinculado"
                                    : (fornecedorPorId.get(d.supplier_id ?? "")?.legal_name ??
                                      "Sem fornecedor vinculado")}
                                </p>
                                {camposPendentes.length > 0 && (
                                  <p className="mt-1 text-xs text-destructive">
                                    Campos pendentes: {camposPendentes.join(", ")}
                                  </p>
                                )}
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
                                <div className="space-y-1">
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
                                  {d.status === "signed" && d.signed_pdf_sha256 && (
                                    <p className="max-w-52 break-all text-[10px] text-muted-foreground">
                                      SHA-256: {d.signed_pdf_sha256}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap justify-end gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setDocumentoVisualizando(d)}
                                    aria-label={`Visualizar ${d.title}`}
                                    title="Visualização rápida do documento"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setDocumentoImpressao(d)}
                                    aria-label="Visualizar e imprimir"
                                  >
                                    <Printer className="h-4 w-4" />
                                  </Button>
                                  {d.status === "draft" && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={baixandoRascunhoId !== null}
                                        onClick={() => void baixarRascunho(d, "docx")}
                                      >
                                        <Download className="h-4 w-4" aria-hidden />
                                        Word (rascunho)
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={baixandoRascunhoId !== null}
                                        onClick={() => void baixarRascunho(d, "pdf")}
                                      >
                                        PDF (rascunho)
                                      </Button>
                                    </>
                                  )}
                                  {d.status === "signed" && d.signed_pdf_storage_path && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={baixandoRascunhoId !== null}
                                      onClick={() => void baixarRascunho(d, "pdf")}
                                    >
                                      <ShieldCheck className="h-4 w-4" aria-hidden />
                                      PDF assinado · verificar SHA-256
                                    </Button>
                                  )}
                                  {d.status === "signed" && !d.signed_pdf_storage_path && (
                                    <Badge variant="destructive">
                                      Assinatura legada sem PDF imutável
                                    </Badge>
                                  )}
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
                                              disabled={camposPendentes.length > 0}
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
                          );
                        })
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
                <SupplierSelect
                  suppliers={fornecedores}
                  value={fornecedorId}
                  onValueChange={setFornecedorId}
                  disabled={!!documentoEditando}
                />
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
          if (!open) {
            setModeloEditando(null);
            setArquivoOriginalModelo(null);
            setAvisosModeloDocx([]);
            setCarregandoOriginalModelo(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {modeloEditando ? "Editar modelo de documento" : "Novo modelo de documento"}
            </DialogTitle>
            <DialogDescription>
              {modeloEditando
                ? "Configure onde o modelo fica disponível e edite o conteúdo. Alterações de texto criam uma nova versão preservando o histórico."
                : "Configure o texto, os campos automáticos e onde este modelo ficará disponível nos fluxos da Secretaria."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salvarModelo} className="space-y-4">
            <Tabs
              value={abaEditorModelo}
              onValueChange={(value) => setAbaEditorModelo(value as "edicao" | "previa")}
            >
              <TabsList>
                <TabsTrigger value="edicao">Configuração e Texto</TabsTrigger>
                <TabsTrigger value="previa">
                  <Eye className="mr-1.5 h-4 w-4" /> Prévia em tempo real
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edicao" className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
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
                    <Select
                      value={tipoModelo}
                      onValueChange={(value) => {
                        setTipoModelo(value);
                        if (!modeloEditando) {
                          const suggested = defaultTemplateScopeConfig(value);
                          setEscoposModelo(suggested.availability_scopes);
                          setEtapasModelo(suggested.process_stages);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_CATEGORY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Input
                      maxLength={1000}
                      value={descricaoModelo}
                      onChange={(e) => setDescricaoModelo(e.target.value)}
                      placeholder="Finalidade e orientações breves de preenchimento"
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" aria-hidden />
                      <Label className="text-sm font-semibold">
                        Onde este modelo fica disponível para uso *
                      </Label>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={modeloAtivo}
                        onChange={(event) => setModeloAtivo(event.target.checked)}
                      />
                      Modelo ativo e liberado para geração
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TEMPLATE_AVAILABILITY_SCOPES.map((scope) => {
                      const marcado = escoposModelo.includes(scope.id);
                      return (
                        <label
                          key={scope.id}
                          className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-xs ${
                            marcado ? "border-primary/50 bg-background" : "bg-background/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={marcado}
                            onChange={() => alternarEscopoModelo(scope.id)}
                          />
                          <span>
                            <strong className="block text-foreground">{scope.label}</strong>
                            <span className="text-muted-foreground">{scope.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {escoposModelo.includes("processos") && (
                    <div className="space-y-2 border-t pt-3">
                      <Label className="text-xs font-semibold">
                        Etapas do Fluxo de Processo onde é recomendado (opcional)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Quando selecionadas, o sistema destaca este modelo automaticamente dentro dos
                        processos que estiverem nessas etapas.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {ETAPAS.map((etapa) => {
                          const selecionada = etapasModelo.includes(etapa.id);
                          return (
                            <Button
                              key={etapa.id}
                              type="button"
                              size="sm"
                              variant={selecionada ? "default" : "outline"}
                              aria-pressed={selecionada}
                              className="h-7 text-xs"
                              onClick={() => alternarEtapaModelo(etapa.id)}
                            >
                              {etapa.nome}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Base normativa ou fundamento</Label>
                    <Input
                      maxLength={2000}
                      value={baseLegalModelo}
                      onChange={(e) => setBaseLegalModelo(e.target.value)}
                      placeholder="Ex.: Lei nº 14.133/2021, art. 18"
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
                      placeholder="Ex.: Adequação ao regulamento municipal e inclusão de fluxo de processo."
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
                    No DOCX, o texto fica editável e o Word original fica vinculado a esta versão.
                    <br />
                    Alterar o texto abaixo descarta o vínculo com o arquivo importado; importe
                    novamente para preservar sua formatação. Também é possível copiar e colar texto.
                  </p>
                  {arquivoOriginalModelo && (
                    <p className="text-xs text-primary">Word original: {arquivoOriginalModelo.name}</p>
                  )}
                  {avisosModeloDocx.length > 0 && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>O modelo contém recursos que exigem atenção</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {avisosModeloDocx.map((warning) => (
                            <li key={warning.code}>{warning.message}</li>
                          ))}
                        </ul>
                        O Word original mantém esses recursos. A exportação PDF será bloqueada quando
                        eles puderem causar perda de conteúdo ou paginação incorreta.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Texto do modelo *</Label>
                  {carregandoOriginalModelo && (
                    <p className="text-xs text-muted-foreground">
                      Carregando o Word original da versão para preservar o arquivo na próxima
                      gravação...
                    </p>
                  )}
                  {arquivoOriginalModelo && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Word original vinculado</AlertTitle>
                      <AlertDescription>
                        O arquivo original será preservado se o texto permanecer sem alterações. Esta
                        caixa é um editor textual; ao editar o texto ou inserir campos, o vínculo com
                        o Word será removido. Para manter estilos e tabelas, ajuste o arquivo no Word
                        e importe novamente.
                      </AlertDescription>
                    </Alert>
                  )}
                  <Textarea
                    ref={conteudoModeloRef}
                    required
                    disabled={carregandoOriginalModelo}
                    rows={12}
                    maxLength={50000}
                    value={conteudoModelo}
                    onChange={(e) => {
                      if (arquivoOriginalModelo) {
                        toast.warning(
                          "A edição textual desvinculou o Word original; esta versão será gerada a partir do texto.",
                        );
                      }
                      setConteudoModelo(e.target.value);
                      setArquivoOriginalModelo(null);
                      setAvisosModeloDocx([]);
                    }}
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
                          {"{{" + variable.key + "}}"}
                          <span className="ml-2 truncate font-sans text-muted-foreground">
                            {variable.label}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </details>
                </div>
              </TabsContent>

              <TabsContent value="previa" className="mt-4 space-y-3">
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Esta prévia simula como o documento ficará ao ser gerado com os dados cadastrais da
                  Secretaria ({selecionado?.nome}) e um contexto ilustrativo de processo, contrato e
                  fornecedor.
                </div>
                {conteudoModelo.trim() ? (
                  <div className="max-h-[55vh] overflow-y-auto rounded-lg border bg-white p-6 text-sm leading-6 text-slate-900 shadow-inner dark:bg-slate-950 dark:text-slate-100">
                    <p className="mb-4 text-center text-xs uppercase tracking-wider text-muted-foreground">
                      {selecionado?.nome}
                    </p>
                    <h3 className="mb-4 text-center text-base font-bold">
                      {tituloModelo.trim() || "Título do modelo"}
                    </h3>
                    <div className="whitespace-pre-wrap font-serif">
                      {previaEditorResultado?.content ?? conteudoModelo}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Digite ou importe um texto na aba “Configuração e Texto” para visualizar a prévia.
                  </p>
                )}
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogModelo(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvandoModelo || carregandoOriginalModelo}>
                {salvandoModelo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}{" "}
                {modeloEditando ? "Salvar alterações" : "Salvar modelo"}
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
            {dialogGerar && selecionado && processoGeracao && (
              <AnnualDemandSource tenantId={selecionado.id} processId={processoGeracao} />
            )}
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
              <div className="space-y-2 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>
                    Modelo ({ROTULOS_ESCOPO_MODELO[escopoGerador] ?? escopoGerador})
                  </Label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={mostrarTodosModelosGerador}
                      onChange={(e) => setMostrarTodosModelosGerador(e.target.checked)}
                    />
                    Exibir modelos de outros fluxos
                  </label>
                </div>
                <Select value={modeloSelecionado} onValueChange={selecionarModelo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um modelo ativo" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelosDisponiveisGerador.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                        {m.recommendedForStage ? " · Recomendado para a etapa" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!processoGeracao && (
                <div className="space-y-2">
                  <Label>Fornecedor</Label>
                  <SupplierSelect
                    suppliers={fornecedores}
                    emptyOption={{ value: "nenhum", label: "Sem fornecedor" }}
                    value={fornecedorGeracao}
                    onValueChange={setFornecedorGeracao}
                    disabled={!!contratoGeracao}
                  />
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
              {(processoGeracao || contratoGeracao) && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Dados complementares do documento</Label>
                  <p className="text-xs text-muted-foreground">
                    Os campos com origem nos dados do processo serão preenchidos automaticamente.
                    Complete apenas os campos técnicos e administrativos abaixo; dados ausentes no
                    cadastro ficam identificados no rascunho para conferência.
                  </p>
                  {camposDoModelo.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Não há campos complementares pendentes para este modelo.
                    </p>
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
                  <p className="text-xs text-muted-foreground">
                    Prévia orientativa: os valores definitivos de processos e contratos são
                    calculados no servidor. Revise o rascunho gerado; campos ainda pendentes
                    aparecem na lista e impedem o envio para aprovação.
                  </p>
                  {(previaGeracao.missingKeys.length > 0 ||
                    previaGeracao.unknownKeys.length > 0) && (
                    <Alert className="border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Campos que precisam de conferência</AlertTitle>
                      <AlertDescription>
                        {previaGeracao.missingKeys.length > 0 && (
                          <p>Dados não encontrados: {previaGeracao.missingKeys.join(", ")}.</p>
                        )}
                        {previaGeracao.unknownKeys.length > 0 && (
                          <p>Campos sem configuração: {previaGeracao.unknownKeys.join(", ")}.</p>
                        )}
                        O rascunho manterá marcadores visíveis para impedir que dados ausentes
                        pareçam preenchidos.
                      </AlertDescription>
                    </Alert>
                  )}
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Pré-visualizar o conteúdo preenchido
                    </summary>
                    <div className="mt-3 space-y-3">
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
                  (processoGeracao || contratoGeracao
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

      <Dialog
        open={!!modeloPrevia}
        onOpenChange={(open) => {
          if (!open) setModeloPrevia(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Prévia do modelo — {modeloPrevia?.title}</DialogTitle>
            <DialogDescription>
              Visualize o layout preenchido e confira quais variáveis serão preenchidas
              automaticamente com dados reais ou com a massa de demonstração.
            </DialogDescription>
          </DialogHeader>
          {modeloPrevia && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Modo de preenchimento da prévia</Label>
                  <Select
                    value={previaModo}
                    onValueChange={(value) => setPreviaModo(value as "exemplo" | "real")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exemplo">Dados de demonstração da Secretaria</SelectItem>
                      <SelectItem value="real">Simular com dados reais cadastrados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {previaModo === "real" && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">Processo (opcional)</Label>
                      <Select
                        value={previaProcessoId || "nenhum"}
                        onValueChange={(v) => setPreviaProcessoId(v === "nenhum" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nenhum">Nenhum processo</SelectItem>
                          {processos.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.number} — {p.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Contrato (opcional)</Label>
                      <Select
                        value={previaContratoId || "nenhum"}
                        onValueChange={(v) => setPreviaContratoId(v === "nenhum" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nenhum">Nenhum contrato</SelectItem>
                          {contratos.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.number} — {c.object}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Fornecedor (opcional)</Label>
                      <Select
                        value={previaFornecedorId || "nenhum"}
                        onValueChange={(v) => setPreviaFornecedorId(v === "nenhum" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nenhum">Nenhum fornecedor</SelectItem>
                          {fornecedores.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.trade_name || f.legal_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>

              <div className="max-h-[52vh] overflow-y-auto rounded-lg border bg-white p-6 text-sm leading-6 text-slate-900 shadow-inner dark:bg-slate-950 dark:text-slate-100">
                <p className="mb-4 text-center text-xs uppercase tracking-wider text-muted-foreground">
                  {selecionado.nome}
                </p>
                <h3 className="mb-4 text-center text-base font-bold">{modeloPrevia.title}</h3>
                <div className="whitespace-pre-wrap font-serif">
                  {previaModalResultado?.content ?? modeloPrevia.content}
                </div>
              </div>

              {previaModalResultado &&
                (previaModalResultado.missingKeys.length > 0 ||
                  previaModalResultado.unknownKeys.length > 0) && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Campos complementares ou sem correspondência automática</AlertTitle>
                    <AlertDescription className="text-xs">
                      {[...previaModalResultado.missingKeys, ...previaModalResultado.unknownKeys].join(
                        ", ",
                      )}{" "}
                      — serão solicitados ou preenchidos durante a geração do documento.
                    </AlertDescription>
                  </Alert>
                )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeloPrevia(null)}>
              Fechar
            </Button>
            {modeloPrevia && capacidades.can_create && modeloPrevia.is_active && (
              <Button onClick={() => usarModeloNoGerador(modeloPrevia)}>
                <FilePlus2 className="h-4 w-4" /> Usar este modelo
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!modeloExcluindo}
        onOpenChange={(open) => {
          if (!processandoExclusaoModelo && !open) setModeloExcluindo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir modelo de documento</DialogTitle>
            <DialogDescription>
              {modeloExcluindo?.title} (v{modeloExcluindo?.version})
            </DialogDescription>
          </DialogHeader>
          {modeloExcluindo && (geradosPorModeloCount.get(modeloExcluindo.id) ?? 0) > 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Exclusão definitiva bloqueada por rastreabilidade</AlertTitle>
              <AlertDescription className="text-sm">
                Este modelo possui{" "}
                <strong>{geradosPorModeloCount.get(modeloExcluindo.id)}</strong> documento(s)
                gerado(s) vinculado(s). Para não perder o vínculo histórico exigido por auditorias,
                você pode <strong>Inativar</strong> o modelo para removê-lo da lista ativa.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este modelo ainda não possui documentos gerados vinculados. A exclusão removerá o
              modelo e todo o seu histórico de versões permanentemente desta Secretaria.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={processandoExclusaoModelo}
              onClick={() => setModeloExcluindo(null)}
            >
              Cancelar
            </Button>
            {modeloExcluindo && (geradosPorModeloCount.get(modeloExcluindo.id) ?? 0) > 0 ? (
              <Button
                variant="secondary"
                disabled={processandoToggleModeloId === modeloExcluindo.id}
                onClick={async () => {
                  const target = modeloExcluindo;
                  setModeloExcluindo(null);
                  await alternarAtivoModelo(target, false);
                }}
              >
                <Archive className="h-4 w-4" /> Inativar modelo
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={processandoExclusaoModelo}
                onClick={() => void confirmarExcluirModelo()}
              >
                {processandoExclusaoModelo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Excluir definitivamente
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentViewerSheet
        documento={documentoVisualizando}
        aberto={documentoVisualizando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setDocumentoVisualizando(null);
        }}
        onImprimir={(doc) => setDocumentoImpressao(doc)}
        onBaixarDocx={(doc) => void baixarRascunho(doc, "docx")}
        onBaixarPdf={(doc) => void baixarRascunho(doc, "pdf")}
        baixando={baixandoRascunhoId !== null}
      />

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
                {documentoImpressao.signed_pdf_sha256 && (
                  <>
                    <p>Arquivo final arquivado e conferível por SHA-256.</p>
                    <p className="break-all text-xs">
                      SHA-256: {documentoImpressao.signed_pdf_sha256}
                    </p>
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  Assinatura eletrônica simples. Não equivale à assinatura qualificada ICP-Brasil.
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
