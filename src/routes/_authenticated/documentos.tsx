import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { db } from "@/lib/db";
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

export const Route = createFileRoute("/_authenticated/documentos")({
  head: () => ({ meta: [{ title: "Documentos e vencimentos — Gestão de Fornecedores da Saúde" }] }),
  component: Documentos,
});

type Fornecedor = Pick<Tables<"suppliers">, "id" | "legal_name" | "trade_name" | "cnpj">;
type DocumentoFornecedor = Tables<"supplier_documents">;
type Modelo = Tables<"document_templates">;
type ModeloCatalogo = Tables<"document_template_catalog">;
type VersaoModelo = Tables<"document_template_versions">;
type ProcessoContratacao = Pick<
  Tables<"procurement_processes">,
  "id" | "number" | "title" | "stage" | "status" | "requesting_unit" | "responsible_name"
>;
type CampoComplementar = { key: string; label: string; required?: boolean; source?: string };
type DocumentoGerado = Tables<"generated_documents">;

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

async function validarArquivoPrivado(
  file: File,
): Promise<{ mimeType: string; extension: string }> {
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
    (extension === "png" &&
      startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
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
    return { label: dias === 0 ? "Vence hoje" : `Vence em ${dias} dia(s)`, variant: "secondary" };
  return { label: "Em dia", variant: "outline" };
}

async function carregarTodasAsPaginas<T>(
  consultar: (
    inicio: number,
    fim: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const registros: T[] = [];
  const tamanhoPagina = 500;

  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await consultar(inicio, inicio + tamanhoPagina - 1);
    if (error) throw error;
    const pagina = data ?? [];
    registros.push(...pagina);
    if (pagina.length < tamanhoPagina) return registros;
  }
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
  const [documentos, setDocumentos] = useState<DocumentoFornecedor[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [catalogo, setCatalogo] = useState<ModeloCatalogo[]>([]);
  const [processos, setProcessos] = useState<ProcessoContratacao[]>([]);
  const [gerados, setGerados] = useState<DocumentoGerado[]>([]);
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
  const [resumoModelo, setResumoModelo] = useState("");
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  const [dialogHistoricoModelo, setDialogHistoricoModelo] = useState(false);
  const [modeloHistorico, setModeloHistorico] = useState<Modelo | null>(null);
  const [versoesModelo, setVersoesModelo] = useState<VersaoModelo[]>([]);
  const [carregandoVersoes, setCarregandoVersoes] = useState(false);

  const [dialogGerar, setDialogGerar] = useState(false);
  const [modeloSelecionado, setModeloSelecionado] = useState("");
  const [processoGeracao, setProcessoGeracao] = useState("");
  const [camposComplementares, setCamposComplementares] = useState<Record<string, string>>({});
  const [instalandoModelo, setInstalandoModelo] = useState<string | null>(null);
  const [fornecedorGeracao, setFornecedorGeracao] = useState("nenhum");
  const [tituloGerado, setTituloGerado] = useState("");
  const [conteudoGerado, setConteudoGerado] = useState("");
  const [salvandoGerado, setSalvandoGerado] = useState(false);
  const [documentoImpressao, setDocumentoImpressao] = useState<DocumentoGerado | null>(null);

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
      setGerados([]);
      setMunicipioSecretaria("");
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
      ] = await Promise.all([
        db.rpc("get_document_capabilities", { p_tenant_id: selecionado.id }),
        carregarTodasAsPaginas<Fornecedor>((inicio, fim) =>
          db
            .from("suppliers")
            .select("id,legal_name,trade_name,cnpj")
            .eq("tenant_id", selecionado.id)
            .order("legal_name")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<DocumentoFornecedor>((inicio, fim) =>
          db
            .from("supplier_documents")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .eq("status", "active")
            .order("expires_at", { ascending: true, nullsFirst: false })
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<Modelo>((inicio, fim) =>
          db
            .from("document_templates")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .eq("is_active", true)
            .order("title")
            .range(inicio, fim),
        ),
        carregarTodasAsPaginas<DocumentoGerado>((inicio, fim) =>
          db
            .from("generated_documents")
            .select("*")
            .eq("tenant_id", selecionado.id)
            .order("created_at", { ascending: false })
            .range(inicio, fim),
        ),
        db.from("tenants").select("municipality").eq("id", selecionado.id).maybeSingle(),
        carregarTodasAsPaginas<ModeloCatalogo>((inicio, fim) =>
          db
            .from("document_template_catalog")
            .select("*")
            .eq("is_active", true)
            .order("template_type")
            .range(inicio, fim),
        ),
        selecionado.enabled_modules["processos"] === true
          ? carregarTodasAsPaginas<ProcessoContratacao>((inicio, fim) =>
              db
                .from("procurement_processes")
                .select("id,number,title,stage,status,requesting_unit,responsible_name")
                .eq("tenant_id", selecionado.id)
                .neq("status", "arquivado")
                .order("created_at", { ascending: false })
                .range(inicio, fim),
            )
          : Promise.resolve([] as ProcessoContratacao[]),
      ]);
      for (const result of [cap, tenantData]) if (result.error) throw result.error;
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
      setGerados(generated);
      setMunicipioSecretaria(tenantData.data?.municipality ?? "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setDocumentos([]);
      setModelos([]);
      setCatalogo([]);
      setProcessos([]);
      setGerados([]);
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
  function extrairDriveFileId(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!["drive.google.com", "docs.google.com"].includes(parsed.hostname)) return null;
      const match = parsed.pathname.match(/\/d\/([^/]+)/);
      return match?.[1] ?? parsed.searchParams.get("id");
    } catch {
      return null;
    }
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
    if (!/\.(txt|md)$/i.test(file.name)) {
      toast.error(
        "Importe um modelo em arquivo .txt ou .md. Arquivos Word precisam ser copiados para o campo de texto.",
      );
      return;
    }
    if (file.size > 50000) {
      toast.error("O modelo ultrapassa o limite de 50 KB.");
      return;
    }
    try {
      const text = await file.text();
      setConteudoModelo(text);
      if (!tituloModelo.trim())
        setTituloModelo(file.name.replace(/\.(txt|md)$/i, "").slice(0, 180));
      toast.success("Texto do modelo importado.");
    } catch {
      toast.error("Não foi possível ler o arquivo. Copie e cole o conteúdo no campo de texto.");
    }
  }

  async function salvarDocumento(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || !fornecedorId) return;
    if (emissao && vencimento && vencimento < emissao) {
      toast.error("A data de vencimento não pode ser anterior à emissão.");
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
              external_url: linkDocumento.trim() || null,
              storage_provider: extrairDriveFileId(linkDocumento.trim())
                ? "google_drive"
                : "external_link",
              drive_file_id: extrairDriveFileId(linkDocumento.trim()),
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
      const externalUrl = linkDocumento.trim();
      const { error: insertError } = await db.from("supplier_documents").insert({
        tenant_id: selecionado.id,
        supplier_id: fornecedorId,
        ...metadata,
        external_url: externalUrl || null,
        storage_provider: extrairDriveFileId(externalUrl) ? "google_drive" : "external_link",
        drive_file_id: extrairDriveFileId(externalUrl),
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
    setResumoModelo("");
    setDialogModelo(true);
  }

  function iniciarEdicaoModelo(modelo: Modelo) {
    setModeloEditando(modelo);
    setTituloModelo(modelo.title);
    setDescricaoModelo(modelo.description ?? "");
    setConteudoModelo(modelo.content);
    setResumoModelo("");
    setDialogModelo(true);
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

  async function salvarModelo(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setSalvandoModelo(true);
    const payload = {
      title: tituloModelo.trim(),
      description: descricaoModelo.trim() || null,
      content: conteudoModelo.trim(),
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
    setResumoModelo("");
    await carregar();
  }

  function iniciarGeracao() {
    setModeloSelecionado("");
    setProcessoGeracao("");
    setCamposComplementares({});
    setFornecedorGeracao("nenhum");
    setTituloGerado("");
    setConteudoGerado("");
    setDialogGerar(true);
  }
  function selecionarModelo(id: string) {
    setModeloSelecionado(id);
    setCamposComplementares({});
    const modelo = modelos.find((m) => m.id === id);
    if (modelo) {
      setTituloGerado(modelo.title);
      setConteudoGerado(modelo.content);
    }
  }
  function preencherModelo(): string {
    const f = fornecedores.find((item) => item.id === fornecedorGeracao);
    const values: Record<string, string> = {
      fornecedor: f?.legal_name ?? "[NOME DO FORNECEDOR]",
      nome_fantasia: f?.trade_name ?? "",
      cnpj: f?.cnpj ?? "",
      secretaria: selecionado?.nome ?? "",
      municipio: municipioSecretaria,
      data: new Intl.DateTimeFormat("pt-BR").format(new Date()),
      usuario: session?.user.email ?? "",
    };
    return conteudoGerado.replace(
      /\{\{\s*(fornecedor|nome_fantasia|cnpj|secretaria|municipio|data|usuario)\s*\}\}/gi,
      (match, key: string) => values[key.toLowerCase()] ?? match,
    );
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
      const { error: rpcError } = await db.rpc("generate_document_from_process", {
        p_process_id: processoGeracao,
        p_template_id: modeloSelecionado,
        p_overrides: camposComplementares as Json,
      });
      setSalvandoGerado(false);
      if (rpcError) {
        toast.error(rpcError.message);
        return;
      }
      toast.success("Documento vinculado ao processo e salvo como rascunho.");
    } else {
      const snapshot = preencherModelo();
      const { error: insertError } = await db.from("generated_documents").insert({
        tenant_id: selecionado.id,
        supplier_id: fornecedorGeracao === "nenhum" ? null : fornecedorGeracao,
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

  const modeloDoGerador = modelos.find((m) => m.id === modeloSelecionado);
  const camposDoModelo = (
    (modeloDoGerador?.variables_schema as unknown as CampoComplementar[]) ?? []
  ).filter((campo) => !campo.source?.startsWith("process."));
  const modelosInstalados = new Set(
    modelos
      .filter((m) => m.catalog_template_id && m.is_active)
      .map((m) => m.catalog_template_id as string),
  );

  async function assinarDocumento(d: DocumentoGerado) {
    if (!selecionado || !capacidades.can_sign) return;
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
            <Button onClick={iniciarGeracao}>
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
                                  {d.external_url && (
                                    <Button size="icon" variant="ghost" asChild>
                                      <a
                                        href={d.external_url}
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
                        <th className="p-3 font-medium">Data</th>
                        <th className="p-3 font-medium">Situação</th>
                        <th className="p-3 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gerados.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-10 text-center text-muted-foreground">
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
                                {d.status === "draft" && capacidades.can_sign && (
                                  <Button size="sm" onClick={() => void assinarDocumento(d)}>
                                    <CheckCircle2 className="h-4 w-4" /> Assinar
                                  </Button>
                                )}
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
                      Selecionado: {arquivoDocumento.name} · {(arquivoDocumento.size / (1024 * 1024)).toFixed(2)} MB
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
                    Arquivo privado: {documentoEditando.file_name ?? "anexo"}. O conteúdo é imutável.
                    Para substituir, cadastre um novo documento e arquive este registro.
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
              <Label>Descrição</Label>
              <Input
                maxLength={1000}
                value={descricaoModelo}
                onChange={(e) => setDescricaoModelo(e.target.value)}
              />
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
              <Label htmlFor="arquivo-modelo">Importar arquivo de texto (.txt ou .md)</Label>
              <Input
                id="arquivo-modelo"
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(e) => void importarModelo(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                Também é possível copiar e colar o conteúdo de um modelo Word no campo abaixo.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Texto do modelo *</Label>
              <Textarea
                required
                rows={12}
                maxLength={50000}
                value={conteudoModelo}
                onChange={(e) => setConteudoModelo(e.target.value)}
                placeholder={
                  "Use {{fornecedor}}, {{cnpj}}, {{secretaria}}, {{municipio}}, {{data}} e {{usuario}} como campos automáticos."
                }
              />
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
                  <CardContent>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">
                        Consultar conteúdo desta versão
                      </summary>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
                        {versao.content}
                      </pre>
                    </details>
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
                  <Select value={fornecedorGeracao} onValueChange={setFornecedorGeracao}>
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
                    Campos automáticos: fornecedor, nome_fantasia, cnpj, secretaria, municipio, data
                    e usuario.
                  </p>
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
