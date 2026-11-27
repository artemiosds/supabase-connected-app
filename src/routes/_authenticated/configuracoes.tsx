import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Plug,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { formatarCnpj, normalizarCnpj, validarCnpj } from "@/lib/cnpj";
import {
  cnpjDivergente,
  mapCnpjProvider,
  type CnpjLookupData,
} from "../../../supabase/functions/_shared/cnpj-mapping.ts";
import {
  calcularProntidaoSecretaria,
  listarModulosHabilitados,
  mesclarDadosCnpjOrganizacao,
  montarSugestaoTimbrado,
  normalizarCodigoIbge,
  traduzirPlanoComercial,
  traduzirStatusComercial,
} from "@/lib/tenant-settings-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { detectLogoMime, imageSize, MAX_LOGO_BYTES } from "@/lib/docx-engine";
import { isMissingDocumentBrandingTable } from "@/lib/document-branding";
import { TenantIntegrationsSettings } from "@/components/settings/tenant-integrations-settings";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Gestão de Fornecedores da Saúde" },
      { name: "description", content: "Configurações da conta e da Secretaria selecionada." },
    ],
  }),
  component: Configuracoes,
});

type DadosSecretaria = {
  cnpj: string;
  contact_email: string;
  contact_phone: string;
  street: string;
  municipality: string;
  state: string;
  trade_name: string;
  manager_name: string;
  ibge_code: string;
};

const DADOS_VAZIOS: DadosSecretaria = {
  cnpj: "",
  contact_email: "",
  contact_phone: "",
  street: "",
  municipality: "",
  state: "",
  trade_name: "",
  manager_name: "",
  ibge_code: "",
};

type DadosTimbrado = {
  header_title: string;
  header_subtitle: string;
  footer_text: string;
  margin_top_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
  show_page_numbers: boolean;
  logo_storage_path: string | null;
  logo_mime: string | null;
  logo_file_name: string | null;
  logo_file_size: number | null;
};

function timbradoVazio(nome: string): DadosTimbrado {
  return {
    header_title: nome,
    header_subtitle: "",
    footer_text: "",
    margin_top_mm: 30,
    margin_bottom_mm: 20,
    margin_left_mm: 30,
    margin_right_mm: 20,
    show_page_numbers: true,
    logo_storage_path: null,
    logo_mime: null,
    logo_file_name: null,
    logo_file_size: null,
  };
}

type CategoriaConfig = "conta" | "organizacao" | "documentos" | "integracoes";

const CATEGORIAS: {
  id: CategoriaConfig;
  titulo: string;
  descricao: string;
  icone: typeof UserRound;
}[] = [
  { id: "conta", titulo: "Minha conta", descricao: "Perfil e acesso", icone: UserRound },
  {
    id: "organizacao",
    titulo: "Organização",
    descricao: "Dados cadastrais da Secretaria",
    icone: Building2,
  },
  {
    id: "documentos",
    titulo: "Documentos oficiais",
    descricao: "Timbrado, margens e paginação",
    icone: FileText,
  },
  {
    id: "integracoes",
    titulo: "Integrações e LGPD",
    descricao: "E-mail, Google Drive e privacidade",
    icone: Plug,
  },
];

function Configuracoes() {
  const [categoria, setCategoria] = useState<CategoriaConfig>("conta");
  const { session } = useAuth();
  const { selecionado, recarregar } = useTenant();
  const [nome, setNome] = useState("");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [dadosSecretaria, setDadosSecretaria] = useState<DadosSecretaria>(DADOS_VAZIOS);
  const [podeEditarSecretaria, setPodeEditarSecretaria] = useState(false);
  const [loadingSecretaria, setLoadingSecretaria] = useState(false);
  const [salvandoSecretaria, setSalvandoSecretaria] = useState(false);
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dadosTimbrado, setDadosTimbrado] = useState<DadosTimbrado>(() => timbradoVazio(""));
  const [loadingTimbrado, setLoadingTimbrado] = useState(false);
  const [salvandoTimbrado, setSalvandoTimbrado] = useState(false);
  const [erroTimbrado, setErroTimbrado] = useState<string | null>(null);
  const [arquivoBrasao, setArquivoBrasao] = useState<File | null>(null);
  const [removerBrasao, setRemoverBrasao] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [emailIntegrado, setEmailIntegrado] = useState(false);
  const requisicaoTimbradoRef = useRef(0);

  useEffect(() => {
    if (!db || !selecionado?.id) {
      setEmailIntegrado(false);
      return;
    }
    let cancelled = false;
    db.functions
      .invoke("tenant-integration-settings", {
        body: { action: "get", tenant_id: selecionado.id },
      })
      .then(({ data }) => {
        if (cancelled) return;
        const provider = data?.configuration?.email_provider;
        setEmailIntegrado(Boolean(provider && provider !== "none"));
      })
      .then(undefined, () => {
        if (!cancelled) setEmailIntegrado(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selecionado?.id]);

  const prontidao = calcularProntidaoSecretaria({
    cnpj: dadosSecretaria.cnpj,
    hasLogo: Boolean(dadosTimbrado.logo_storage_path || logoPreviewUrl),
    headerTitle: dadosTimbrado.header_title,
    street: dadosSecretaria.street,
    municipality: dadosSecretaria.municipality,
    emailConfigured: emailIntegrado,
  });

  useEffect(() => {
    let ativo = true;
    async function carregarPerfil() {
      if (!session?.user.id) return;
      const { data, error } = await db
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!ativo) return;
      if (error) {
        if (bancoNaoConfigurado(error.message))
          setAviso("A estrutura inicial do banco ainda não está disponível.");
        else toast.error(error.message);
        return;
      }
      if (data?.full_name) setNome(data.full_name);
    }
    void carregarPerfil();
    return () => {
      ativo = false;
    };
  }, [session?.user.id]);

  const carregarSecretaria = useCallback(async () => {
    if (!selecionado?.id) {
      setDadosSecretaria(DADOS_VAZIOS);
      setPodeEditarSecretaria(false);
      return;
    }
    setLoadingSecretaria(true);
    const [caps, tenant] = await Promise.all([
      db.rpc("get_tenant_settings_capabilities", { p_tenant_id: selecionado.id }),
      db
        .from("tenants")
        .select(
          "cnpj,contact_email,contact_phone,street,municipality,state,trade_name,manager_name,ibge_code",
        )
        .eq("id", selecionado.id)
        .maybeSingle(),
    ]);
    if (caps.error || tenant.error) {
      const error = caps.error ?? tenant.error;
      if (error && !bancoNaoConfigurado(error.message)) toast.error(error.message);
      setPodeEditarSecretaria(false);
      setDadosSecretaria(DADOS_VAZIOS);
    } else {
      setPodeEditarSecretaria(caps.data?.[0]?.can_edit ?? false);
      setDadosSecretaria({
        cnpj: tenant.data?.cnpj ? formatarCnpj(tenant.data.cnpj) : "",
        contact_email: tenant.data?.contact_email ?? "",
        contact_phone: tenant.data?.contact_phone ?? "",
        street: tenant.data?.street ?? "",
        municipality: tenant.data?.municipality ?? "",
        state: tenant.data?.state ?? "",
        trade_name: tenant.data?.trade_name ?? "",
        manager_name: tenant.data?.manager_name ?? "",
        ibge_code: tenant.data?.ibge_code ?? "",
      });
    }
    setLoadingSecretaria(false);
  }, [selecionado?.id]);

  useEffect(() => {
    void carregarSecretaria();
  }, [carregarSecretaria]);

  const carregarTimbrado = useCallback(async () => {
    const requisicao = ++requisicaoTimbradoRef.current;
    const aindaAtual = () => requisicao === requisicaoTimbradoRef.current;
    if (!selecionado?.id) {
      setLoadingTimbrado(false);
      setDadosTimbrado(timbradoVazio(""));
      setLogoPreviewUrl(null);
      setErroTimbrado(null);
      return;
    }
    setLoadingTimbrado(true);
    setErroTimbrado(null);
    setArquivoBrasao(null);
    setRemoverBrasao(false);
    const { data, error } = await db
      .from("tenant_document_branding")
      .select("*")
      .eq("tenant_id", selecionado.id)
      .maybeSingle();
    if (!aindaAtual()) return;
    if (error) {
      setDadosTimbrado(timbradoVazio(selecionado.nome));
      setLogoPreviewUrl(null);
      setErroTimbrado(
        isMissingDocumentBrandingTable(error)
          ? "A configuração de timbrado ainda aguarda a implantação segura da migration no banco desta Secretaria."
          : error.message,
      );
      setLoadingTimbrado(false);
      return;
    }
    setDadosTimbrado(
      data
        ? {
            header_title: data.header_title,
            header_subtitle: data.header_subtitle,
            footer_text: data.footer_text,
            margin_top_mm: data.margin_top_mm,
            margin_bottom_mm: data.margin_bottom_mm,
            margin_left_mm: data.margin_left_mm,
            margin_right_mm: data.margin_right_mm,
            show_page_numbers: data.show_page_numbers,
            logo_storage_path: data.logo_storage_path,
            logo_mime: data.logo_mime,
            logo_file_name: data.logo_file_name,
            logo_file_size: data.logo_file_size,
          }
        : timbradoVazio(selecionado.nome),
    );
    if (data?.logo_storage_path) {
      const { data: signed, error: signedError } = await db.storage
        .from("gfs-private-documents")
        .createSignedUrl(data.logo_storage_path, 3600);
      if (!aindaAtual()) return;
      if (signedError || !signed?.signedUrl) {
        setLogoPreviewUrl(null);
        toast.error("Não foi possível abrir a prévia privada do brasão.");
      } else {
        setLogoPreviewUrl(signed.signedUrl);
      }
    } else {
      setLogoPreviewUrl(null);
    }
    setLoadingTimbrado(false);
  }, [selecionado?.id, selecionado?.nome]);

  useEffect(() => {
    void carregarTimbrado();
  }, [carregarTimbrado]);

  useEffect(
    () => () => {
      if (logoPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl],
  );

  async function aoSelecionarBrasao(file?: File) {
    if (!file) return;
    if (file.size < 1 || file.size > MAX_LOGO_BYTES) {
      toast.error("O brasão precisa ter até 300 KB.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectLogoMime(bytes);
    const dimensions = imageSize(bytes);
    if (
      !mime ||
      (file.type && file.type !== "application/octet-stream" && file.type !== mime) ||
      !dimensions ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > 4096 ||
      dimensions.height > 4096 ||
      dimensions.width * dimensions.height > 12_000_000
    ) {
      toast.error("Use um brasão PNG ou JPEG válido, com dimensões seguras.");
      return;
    }
    setArquivoBrasao(file);
    setRemoverBrasao(false);
    setLogoPreviewUrl(URL.createObjectURL(file));
  }

  async function aoSalvarTimbrado(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || !podeEditarSecretaria || erroTimbrado) return;
    const margens = [
      dadosTimbrado.margin_top_mm,
      dadosTimbrado.margin_bottom_mm,
      dadosTimbrado.margin_left_mm,
      dadosTimbrado.margin_right_mm,
    ];
    if (margens.some((value) => !Number.isInteger(value) || value < 10 || value > 50)) {
      toast.error("As margens precisam ficar entre 10 e 50 mm.");
      return;
    }

    setSalvandoTimbrado(true);
    const oldPath = dadosTimbrado.logo_storage_path;
    let logoPath = oldPath;
    let logoMime = dadosTimbrado.logo_mime;
    let logoFileName = dadosTimbrado.logo_file_name;
    let logoFileSize = dadosTimbrado.logo_file_size;
    let uploadedPath: string | null = null;

    if (arquivoBrasao) {
      const bytes = new Uint8Array(await arquivoBrasao.arrayBuffer());
      const detectedMime = detectLogoMime(bytes);
      if (!detectedMime) {
        setSalvandoTimbrado(false);
        toast.error("O arquivo do brasão não é um PNG ou JPEG válido.");
        return;
      }
      const extension = detectedMime === "image/png" ? "png" : "jpg";
      uploadedPath = `${selecionado.id}/document-branding/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage
        .from("gfs-private-documents")
        .upload(uploadedPath, arquivoBrasao, {
          contentType: detectedMime,
          upsert: false,
        });
      if (uploadError) {
        setSalvandoTimbrado(false);
        toast.error(uploadError.message);
        return;
      }
      logoPath = uploadedPath;
      logoMime = detectedMime;
      logoFileName =
        arquivoBrasao.name
          .normalize("NFC")
          .replace(/[\\/]/g, "_")
          .replace(/\p{Cc}/gu, "_")
          .trim()
          .slice(0, 255) || `brasao.${extension}`;
      logoFileSize = arquivoBrasao.size;
    } else if (removerBrasao) {
      logoPath = null;
      logoMime = null;
      logoFileName = null;
      logoFileSize = null;
    }

    const { error: saveError } = await db.from("tenant_document_branding").upsert(
      {
        tenant_id: selecionado.id,
        header_title: dadosTimbrado.header_title.trim(),
        header_subtitle: dadosTimbrado.header_subtitle.trim(),
        footer_text: dadosTimbrado.footer_text.trim(),
        margin_top_mm: dadosTimbrado.margin_top_mm,
        margin_bottom_mm: dadosTimbrado.margin_bottom_mm,
        margin_left_mm: dadosTimbrado.margin_left_mm,
        margin_right_mm: dadosTimbrado.margin_right_mm,
        show_page_numbers: dadosTimbrado.show_page_numbers,
        logo_storage_path: logoPath,
        logo_mime: logoMime,
        logo_file_name: logoFileName,
        logo_file_size: logoFileSize,
      },
      { onConflict: "tenant_id" },
    );
    if (saveError) {
      let cleanupWarning = "";
      if (uploadedPath) {
        const { error: cleanupError } = await db.storage
          .from("gfs-private-documents")
          .remove([uploadedPath]);
        if (cleanupError) {
          cleanupWarning = ` O arquivo temporário também não pôde ser removido: ${cleanupError.message}`;
        }
      }
      setSalvandoTimbrado(false);
      toast.error(`${saveError.message}${cleanupWarning}`);
      return;
    }

    if (oldPath && oldPath !== logoPath) {
      const { error: removeError } = await db.storage
        .from("gfs-private-documents")
        .remove([oldPath]);
      if (removeError) {
        toast.warning("O timbrado foi salvo, mas o arquivo antigo ficou pendente de limpeza.");
      }
    }
    setSalvandoTimbrado(false);
    setArquivoBrasao(null);
    setRemoverBrasao(false);
    toast.success("Timbrado da Secretaria atualizado.");
    await carregarTimbrado();
  }

  async function aoSalvarPerfil(e: FormEvent) {
    e.preventDefault();
    if (!session?.user.id) return;
    if (!nome.trim()) {
      toast.error("Informe um nome de exibição válido.");
      return;
    }
    setSalvandoPerfil(true);
    const { error } = await db
      .from("profiles")
      .update({ full_name: nome.trim() })
      .eq("id", session.user.id);
    setSalvandoPerfil(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNome(nome.trim());
    toast.success("Perfil atualizado.");
  }

  function atualizarSecretaria<K extends keyof DadosSecretaria>(
    campo: K,
    valor: DadosSecretaria[K],
  ) {
    setDadosSecretaria((atual) => ({ ...atual, [campo]: valor }));
  }

  async function aoConsultarCnpj() {
    const cnpj = normalizarCnpj(dadosSecretaria.cnpj);
    if (!validarCnpj(cnpj) || consultandoCnpj || !podeEditarSecretaria) {
      toast.error("Informe um CNPJ válido antes de consultar a Receita Federal.");
      return;
    }
    setConsultandoCnpj(true);
    try {
      let dados: CnpjLookupData | null = null;
      try {
        const { data, error } = await db.functions.invoke("lookup-cnpj", {
          body: { cnpj },
        });
        if (error) throw error;
        const resposta = data?.data as CnpjLookupData | undefined;
        if (!resposta?.legal_name || cnpjDivergente(resposta, cnpj)) {
          throw new Error("Resposta inválida da consulta.");
        }
        dados = resposta;
      } catch {
        const providers = [
          {
            name: "BrasilAPI",
            url: `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`,
          },
          { name: "Minha Receita", url: `https://minhareceita.org/${encodeURIComponent(cnpj)}` },
        ];
        for (const provider of providers) {
          try {
            const response = await fetch(provider.url, {
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(6500),
            });
            if (!response.ok) continue;
            const raw = (await response.json()) as Record<string, unknown>;
            const mapped = mapCnpjProvider(raw, provider.name);
            if (!mapped.legal_name || cnpjDivergente(mapped, cnpj)) continue;
            dados = mapped;
            break;
          } catch {
            // Tenta o próximo provedor público.
          }
        }
      }

      if (!dados) {
        toast.error("Não foi possível consultar o CNPJ nas fontes públicas no momento.");
        return;
      }
      setDadosSecretaria((atual) => ({
        ...atual,
        ...mesclarDadosCnpjOrganizacao(atual, dados),
      }));
      toast.success("Dados públicos da Receita Federal preenchidos nos campos vazios.");
    } finally {
      setConsultandoCnpj(false);
    }
  }

  async function aoSalvarSecretaria(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || !podeEditarSecretaria) return;
    if (dadosSecretaria.cnpj.trim() && !validarCnpj(dadosSecretaria.cnpj)) {
      toast.error("Informe um CNPJ válido da Secretaria.");
      return;
    }
    if (dadosSecretaria.state && !/^[A-Za-z]{2}$/.test(dadosSecretaria.state)) {
      toast.error("Informe a UF com duas letras.");
      return;
    }
    setSalvandoSecretaria(true);
    const { error } = await db
      .from("tenants")
      .update({
        cnpj: dadosSecretaria.cnpj.trim() ? normalizarCnpj(dadosSecretaria.cnpj) : null,
        contact_email: dadosSecretaria.contact_email.trim() || null,
        contact_phone: dadosSecretaria.contact_phone.trim() || null,
        street: dadosSecretaria.street.trim() || null,
        municipality: dadosSecretaria.municipality.trim() || null,
        state: dadosSecretaria.state.trim().toUpperCase() || null,
        trade_name: dadosSecretaria.trade_name.trim() || null,
        manager_name: dadosSecretaria.manager_name.trim() || null,
        ibge_code: normalizarCodigoIbge(dadosSecretaria.ibge_code) || null,
      })
      .eq("id", selecionado.id);
    setSalvandoSecretaria(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Dados da Secretaria atualizados.");
    recarregar();
    await carregarSecretaria();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Configurações da Secretaria
              </h1>
              <Badge variant="outline" className="text-xs font-medium">
                {traduzirPlanoComercial(selecionado?.plan_tier)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {selecionado?.nome ?? "Secretaria Municipal de Saúde"} · Gestão cadastral, identidade
              visual e segurança.
            </p>
          </div>

          {/* Indicador de Prontidão Operacional */}
          <div className="flex items-center gap-4 rounded-lg border bg-muted/40 px-4 py-2.5 sm:self-center">
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                {prontidao.status === "completo" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span className="text-xs font-semibold text-foreground">
                  {prontidao.percentual}% Pronta
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {prontidao.status === "completo"
                  ? "Documentos e Atas prontos"
                  : `${prontidao.resumoPendencias.length} item(ns) pendente(s)`}
              </p>
            </div>
            <div className="h-8 w-1.5 overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  "w-full transition-all duration-500",
                  prontidao.percentual === 100 ? "bg-emerald-600" : "bg-amber-500",
                )}
                style={{ height: `${prontidao.percentual}%` }}
              />
            </div>
          </div>
        </div>

        {prontidao.resumoPendencias.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Recomendações para operação oficial:
            </span>
            {prontidao.resumoPendencias.map((pendencia, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs font-normal">
                {pendencia}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {aviso && (
        <Alert variant="destructive">
          <AlertTitle>Configuração pendente</AlertTitle>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      <div className="sm:hidden">
        <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaConfig)}>
          <SelectTrigger aria-label="Categoria de configurações">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.titulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Categorias de configurações" className="hidden sm:block">
          <ul className="sticky top-4 space-y-1">
            {CATEGORIAS.map((c) => {
              const Icone = c.icone;
              const ativo = categoria === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCategoria(c.id)}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-md px-3 py-2.5 text-left transition-colors",
                      ativo
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <Icone className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm leading-tight">{c.titulo}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.descricao}
                        </span>
                      </span>
                    </div>

                    {c.id === "organizacao" && (
                      <Badge
                        variant={dadosSecretaria.cnpj ? "outline" : "secondary"}
                        className="shrink-0 text-[10px] font-normal"
                      >
                        {dadosSecretaria.cnpj ? "CNPJ OK" : "Pendente"}
                      </Badge>
                    )}
                    {c.id === "documentos" && (
                      <Badge
                        variant={
                          dadosTimbrado.logo_storage_path || logoPreviewUrl ? "outline" : "secondary"
                        }
                        className="shrink-0 text-[10px] font-normal"
                      >
                        {dadosTimbrado.logo_storage_path || logoPreviewUrl
                          ? "Brasão OK"
                          : "Sem brasão"}
                      </Badge>
                    )}
                    {c.id === "integracoes" && (
                      <Badge
                        variant={emailIntegrado ? "outline" : "secondary"}
                        className="shrink-0 text-[10px] font-normal"
                      >
                        {emailIntegrado ? "Ativa" : "Opcional"}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <div className="mb-4 border-b pb-4" aria-live="polite">
            <h2 className="text-lg font-semibold text-foreground">
              {CATEGORIAS.find((item) => item.id === categoria)?.titulo}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {CATEGORIAS.find((item) => item.id === categoria)?.descricao}
            </p>
          </div>
          <section hidden={categoria !== "conta"} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Perfil pessoal</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={aoSalvarPerfil} className="max-w-sm space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="nome-perfil">Nome de exibição</Label>
                    <Input
                      id="nome-perfil"
                      required
                      minLength={1}
                      maxLength={160}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Como seu nome aparece na plataforma"
                    />
                  </div>
                  <Button type="submit" disabled={salvandoPerfil}>
                    {salvandoPerfil ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}{" "}
                    Salvar perfil
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dados da conta</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Informações da sessão atualmente autenticada.
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">E-mail de acesso</p>
                  <p className="break-words text-muted-foreground">
                    {session?.user.email ?? "Não disponível"}
                  </p>
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">Organização selecionada</p>
                  <p className="break-words text-muted-foreground">
                    {selecionado?.nome ?? "Nenhuma"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          <section hidden={categoria !== "organizacao"} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dados cadastrais da Secretaria</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {selecionado?.nome ?? "Nenhuma Secretaria selecionada"}
                </p>
              </CardHeader>
              <CardContent>
                {!selecionado ? (
                  <Alert>
                    <AlertTitle>Selecione uma Secretaria</AlertTitle>
                    <AlertDescription>
                      Os dados institucionais são configurados separadamente para cada organização.
                    </AlertDescription>
                  </Alert>
                ) : loadingSecretaria ? (
                  <div className="flex h-28 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <form onSubmit={aoSalvarSecretaria} className="space-y-6">
                    <div className="space-y-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        1. Identificação Institucional (FMS e IBGE)
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="tenant-cnpj">CNPJ</Label>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              id="tenant-cnpj"
                              className="min-w-[200px] flex-1"
                              maxLength={20}
                              disabled={!podeEditarSecretaria}
                              value={dadosSecretaria.cnpj}
                              onChange={(e) =>
                                atualizarSecretaria("cnpj", formatarCnpj(e.target.value))
                              }
                              placeholder="00.000.000/0000-00"
                            />
                            {podeEditarSecretaria && (
                              <Button
                                type="button"
                                variant="outline"
                                disabled={consultandoCnpj || !validarCnpj(dadosSecretaria.cnpj)}
                                onClick={() => void aoConsultarCnpj()}
                              >
                                {consultandoCnpj ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Search className="mr-2 h-4 w-4" />
                                )}
                                Consultar Receita Federal
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="tenant-trade-name">Nome Fantasia / FMS</Label>
                          <Input
                            id="tenant-trade-name"
                            maxLength={150}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.trade_name}
                            onChange={(e) => atualizarSecretaria("trade_name", e.target.value)}
                            placeholder="Ex: Fundo Municipal de Saúde de Oriximiná"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Utilizado na identificação de empenhos, termos de referência e contratos.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="tenant-ibge">Código IBGE do Município</Label>
                          <Input
                            id="tenant-ibge"
                            maxLength={7}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.ibge_code}
                            onChange={(e) =>
                              atualizarSecretaria("ibge_code", normalizarCodigoIbge(e.target.value))
                            }
                            placeholder="Ex: 1505304 (7 dígitos)"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Necessário para publicação oficial no PNCP e remessas ao TCE.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 border-t pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        2. Gestão & Autoridade Competente
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="tenant-manager">
                            Secretário(a) Titular / Ordenador(a) de Despesas
                          </Label>
                          <Input
                            id="tenant-manager"
                            maxLength={120}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.manager_name}
                            onChange={(e) => atualizarSecretaria("manager_name", e.target.value)}
                            placeholder="Nome completo do Secretário(a) de Saúde"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Autoridade responsável pela homologação e assinatura dos atos pela Lei
                            14.133/2021.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 border-t pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        3. Contatos e Endereço Oficial
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="tenant-email">E-mail institucional</Label>
                          <Input
                            id="tenant-email"
                            type="email"
                            maxLength={254}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.contact_email}
                            onChange={(e) => atualizarSecretaria("contact_email", e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="tenant-phone">Telefone</Label>
                          <Input
                            id="tenant-phone"
                            maxLength={40}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.contact_phone}
                            onChange={(e) => atualizarSecretaria("contact_phone", e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="tenant-state">UF</Label>
                          <Input
                            id="tenant-state"
                            maxLength={2}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.state}
                            onChange={(e) =>
                              atualizarSecretaria("state", e.target.value.toUpperCase())
                            }
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="tenant-municipality">Município</Label>
                          <Input
                            id="tenant-municipality"
                            maxLength={120}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.municipality}
                            onChange={(e) => atualizarSecretaria("municipality", e.target.value)}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="tenant-street">Endereço</Label>
                          <Input
                            id="tenant-street"
                            maxLength={200}
                            disabled={!podeEditarSecretaria}
                            value={dadosSecretaria.street}
                            onChange={(e) => atualizarSecretaria("street", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    {podeEditarSecretaria ? (
                      <Button type="submit" disabled={salvandoSecretaria}>
                        {salvandoSecretaria ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}{" "}
                        Salvar dados da Secretaria
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Seu papel permite consultar, mas não editar os dados institucionais desta
                        Secretaria.
                      </p>
                    )}
                  </form>
                )}
              </CardContent>
            </Card>
            {selecionado && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Plano, limites e módulos
                    habilitados
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Parâmetros comerciais da assinatura desta Secretaria (somente leitura; geridos
                    pela administração da plataforma).
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Plano atual</p>
                      <p className="font-medium">{traduzirPlanoComercial(selecionado.plan_tier)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Situação comercial</p>
                      <p className="font-medium">
                        {traduzirStatusComercial(selecionado.commercial_status)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Limite de usuários</p>
                      <p className="font-medium">
                        {selecionado.max_users != null
                          ? `${selecionado.max_users} usuário(s)`
                          : "Conforme contrato"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Módulos contratados ativos</p>
                    <div className="flex flex-wrap gap-1.5">
                      {listarModulosHabilitados(selecionado.enabled_modules).map((modulo) => (
                        <Badge key={modulo} variant="secondary">
                          {modulo}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          <section hidden={categoria !== "documentos"} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timbrado dos documentos oficiais</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Brasão, cabeçalho, rodapé, margens e paginação usados na geração de Word e PDF
                  desta Secretaria.
                </p>
              </CardHeader>
              <CardContent>
                {!selecionado ? (
                  <Alert>
                    <AlertTitle>Selecione uma Secretaria</AlertTitle>
                    <AlertDescription>
                      O timbrado é configurado separadamente para cada organização.
                    </AlertDescription>
                  </Alert>
                ) : loadingTimbrado ? (
                  <div className="flex h-28 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : erroTimbrado ? (
                  <Alert>
                    <AlertTitle>Configuração pendente ou indisponível</AlertTitle>
                    <AlertDescription>{erroTimbrado}</AlertDescription>
                  </Alert>
                ) : (
                  <form onSubmit={aoSalvarTimbrado} className="space-y-5">
                    {podeEditarSecretaria && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">
                          Preencha subtítulo e rodapé automaticamente com CNPJ, endereço e contatos
                          cadastrados na aba Organização.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const sugestao = montarSugestaoTimbrado(
                              selecionado.nome,
                              dadosSecretaria,
                            );
                            setDadosTimbrado((current) => ({
                              ...current,
                              header_title: current.header_title.trim() || selecionado.nome,
                              header_subtitle: sugestao.header_subtitle,
                              footer_text: sugestao.footer_text,
                            }));
                            toast.success("Campos preenchidos com os dados da Secretaria.");
                          }}
                        >
                          <WandSparkles className="mr-2 h-3.5 w-3.5" />
                          Preencher com dados da Secretaria
                        </Button>
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="timbrado-titulo">Nome no cabeçalho</Label>
                        <Input
                          id="timbrado-titulo"
                          maxLength={180}
                          disabled={!podeEditarSecretaria}
                          value={dadosTimbrado.header_title}
                          onChange={(event) =>
                            setDadosTimbrado((current) => ({
                              ...current,
                              header_title: event.target.value,
                            }))
                          }
                          placeholder={selecionado.nome}
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="timbrado-subtitulo">Subtítulo institucional</Label>
                        <Input
                          id="timbrado-subtitulo"
                          maxLength={240}
                          disabled={!podeEditarSecretaria}
                          value={dadosTimbrado.header_subtitle}
                          onChange={(event) =>
                            setDadosTimbrado((current) => ({
                              ...current,
                              header_subtitle: event.target.value,
                            }))
                          }
                          placeholder="Prefeitura Municipal, secretaria ou departamento"
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="timbrado-rodape">Rodapé</Label>
                        <Input
                          id="timbrado-rodape"
                          maxLength={500}
                          disabled={!podeEditarSecretaria}
                          value={dadosTimbrado.footer_text}
                          onChange={(event) =>
                            setDadosTimbrado((current) => ({
                              ...current,
                              footer_text: event.target.value,
                            }))
                          }
                          placeholder="Endereço institucional, telefone ou informação oficial"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="timbrado-brasao">
                        Brasão ou logotipo institucional (PNG/JPEG, até 300 KB)
                      </Label>
                      <Input
                        id="timbrado-brasao"
                        type="file"
                        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                        disabled={!podeEditarSecretaria}
                        onChange={(event) => {
                          void aoSelecionarBrasao(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-4">
                        {logoPreviewUrl && (
                          <img
                            src={logoPreviewUrl}
                            alt="Prévia do brasão institucional"
                            className="h-20 max-w-40 rounded-md border bg-card p-2 object-contain"
                          />
                        )}
                        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                          {arquivoBrasao?.name ??
                            dadosTimbrado.logo_file_name ??
                            "Nenhum brasão cadastrado"}
                        </div>
                        {(dadosTimbrado.logo_storage_path || arquivoBrasao) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!podeEditarSecretaria}
                            onClick={() => {
                              setArquivoBrasao(null);
                              setRemoverBrasao(true);
                              setLogoPreviewUrl(null);
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Remover brasão
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        O arquivo fica em armazenamento privado, separado por Secretaria. Ele não
                        recebe link público.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Margens de impressão (mm)</Label>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {(
                          [
                            ["Superior", "margin_top_mm"],
                            ["Inferior", "margin_bottom_mm"],
                            ["Esquerda", "margin_left_mm"],
                            ["Direita", "margin_right_mm"],
                          ] as const
                        ).map(([label, key]) => (
                          <div key={key} className="space-y-1">
                            <Label htmlFor={`timbrado-${key}`}>{label}</Label>
                            <Input
                              id={`timbrado-${key}`}
                              type="number"
                              min={10}
                              max={50}
                              step={1}
                              disabled={!podeEditarSecretaria}
                              value={dadosTimbrado[key]}
                              onChange={(event) =>
                                setDadosTimbrado((current) => ({
                                  ...current,
                                  [key]: Number(event.target.value),
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={dadosTimbrado.show_page_numbers}
                        disabled={!podeEditarSecretaria}
                        onChange={(event) =>
                          setDadosTimbrado((current) => ({
                            ...current,
                            show_page_numbers: event.target.checked,
                          }))
                        }
                      />
                      Mostrar número e total de páginas
                    </label>

                    {podeEditarSecretaria ? (
                      <Button type="submit" disabled={salvandoTimbrado}>
                        {salvandoTimbrado ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}{" "}
                        Salvar timbrado
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Seu papel permite consultar, mas não editar o timbrado desta Secretaria.
                      </p>
                    )}
                  </form>
                )}
              </CardContent>
            </Card>
            {selecionado && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Plano, limites e módulos
                    habilitados
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Parâmetros comerciais da assinatura desta Secretaria (somente leitura; geridos
                    pela administração da plataforma).
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Plano atual</p>
                      <p className="font-medium">{traduzirPlanoComercial(selecionado.plan_tier)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Situação comercial</p>
                      <p className="font-medium">
                        {traduzirStatusComercial(selecionado.commercial_status)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Limite de usuários</p>
                      <p className="font-medium">
                        {selecionado.max_users != null
                          ? `${selecionado.max_users} usuário(s)`
                          : "Conforme contrato"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Módulos contratados ativos</p>
                    <div className="flex flex-wrap gap-1.5">
                      {listarModulosHabilitados(selecionado.enabled_modules).map((modulo) => (
                        <Badge key={modulo} variant="secondary">
                          {modulo}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          <section hidden={categoria !== "integracoes"} className="space-y-6">
            <TenantIntegrationsSettings />
          </section>
        </div>
      </div>
    </div>
  );
}
