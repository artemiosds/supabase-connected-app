import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, Loader2, Pencil, Plus, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { db, bancoNaoConfigurado } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { formatarCnpj, normalizarCnpj, validarCnpj } from "@/lib/cnpj";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores — Gestão de Fornecedores da Saúde" },
      { name: "description", content: "Cadastro e consulta de fornecedores da Secretaria selecionada." },
    ],
  }),
  component: Fornecedores,
});

type Fornecedor = Tables<"suppliers">;
type Categoria =
  | "medicamentos"
  | "materiais_hospitalares"
  | "equipamentos"
  | "servicos"
  | "alimentacao"
  | "transporte"
  | "outros";

type Capacidades = {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_deactivate: boolean;
};

type FormularioFornecedor = {
  cnpj: string;
  legal_name: string;
  trade_name: string;
  category: Categoria;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  website: string;
  postal_code: string;
  street: string;
  street_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  notes: string;
};

const FORMULARIO_VAZIO: FormularioFornecedor = {
  cnpj: "",
  legal_name: "",
  trade_name: "",
  category: "outros",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  website: "",
  postal_code: "",
  street: "",
  street_number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  notes: "",
};

const CATEGORIAS: { value: Categoria; label: string }[] = [
  { value: "medicamentos", label: "Medicamentos" },
  { value: "materiais_hospitalares", label: "Materiais hospitalares" },
  { value: "equipamentos", label: "Equipamentos" },
  { value: "servicos", label: "Serviços" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "transporte", label: "Transporte" },
  { value: "outros", label: "Outros" },
];

function Fornecedores() {
  const { selecionado, bancoPendente } = useTenant();
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [capacidades, setCapacidades] = useState<Capacidades>({
    can_view: false,
    can_create: false,
    can_update: false,
    can_deactivate: false,
  });
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "active" | "inactive">("todos");
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Fornecedor | null>(null);
  const [formulario, setFormulario] = useState<FormularioFornecedor>(FORMULARIO_VAZIO);

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setFornecedores([]);
      setCapacidades({ can_view: false, can_create: false, can_update: false, can_deactivate: false });
      setLoading(false);
      return;
    }

    setLoading(true);
    setErro(null);
    try {
      const { data: permissoes, error: erroPermissoes } = await db.rpc(
        "get_supplier_capabilities",
        { p_tenant_id: selecionado.id },
      );
      if (erroPermissoes) throw erroPermissoes;
      const acesso = permissoes?.[0] ?? {
        can_view: false,
        can_create: false,
        can_update: false,
        can_deactivate: false,
      };
      setCapacidades(acesso);

      if (!acesso.can_view) {
        setFornecedores([]);
        return;
      }

      const { data, error: erroFornecedores } = await db
        .from("suppliers")
        .select("*")
        .eq("tenant_id", selecionado.id)
        .order("legal_name", { ascending: true })
        .limit(200);
      if (erroFornecedores) throw erroFornecedores;
      setFornecedores(data ?? []);
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      setFornecedores([]);
      if (bancoNaoConfigurado(mensagem)) {
        setErro("A estrutura de fornecedores ainda não está disponível. Atualize a página em instantes.");
      } else {
        setErro(mensagem);
      }
    } finally {
      setLoading(false);
    }
  }, [selecionado?.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    const cnpjTermo = normalizarCnpj(busca);
    return fornecedores.filter((fornecedor) => {
      const correspondeBusca =
        !termo ||
        fornecedor.legal_name.toLocaleLowerCase("pt-BR").includes(termo) ||
        (fornecedor.trade_name ?? "").toLocaleLowerCase("pt-BR").includes(termo) ||
        fornecedor.cnpj.includes(cnpjTermo);
      const correspondeStatus = filtroStatus === "todos" || fornecedor.status === filtroStatus;
      return correspondeBusca && correspondeStatus;
    });
  }, [fornecedores, busca, filtroStatus]);

  function abrirNovo() {
    setEditando(null);
    setFormulario(FORMULARIO_VAZIO);
    setAberto(true);
  }

  function abrirEdicao(fornecedor: Fornecedor) {
    setEditando(fornecedor);
    setFormulario({
      cnpj: formatarCnpj(fornecedor.cnpj),
      legal_name: fornecedor.legal_name,
      trade_name: fornecedor.trade_name ?? "",
      category: fornecedor.category as Categoria,
      contact_name: fornecedor.contact_name ?? "",
      contact_phone: fornecedor.contact_phone ?? "",
      contact_email: fornecedor.contact_email ?? "",
      website: fornecedor.website ?? "",
      postal_code: fornecedor.postal_code ?? "",
      street: fornecedor.street ?? "",
      street_number: fornecedor.street_number ?? "",
      complement: fornecedor.complement ?? "",
      neighborhood: fornecedor.neighborhood ?? "",
      city: fornecedor.city ?? "",
      state: fornecedor.state ?? "",
      notes: fornecedor.notes ?? "",
    });
    setAberto(true);
  }

  function atualizarCampo<K extends keyof FormularioFornecedor>(
    campo: K,
    valor: FormularioFornecedor[K],
  ) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setErro(null);

    const cnpj = normalizarCnpj(formulario.cnpj);
    if (!validarCnpj(cnpj)) {
      setErro("Informe um CNPJ válido, com 14 caracteres e dígitos verificadores corretos.");
      return;
    }
    if (formulario.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formulario.contact_email)) {
      setErro("Informe um e-mail de contato válido.");
      return;
    }
    if (formulario.state && !/^[A-Za-z]{2}$/.test(formulario.state)) {
      setErro("Informe a UF com duas letras.");
      return;
    }

    const payload = {
      tenant_id: selecionado.id,
      cnpj,
      legal_name: formulario.legal_name.trim(),
      trade_name: formulario.trade_name.trim() || null,
      category: formulario.category,
      contact_name: formulario.contact_name.trim() || null,
      contact_phone: formulario.contact_phone.trim() || null,
      contact_email: formulario.contact_email.trim() || null,
      website: formulario.website.trim() || null,
      postal_code: formulario.postal_code.trim() || null,
      street: formulario.street.trim() || null,
      street_number: formulario.street_number.trim() || null,
      complement: formulario.complement.trim() || null,
      neighborhood: formulario.neighborhood.trim() || null,
      city: formulario.city.trim() || null,
      state: formulario.state.trim().toUpperCase() || null,
      notes: formulario.notes.trim() || null,
    };

    setSalvando(true);
    try {
      const resultado = editando
        ? await db.from("suppliers").update(payload).eq("id", editando.id).eq("tenant_id", selecionado.id)
        : await db.from("suppliers").insert(payload);
      if (resultado.error) throw resultado.error;
      toast.success(editando ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      setAberto(false);
      setEditando(null);
      setFormulario(FORMULARIO_VAZIO);
      await carregar();
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      setErro(mensagem.includes("suppliers_tenant_cnpj_unique")
        ? "Já existe um fornecedor com este CNPJ nesta Secretaria."
        : mensagem);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus(fornecedor: Fornecedor) {
    if (!selecionado || !capacidades.can_deactivate) return;
    const novoStatus = fornecedor.status === "active" ? "inactive" : "active";
    const { error: erroAtualizacao } = await db
      .from("suppliers")
      .update({ status: novoStatus })
      .eq("id", fornecedor.id)
      .eq("tenant_id", selecionado.id);
    if (erroAtualizacao) {
      toast.error(erroAtualizacao.message);
      return;
    }
    toast.success(novoStatus === "inactive" ? "Fornecedor inativado." : "Fornecedor reativado.");
    await carregar();
  }

  if (bancoPendente) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Estrutura inicial pendente</AlertTitle>
        <AlertDescription>O cadastro de fornecedores depende da estrutura multitenant da plataforma.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fornecedores</h1>
            <Badge variant="secondary">Fase 2.1</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastro e acompanhamento dos fornecedores da Secretaria selecionada.
          </p>
          {selecionado && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              Dados vinculados a <strong className="font-medium text-foreground">{selecionado.nome}</strong>
            </p>
          )}
        </div>
        {capacidades.can_create && (
          <Button onClick={abrirNovo} disabled={!selecionado}>
            <Plus className="h-4 w-4" aria-hidden />
            Novo fornecedor
          </Button>
        )}
      </div>

      {!selecionado ? (
        <Alert>
          <AlertTitle>Selecione uma Secretaria</AlertTitle>
          <AlertDescription>Escolha uma Secretaria no seletor superior para consultar os fornecedores vinculados a ela.</AlertDescription>
        </Alert>
      ) : erro ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar os fornecedores</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      ) : !loading && !capacidades.can_view ? (
        <Alert>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <AlertTitle>Acesso não autorizado</AlertTitle>
          <AlertDescription>Seu usuário não possui permissão para consultar fornecedores desta Secretaria. Solicite acesso ao administrador local.</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Total encontrado</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{lista.length}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Ativos</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fornecedores.filter((f) => f.status === "active").length}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Inativos</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fornecedores.filter((f) => f.status === "inactive").length}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar por razão social, nome fantasia ou CNPJ"
                className="pl-9"
                aria-label="Pesquisar fornecedores"
              />
            </div>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filtrar por situação"
            >
              <option value="todos">Todas as situações</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="hidden md:table-cell">CNPJ</TableHead>
                  <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden /></TableCell></TableRow>
                ) : lista.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Nenhum fornecedor encontrado. {capacidades.can_create ? "Cadastre o primeiro fornecedor desta Secretaria." : ""}</TableCell></TableRow>
                ) : lista.map((fornecedor) => (
                  <TableRow key={fornecedor.id}>
                    <TableCell>
                      <p className="font-medium text-foreground">{fornecedor.legal_name}</p>
                      {fornecedor.trade_name && <p className="text-xs text-muted-foreground">{fornecedor.trade_name}</p>}
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">{formatarCnpj(fornecedor.cnpj)}</p>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatarCnpj(fornecedor.cnpj)}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{CATEGORIAS.find((c) => c.value === fornecedor.category)?.label ?? "Outros"}</TableCell>
                    <TableCell><Badge variant={fornecedor.status === "active" ? "secondary" : "outline"}>{fornecedor.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {capacidades.can_update && <Button size="icon" variant="ghost" onClick={() => abrirEdicao(fornecedor)} aria-label={`Editar ${fornecedor.legal_name}`}><Pencil className="h-4 w-4" aria-hidden /></Button>}
                        {capacidades.can_deactivate && <Button size="sm" variant="outline" onClick={() => void alternarStatus(fornecedor)}>{fornecedor.status === "active" ? "Inativar" : "Reativar"}</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">A listagem exibe até 200 fornecedores por vez. O acesso aos dados é validado no banco de dados por Secretaria e permissão.</p>
        </>
      )}

      <Dialog open={aberto} onOpenChange={(valor) => { if (!salvando) setAberto(valor); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar fornecedor" : "Cadastrar fornecedor"}</DialogTitle>
            <DialogDescription>
              {selecionado?.nome}. O registro ficará isolado nesta Secretaria.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fornecedor-cnpj">CNPJ *</Label>
                <Input id="fornecedor-cnpj" required value={formulario.cnpj} onChange={(e) => atualizarCampo("cnpj", formatarCnpj(e.target.value))} placeholder="00.000.000/0000-00" autoComplete="off" />
                <p className="text-xs text-muted-foreground">Aceita CNPJ numérico e alfanumérico.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-categoria">Categoria *</Label>
                <select id="fornecedor-categoria" value={formulario.category} onChange={(e) => atualizarCampo("category", e.target.value as Categoria)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {CATEGORIAS.map((categoria) => <option key={categoria.value} value={categoria.value}>{categoria.label}</option>)}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fornecedor-razao">Razão social *</Label>
                <Input id="fornecedor-razao" required minLength={2} maxLength={200} value={formulario.legal_name} onChange={(e) => atualizarCampo("legal_name", e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fornecedor-fantasia">Nome fantasia</Label>
                <Input id="fornecedor-fantasia" maxLength={160} value={formulario.trade_name} onChange={(e) => atualizarCampo("trade_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-responsavel">Pessoa de contato</Label>
                <Input id="fornecedor-responsavel" maxLength={160} value={formulario.contact_name} onChange={(e) => atualizarCampo("contact_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-telefone">Telefone</Label>
                <Input id="fornecedor-telefone" maxLength={40} value={formulario.contact_phone} onChange={(e) => atualizarCampo("contact_phone", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-email">E-mail</Label>
                <Input id="fornecedor-email" type="email" maxLength={254} value={formulario.contact_email} onChange={(e) => atualizarCampo("contact_email", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-site">Site</Label>
                <Input id="fornecedor-site" type="url" value={formulario.website} onChange={(e) => atualizarCampo("website", e.target.value)} placeholder="https://" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-cep">CEP</Label>
                <Input id="fornecedor-cep" maxLength={12} value={formulario.postal_code} onChange={(e) => atualizarCampo("postal_code", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-uf">UF</Label>
                <Input id="fornecedor-uf" maxLength={2} value={formulario.state} onChange={(e) => atualizarCampo("state", e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fornecedor-logradouro">Logradouro</Label>
                <Input id="fornecedor-logradouro" maxLength={200} value={formulario.street} onChange={(e) => atualizarCampo("street", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-numero">Número</Label>
                <Input id="fornecedor-numero" maxLength={30} value={formulario.street_number} onChange={(e) => atualizarCampo("street_number", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-complemento">Complemento</Label>
                <Input id="fornecedor-complemento" maxLength={100} value={formulario.complement} onChange={(e) => atualizarCampo("complement", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-bairro">Bairro</Label>
                <Input id="fornecedor-bairro" maxLength={120} value={formulario.neighborhood} onChange={(e) => atualizarCampo("neighborhood", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fornecedor-cidade">Município</Label>
                <Input id="fornecedor-cidade" maxLength={120} value={formulario.city} onChange={(e) => atualizarCampo("city", e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fornecedor-observacoes">Observações internas</Label>
                <textarea id="fornecedor-observacoes" maxLength={2000} rows={3} value={formulario.notes} onChange={(e) => atualizarCampo("notes", e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={salvando}><X className="h-4 w-4" aria-hidden /> Cancelar</Button>
              <Button type="submit" disabled={salvando || (editando ? !capacidades.can_update : !capacidades.can_create)}>
                {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Cadastrar fornecedor"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
