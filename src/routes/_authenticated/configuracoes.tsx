import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
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
import { TenantGoogleDriveCard } from "@/components/tenant-google-drive-card";

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

      {selecionado?.enabled_modules["ged"] === true &&
        selecionado.enabled_modules["fornecedores"] === true && (
          <TenantGoogleDriveCard tenantId={selecionado.id} tenantName={selecionado.nome} />
        )}

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
