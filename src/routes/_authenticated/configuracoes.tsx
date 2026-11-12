import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/hooks/use-tenant";
import { formatarCnpj, normalizarCnpj, validarCnpj } from "@/lib/cnpj";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { detectLogoMime, imageSize, MAX_LOGO_BYTES } from "@/lib/docx-engine";
import { isMissingDocumentBrandingTable } from "@/lib/document-branding";

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
};

const DADOS_VAZIOS: DadosSecretaria = {
  cnpj: "",
  contact_email: "",
  contact_phone: "",
  street: "",
  municipality: "",
  state: "",
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

function Configuracoes() {
  const { session } = useAuth();
  const { selecionado } = useTenant();
  const [nome, setNome] = useState("");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [dadosSecretaria, setDadosSecretaria] = useState<DadosSecretaria>(DADOS_VAZIOS);
  const [podeEditarSecretaria, setPodeEditarSecretaria] = useState(false);
  const [loadingSecretaria, setLoadingSecretaria] = useState(false);
  const [salvandoSecretaria, setSalvandoSecretaria] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dadosTimbrado, setDadosTimbrado] = useState<DadosTimbrado>(() => timbradoVazio(""));
  const [loadingTimbrado, setLoadingTimbrado] = useState(false);
  const [salvandoTimbrado, setSalvandoTimbrado] = useState(false);
  const [erroTimbrado, setErroTimbrado] = useState<string | null>(null);
  const [arquivoBrasao, setArquivoBrasao] = useState<File | null>(null);
  const [removerBrasao, setRemoverBrasao] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

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
        .select("cnpj,contact_email,contact_phone,street,municipality,state")
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
      });
    }
    setLoadingSecretaria(false);
  }, [selecionado?.id]);

  useEffect(() => {
    void carregarSecretaria();
  }, [carregarSecretaria]);

  const carregarTimbrado = useCallback(async () => {
    if (!selecionado?.id) {
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
      if (signedError || !signed?.signedUrl) {
        setLogoPreviewUrl(null);
        setErroTimbrado("Não foi possível abrir a prévia privada do brasão.");
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
          .replace(/\\p{Cc}/gu, "_")
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
      if (uploadedPath) {
        await db.storage.from("gfs-private-documents").remove([uploadedPath]);
      }
      setSalvandoTimbrado(false);
      toast.error(saveError.message);
      return;
    }

    if (oldPath && oldPath !== logoPath) {
      const { error: removeError } = await db.storage
        .from("gfs-private-documents")
        .remove([oldPath]);
      if (removeError) toast.warning("O timbrado foi salvo, mas o arquivo antigo ficou pendente de limpeza.");
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
    toast.success("Perfil atualizado.");
  }

  function atualizarSecretaria<K extends keyof DadosSecretaria>(
    campo: K,
    valor: DadosSecretaria[K],
  ) {
    setDadosSecretaria((atual) => ({ ...atual, [campo]: valor }));
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
      })
      .eq("id", selecionado.id);
    setSalvandoSecretaria(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Dados da Secretaria atualizados.");
    await carregarSecretaria();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sua conta e os dados cadastrais da Secretaria selecionada.
        </p>
      </div>

      {aviso && (
        <Alert variant="destructive">
          <AlertTitle>Configuração pendente</AlertTitle>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

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
            <form onSubmit={aoSalvarSecretaria} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tenant-cnpj">CNPJ</Label>
                  <Input
                    id="tenant-cnpj"
                    maxLength={20}
                    disabled={!podeEditarSecretaria}
                    value={dadosSecretaria.cnpj}
                    onChange={(e) => atualizarSecretaria("cnpj", formatarCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00"
                  />
                </div>
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
                    onChange={(e) => atualizarSecretaria("state", e.target.value.toUpperCase())}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timbrado dos documentos oficiais</CardTitle>
          <p className="text-sm text-muted-foreground">
            Brasão, cabeçalho, rodapé, margens e paginação usados na geração de Word e PDF desta
            Secretaria.
          </p>
        </CardHeader>
        <CardContent>
          {!selecionado ? (
            <Alert>
              <AlertTitle>Selecione uma Secretaria</AlertTitle>
              <AlertDescription>O timbrado é configurado separadamente para cada organização.</AlertDescription>
            </Alert>
          ) : loadingTimbrado ? (
            <div className="flex h-28 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : erroTimbrado ? (
            <Alert variant="destructive">
              <AlertTitle>Configuração indisponível</AlertTitle>
              <AlertDescription>{erroTimbrado}</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={aoSalvarTimbrado} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="timbrado-titulo">Nome no cabeçalho</Label>
                  <Input
                    id="timbrado-titulo"
                    maxLength={180}
                    disabled={!podeEditarSecretaria}
                    value={dadosTimbrado.header_title}
                    onChange={(event) =>
                      setDadosTimbrado((current) => ({ ...current, header_title: event.target.value }))
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
                      setDadosTimbrado((current) => ({ ...current, header_subtitle: event.target.value }))
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
                      setDadosTimbrado((current) => ({ ...current, footer_text: event.target.value }))
                    }
                    placeholder="Endereço institucional, telefone ou informação oficial"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>Brasão ou logotipo institucional (PNG/JPEG, até 300 KB)</Label>
                <Input
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
                      className="h-20 max-w-40 rounded-md border bg-white p-2 object-contain"
                    />
                  )}
                  <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {arquivoBrasao?.name ?? dadosTimbrado.logo_file_name ?? "Nenhum brasão cadastrado"}
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
                  O arquivo fica em armazenamento privado, separado por Secretaria. Ele não recebe
                  link público.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Margens de impressão (mm)</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    ["Superior", "margin_top_mm"],
                    ["Inferior", "margin_bottom_mm"],
                    ["Esquerda", "margin_left_mm"],
                    ["Direita", "margin_right_mm"],
                  ] as const).map(([label, key]) => (
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-foreground">E-mail de acesso</p>
            <p className="text-muted-foreground">{session?.user.email}</p>
          </div>
          <Separator />
          <div>
            <p className="font-medium text-foreground">Organização selecionada</p>
            <p className="text-muted-foreground">{selecionado?.nome ?? "Nenhuma"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
