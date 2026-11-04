import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, FilePlus2, FileText, Loader2, Pencil, Plus, Printer, ShieldCheck, X } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/documentos")({
  head: () => ({ meta: [{ title: "Documentos e vencimentos — Gestão de Fornecedores da Saúde" }] }),
  component: Documentos,
});

type Fornecedor = Pick<Tables<"suppliers">, "id" | "legal_name" | "trade_name" | "cnpj">;
type DocumentoFornecedor = Tables<"supplier_documents">;
type Modelo = Tables<"document_templates">;
type DocumentoGerado = Tables<"generated_documents">;
type Capacidades = { can_view: boolean; can_create: boolean; can_update: boolean; can_sign: boolean; can_manage_templates: boolean };

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
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data}T12:00:00Z`));
}

function situacaoVencimento(data: string | null): { label: string; variant: "destructive" | "secondary" | "outline" } {
  if (!data) return { label: "Sem vencimento", variant: "outline" };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const vencimento = new Date(`${data}T00:00:00`);
  const dias = Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) return { label: "Vencido", variant: "destructive" };
  if (dias <= 30) return { label: dias === 0 ? "Vence hoje" : `Vence em ${dias} dia(s)`, variant: "secondary" };
  return { label: "Em dia", variant: "outline" };
}

function Documentos() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [capacidades, setCapacidades] = useState<Capacidades>({
    can_view: false, can_create: false, can_update: false, can_sign: false, can_manage_templates: false,
  });
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [municipioSecretaria, setMunicipioSecretaria] = useState("");
  const [documentos, setDocumentos] = useState<DocumentoFornecedor[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [gerados, setGerados] = useState<DocumentoGerado[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState("vencimentos");

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

  const [dialogModelo, setDialogModelo] = useState(false);
  const [tituloModelo, setTituloModelo] = useState("");
  const [descricaoModelo, setDescricaoModelo] = useState("");
  const [conteudoModelo, setConteudoModelo] = useState("");
  const [salvandoModelo, setSalvandoModelo] = useState(false);

  const [dialogGerar, setDialogGerar] = useState(false);
  const [modeloSelecionado, setModeloSelecionado] = useState("");
  const [fornecedorGeracao, setFornecedorGeracao] = useState("nenhum");
  const [tituloGerado, setTituloGerado] = useState("");
  const [conteudoGerado, setConteudoGerado] = useState("");
  const [salvandoGerado, setSalvandoGerado] = useState(false);
  const [documentoImpressao, setDocumentoImpressao] = useState<DocumentoGerado | null>(null);

  const carregar = useCallback(async () => {
    if (!selecionado?.id) {
      setCapacidades({ can_view: false, can_create: false, can_update: false, can_sign: false, can_manage_templates: false });
      setFornecedores([]); setDocumentos([]); setModelos([]); setGerados([]); setMunicipioSecretaria(""); setLoading(false);
      return;
    }
    setLoading(true); setErro(null);
    try {
      const [cap, suppliers, supplierDocs, templates, generated, tenantData] = await Promise.all([
        db.rpc("get_document_capabilities", { p_tenant_id: selecionado.id }),
        db.from("suppliers").select("id,legal_name,trade_name,cnpj").eq("tenant_id", selecionado.id).order("legal_name").limit(500),
        db.from("supplier_documents").select("*").eq("tenant_id", selecionado.id).eq("status", "active").order("expires_at", { ascending: true, nullsFirst: false }).limit(500),
        db.from("document_templates").select("*").eq("tenant_id", selecionado.id).eq("is_active", true).order("title"),
        db.from("generated_documents").select("*").eq("tenant_id", selecionado.id).order("created_at", { ascending: false }).limit(200),
        db.from("tenants").select("municipality").eq("id", selecionado.id).maybeSingle(),
      ]);
      for (const result of [cap, suppliers, supplierDocs, templates, generated, tenantData]) if (result.error) throw result.error;
      setCapacidades(cap.data?.[0] ?? { can_view: false, can_create: false, can_update: false, can_sign: false, can_manage_templates: false });
      setFornecedores(suppliers.data ?? []);
      setDocumentos(supplierDocs.data ?? []);
      setModelos(templates.data ?? []);
      setGerados(generated.data ?? []);
      setMunicipioSecretaria(tenantData.data?.municipality ?? "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setDocumentos([]); setModelos([]); setGerados([]);
    } finally { setLoading(false); }
  }, [selecionado?.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  const fornecedorPorId = useMemo(() => new Map(fornecedores.map((f) => [f.id, f])), [fornecedores]);
  const vencidos = documentos.filter((d) => d.expires_at && situacaoVencimento(d.expires_at).label === "Vencido").length;
  const proximos = documentos.filter((d) => d.expires_at && situacaoVencimento(d.expires_at).variant === "secondary").length;

  function abrirNovoDocumento() {
    setDocumentoEditando(null); setFornecedorId(""); setTituloDocumento(""); setTipoDocumento("outros");
    setEmissao(""); setVencimento(""); setLinkDocumento(""); setObservacaoDocumento(""); setDialogDocumento(true);
  }
  function abrirEdicaoDocumento(d: DocumentoFornecedor) {
    setDocumentoEditando(d); setFornecedorId(d.supplier_id); setTituloDocumento(d.title); setTipoDocumento(d.document_type);
    setEmissao(d.issue_date ?? ""); setVencimento(d.expires_at ?? ""); setLinkDocumento(d.external_url ?? "");
    setObservacaoDocumento(d.notes ?? ""); setDialogDocumento(true);
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

  async function importarModelo(file?: File) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) {
      toast.error("Importe um modelo em arquivo .txt ou .md. Arquivos Word precisam ser copiados para o campo de texto.");
      return;
    }
    if (file.size > 50000) {
      toast.error("O modelo ultrapassa o limite de 50 KB.");
      return;
    }
    try {
      const text = await file.text();
      setConteudoModelo(text);
      if (!tituloModelo.trim()) setTituloModelo(file.name.replace(/\.(txt|md)$/i, "").slice(0,180));
      toast.success("Texto do modelo importado.");
    } catch {
      toast.error("Não foi possível ler o arquivo. Copie e cole o conteúdo no campo de texto.");
    }
  }

  async function salvarDocumento(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || !fornecedorId) return;
    if (emissao && vencimento && vencimento < emissao) { toast.error("A data de vencimento não pode ser anterior à emissão."); return; }
    setSalvandoDocumento(true);
    const payload = {
      tenant_id: selecionado.id, supplier_id: fornecedorId, title: tituloDocumento.trim(),
      document_type: tipoDocumento, issue_date: emissao || null, expires_at: vencimento || null,
      external_url: linkDocumento.trim() || null,
      storage_provider: extrairDriveFileId(linkDocumento.trim()) ? "google_drive" : "external_link",
      drive_file_id: extrairDriveFileId(linkDocumento.trim()),
      notes: observacaoDocumento.trim() || null, status: "active",
    };
    const result = documentoEditando
      ? await db.from("supplier_documents").update(payload).eq("id", documentoEditando.id).eq("tenant_id", selecionado.id)
      : await db.from("supplier_documents").insert(payload);
    setSalvandoDocumento(false);
    if (result.error) { toast.error(result.error.message); return; }
    toast.success(documentoEditando ? "Documento atualizado." : "Documento registrado.");
    setDialogDocumento(false); await carregar();
  }

  async function arquivarDocumento(d: DocumentoFornecedor) {
    if (!selecionado) return;
    const { error: updateError } = await db.from("supplier_documents").update({ status: "archived" }).eq("id", d.id).eq("tenant_id", selecionado.id);
    if (updateError) { toast.error(updateError.message); return; }
    toast.success("Documento arquivado."); await carregar();
  }

  async function salvarModelo(e: FormEvent) {
    e.preventDefault(); if (!selecionado) return;
    setSalvandoModelo(true);
    const { error: insertError } = await db.from("document_templates").insert({
      tenant_id: selecionado.id, title: tituloModelo.trim(), description: descricaoModelo.trim() || null, content: conteudoModelo.trim(),
    });
    setSalvandoModelo(false);
    if (insertError) { toast.error(insertError.message); return; }
    toast.success("Modelo salvo nesta Secretaria."); setDialogModelo(false);
    setTituloModelo(""); setDescricaoModelo(""); setConteudoModelo(""); await carregar();
  }

  function iniciarGeracao() {
    setModeloSelecionado(""); setFornecedorGeracao("nenhum"); setTituloGerado(""); setConteudoGerado(""); setDialogGerar(true);
  }
  function selecionarModelo(id: string) {
    setModeloSelecionado(id);
    const modelo = modelos.find((m) => m.id === id);
    if (modelo) { setTituloGerado(modelo.title); setConteudoGerado(modelo.content); }
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
    return conteudoGerado.replace(/\{\{\s*(fornecedor|nome_fantasia|cnpj|secretaria|municipio|data|usuario)\s*\}\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
  }
  async function gerarDocumento(e: FormEvent) {
    e.preventDefault(); if (!selecionado) return;
    setSalvandoGerado(true);
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
    if (insertError) { toast.error(insertError.message); return; }
    toast.success("Documento gerado como rascunho."); setDialogGerar(false); setAba("gerados"); await carregar();
  }

  async function assinarDocumento(d: DocumentoGerado) {
    if (!selecionado || !capacidades.can_sign) return;
    const confirmou = window.confirm("Confirma a assinatura eletrônica simples deste documento? A assinatura ficará registrada com sua conta, nome e data, e o conteúdo será bloqueado.");
    if (!confirmou) return;
    const { error: updateError } = await db.from("generated_documents").update({ status: "signed" }).eq("id", d.id).eq("tenant_id", selecionado.id);
    if (updateError) { toast.error(updateError.message); return; }
    toast.success("Assinatura registrada."); await carregar();
  }

  async function cancelarGerado(d: DocumentoGerado) {
    if (!selecionado || d.status === "signed") return;
    const { error: updateError } = await db.from("generated_documents").update({ status: "cancelled" }).eq("id", d.id).eq("tenant_id", selecionado.id);
    if (updateError) { toast.error(updateError.message); return; }
    toast.success("Documento cancelado."); await carregar();
  }

  if (!selecionado) return <Alert><AlertTitle>Selecione uma Secretaria</AlertTitle><AlertDescription>Documentos, modelos e alertas pertencem à Secretaria selecionada.</AlertDescription></Alert>;
  if (!capacidades.can_view && !loading) return <Alert><ShieldCheck className="h-4 w-4"/><AlertTitle>Acesso não autorizado</AlertTitle><AlertDescription>Seu perfil não possui permissão para consultar documentos nesta Secretaria.</AlertDescription></Alert>;

  return (
    <div className="space-y-6">
      <div className="print:hidden flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documentos e vencimentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Certidões, contratos, modelos e documentos gerados — {selecionado.nome}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {capacidades.can_manage_templates && <Button variant="outline" onClick={() => setDialogModelo(true)}><Plus className="h-4 w-4"/> Novo modelo</Button>}
          {capacidades.can_create && <Button variant="outline" onClick={abrirNovoDocumento}><FilePlus2 className="h-4 w-4"/> Registrar documento</Button>}
          {capacidades.can_create && <Button onClick={iniciarGeracao}><FileText className="h-4 w-4"/> Gerar documento</Button>}
        </div>
      </div>

      {erro && <Alert variant="destructive"><AlertTitle>Erro ao carregar</AlertTitle><AlertDescription>{erro}</AlertDescription></Alert>}
      {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin"/></div> : (
        <>
          <div className="print:hidden grid gap-3 sm:grid-cols-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Documentos ativos</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{documentos.length}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Vencidos</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-destructive">{vencidos}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Vencem em até 30 dias</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{proximos}</p></CardContent></Card>
          </div>

          <Tabs value={aba} onValueChange={setAba} className="print:hidden">
            <TabsList>
              <TabsTrigger value="vencimentos">Vencimentos</TabsTrigger>
              <TabsTrigger value="modelos">Modelos ({modelos.length})</TabsTrigger>
              <TabsTrigger value="gerados">Gerados ({gerados.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="vencimentos" className="mt-4">
              <div className="overflow-hidden rounded-lg border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left"><tr><th className="p-3 font-medium">Documento</th><th className="p-3 font-medium">Fornecedor</th><th className="p-3 font-medium">Emissão</th><th className="p-3 font-medium">Vencimento</th><th className="p-3 font-medium">Situação</th><th className="p-3 text-right font-medium">Ações</th></tr></thead>
                    <tbody>
                      {documentos.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Nenhum documento de fornecedor registrado.</td></tr> : documentos.map((d) => {
                        const f = fornecedorPorId.get(d.supplier_id);
                        const status = situacaoVencimento(d.expires_at);
                        return <tr key={d.id} className="border-t">
                          <td className="p-3"><p className="font-medium">{d.title}</p><p className="text-xs text-muted-foreground">{TIPOS.find(([v]) => v === d.document_type)?.[1] ?? d.document_type}</p></td>
                          <td className="p-3">{f?.trade_name || f?.legal_name || "Fornecedor"}</td>
                          <td className="p-3">{dataLocal(d.issue_date)}</td>
                          <td className="p-3">{dataLocal(d.expires_at)}</td>
                          <td className="p-3"><Badge variant={status.variant}>{status.label}</Badge></td>
                          <td className="p-3"><div className="flex justify-end gap-1">{d.external_url && <Button size="icon" variant="ghost" asChild><a href={d.external_url} target="_blank" rel="noreferrer" aria-label="Abrir documento"><ExternalLink className="h-4 w-4"/></a></Button>}{capacidades.can_update && <Button size="icon" variant="ghost" onClick={() => abrirEdicaoDocumento(d)} aria-label="Editar documento"><Pencil className="h-4 w-4"/></Button>}{capacidades.can_update && <Button size="icon" variant="ghost" onClick={() => void arquivarDocumento(d)} aria-label="Arquivar documento"><X className="h-4 w-4"/></Button>}</div></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Os avisos de vencimento são calculados pelo prazo informado. O arquivo permanece no endereço externo informado; o Drive ainda precisa ser conectado para sincronização automática.</p>
            </TabsContent>
            <TabsContent value="modelos" className="mt-4">
              <div className="grid gap-3 md:grid-cols-2">
                {modelos.map((m) => <Card key={m.id}><CardHeader><CardTitle className="text-base">{m.title}</CardTitle>{m.description && <p className="text-sm text-muted-foreground">{m.description}</p>}</CardHeader><CardContent><p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{m.content}</p><p className="mt-3 text-xs text-muted-foreground">Campos: {"{{fornecedor}}"}, {"{{nome_fantasia}}"}, {"{{cnpj}}"}, {"{{secretaria}}"}, {"{{municipio}}"}, {"{{data}}"}, {"{{usuario}}"}</p></CardContent></Card>)}
                {modelos.length === 0 && <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground md:col-span-2">Nenhum modelo cadastrado. Use “Novo modelo” para importar ou colar um texto-base.</div>}
              </div>
            </TabsContent>
            <TabsContent value="gerados" className="mt-4">
              <div className="overflow-hidden rounded-lg border bg-card">
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left"><tr><th className="p-3 font-medium">Documento</th><th className="p-3 font-medium">Data</th><th className="p-3 font-medium">Situação</th><th className="p-3 text-right font-medium">Ações</th></tr></thead>
                  <tbody>{gerados.length === 0 ? <tr><td colSpan={4} className="p-10 text-center text-muted-foreground">Nenhum documento gerado.</td></tr> : gerados.map((d) => <tr key={d.id} className="border-t">
                    <td className="p-3"><p className="font-medium">{d.title}</p><p className="text-xs text-muted-foreground">{fornecedorPorId.get(d.supplier_id ?? "")?.legal_name ?? "Sem fornecedor vinculado"}</p></td>
                    <td className="p-3">{new Intl.DateTimeFormat("pt-BR").format(new Date(d.created_at))}</td>
                    <td className="p-3"><Badge variant={d.status === "signed" ? "secondary" : d.status === "cancelled" ? "outline" : "default"}>{d.status === "signed" ? "Assinado" : d.status === "cancelled" ? "Cancelado" : "Rascunho"}</Badge></td>
                    <td className="p-3"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => setDocumentoImpressao(d)} aria-label="Visualizar e imprimir"><Printer className="h-4 w-4"/></Button>{d.status === "draft" && capacidades.can_sign && <Button size="sm" onClick={() => void assinarDocumento(d)}><CheckCircle2 className="h-4 w-4"/> Assinar</Button>}{d.status !== "signed" && d.status !== "cancelled" && capacidades.can_update && <Button size="sm" variant="outline" onClick={() => void cancelarGerado(d)}>Cancelar</Button>}</div></td>
                  </tr>)}</tbody>
                </table></div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={dialogDocumento} onOpenChange={setDialogDocumento}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{documentoEditando ? "Editar documento de fornecedor" : "Registrar documento de fornecedor"}</DialogTitle><DialogDescription>Informe o documento, as datas e um link para o arquivo armazenado externamente.</DialogDescription></DialogHeader>
          <form onSubmit={salvarDocumento} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Fornecedor *</Label><Select value={fornecedorId} onValueChange={setFornecedorId} disabled={!!documentoEditando}><SelectTrigger><SelectValue placeholder="Selecione o fornecedor"/></SelectTrigger><SelectContent>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.legal_name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label>Título *</Label><Input required minLength={2} maxLength={180} value={tituloDocumento} onChange={(e) => setTituloDocumento(e.target.value)} placeholder="Ex.: Certidão de regularidade fiscal"/></div>
              <div className="space-y-2"><Label>Tipo</Label><Select value={tipoDocumento} onValueChange={setTipoDocumento}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{TIPOS.map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Data de emissão</Label><Input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)}/></div>
              <div className="space-y-2"><Label>Data de vencimento</Label><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)}/></div>
              <div className="space-y-2"><Label>Link do arquivo (Drive ou outro)</Label><Input type="url" placeholder="https://" value={linkDocumento} onChange={(e) => setLinkDocumento(e.target.value)}/></div>
              <div className="space-y-2 sm:col-span-2"><Label>Observações</Label><Textarea rows={3} maxLength={2000} value={observacaoDocumento} onChange={(e) => setObservacaoDocumento(e.target.value)}/></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogDocumento(false)}><X className="h-4 w-4"/> Cancelar</Button><Button type="submit" disabled={salvandoDocumento || !fornecedorId}>{salvandoDocumento ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle2 className="h-4 w-4"/>} Salvar documento</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogModelo} onOpenChange={setDialogModelo}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Novo modelo de documento</DialogTitle><DialogDescription>Cole o conteúdo do modelo que será usado para gerar documentos. A versão original fica salva nesta Secretaria.</DialogDescription></DialogHeader>
          <form onSubmit={salvarModelo} className="space-y-4">
            <div className="space-y-2"><Label>Nome do modelo *</Label><Input required minLength={2} maxLength={180} value={tituloModelo} onChange={(e) => setTituloModelo(e.target.value)}/></div>
            <div className="space-y-2"><Label>Descrição</Label><Input maxLength={1000} value={descricaoModelo} onChange={(e) => setDescricaoModelo(e.target.value)}/></div>
            <div className="space-y-2"><Label htmlFor="arquivo-modelo">Importar arquivo de texto (.txt ou .md)</Label><Input id="arquivo-modelo" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(e) => void importarModelo(e.target.files?.[0])}/><p className="text-xs text-muted-foreground">Também é possível copiar e colar o conteúdo de um modelo Word no campo abaixo.</p></div>
            <div className="space-y-2"><Label>Texto do modelo *</Label><Textarea required rows={12} maxLength={50000} value={conteudoModelo} onChange={(e) => setConteudoModelo(e.target.value)} placeholder={'Use {{fornecedor}}, {{cnpj}}, {{secretaria}}, {{municipio}}, {{data}} e {{usuario}} como campos automáticos.'}/></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogModelo(false)}>Cancelar</Button><Button type="submit" disabled={salvandoModelo}>{salvandoModelo ? <Loader2 className="h-4 w-4 animate-spin"/> : <Plus className="h-4 w-4"/>} Salvar modelo</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogGerar} onOpenChange={setDialogGerar}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Gerar documento</DialogTitle><DialogDescription>Crie um rascunho com base em um modelo salvo e nos dados do fornecedor. O texto final fica registrado como fotografia do documento.</DialogDescription></DialogHeader>
          <form onSubmit={gerarDocumento} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Modelo</Label><Select value={modeloSelecionado} onValueChange={selecionarModelo}><SelectTrigger><SelectValue placeholder="Selecione um modelo"/></SelectTrigger><SelectContent>{modelos.map((m) => <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Fornecedor</Label><Select value={fornecedorGeracao} onValueChange={setFornecedorGeracao}><SelectTrigger><SelectValue placeholder="Vincular fornecedor"/></SelectTrigger><SelectContent><SelectItem value="nenhum">Sem fornecedor</SelectItem>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.legal_name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label>Título do documento *</Label><Input required minLength={2} maxLength={180} value={tituloGerado} onChange={(e) => setTituloGerado(e.target.value)}/></div>
              <div className="space-y-2 sm:col-span-2"><Label>Conteúdo do documento *</Label><Textarea required rows={14} maxLength={100000} value={conteudoGerado} onChange={(e) => setConteudoGerado(e.target.value)}/><p className="text-xs text-muted-foreground">Campos automáticos são substituídos na geração: fornecedor, nome_fantasia, cnpj, secretaria, municipio, data e usuario.</p></div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground sm:col-span-2"><AlertCircle className="mr-1 inline h-3.5 w-3.5"/> A assinatura disponível nesta fase é uma assinatura eletrônica simples vinculada à sessão autenticada. Não substitui certificado ICP-Brasil nem assinatura qualificada.</div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogGerar(false)}>Cancelar</Button><Button type="submit" disabled={salvandoGerado || !tituloGerado.trim() || !conteudoGerado.trim()}>{salvandoGerado ? <Loader2 className="h-4 w-4 animate-spin"/> : <FilePlus2 className="h-4 w-4"/>} Gerar rascunho</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {documentoImpressao && (
        <div className="hidden print:block print:p-12">
          <div className="mx-auto max-w-4xl">
            <p className="mb-8 text-center text-sm">{selecionado.nome}</p>
            <h1 className="mb-8 text-center text-2xl font-bold">{documentoImpressao.title}</h1>
            <div className="whitespace-pre-wrap text-sm leading-7">{documentoImpressao.content_snapshot}</div>
            {documentoImpressao.status === "signed" && <div className="mt-12 border-t pt-4 text-sm"><p>Assinatura eletrônica simples registrada no sistema.</p><p>{documentoImpressao.signed_name}</p><p>{documentoImpressao.signed_email}</p><p>{documentoImpressao.signed_at ? new Date(documentoImpressao.signed_at).toLocaleString("pt-BR") : ""}</p></div>}
          </div>
        </div>
      )}
      {documentoImpressao && <div className="print:hidden fixed bottom-5 right-5 z-50 flex gap-2 rounded-lg border bg-background p-2 shadow-lg"><Button variant="outline" onClick={() => setDocumentoImpressao(null)}>Fechar impressão</Button><Button onClick={() => window.print()}><Printer className="h-4 w-4"/> Salvar / imprimir PDF</Button></div>}
    </div>
  );
}
