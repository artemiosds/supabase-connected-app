import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FilePlus2, Loader2, Plus, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { dbFase3, bancoNaoConfigurado, db } from "@/lib/db";
import { useTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/hooks/use-auth";
import {
  diasAte,
  formatarData,
  formatarMoeda,
  MODALIDADES,
  nivelAlerta,
  ORIENTACAO_ALERTA,
  ROTULO_ALERTA,
  type NivelAlerta,
} from "@/lib/contratacao";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/contratos")({
  head: () => ({
    meta: [
      { title: "Contratos e vencimentos — Gestão de Fornecedores da Saúde" },
      {
        name: "description",
        content: "Contratos, aditivos e régua de alertas de vencimento de 120, 90, 60 e 30 dias.",
      },
    ],
  }),
  component: Contratos,
});

type Contrato = {
  id: string;
  number: string;
  object: string;
  supplier_id: string | null;
  modality: string;
  total_value: number;
  start_date: string;
  end_date: string;
  manager_name: string | null;
  inspector_name: string | null;
  ordinance: string | null;
  status: string;
};

const corAlerta: Record<NivelAlerta, string> = {
  vencido: "bg-destructive text-destructive-foreground",
  "30": "bg-destructive/15 text-destructive border-destructive/30",
  "60": "bg-accent text-accent-foreground border-accent",
  "90": "bg-secondary text-secondary-foreground",
  "120": "bg-primary/10 text-primary border-primary/30",
  ok: "bg-muted text-muted-foreground",
};

function Contratos() {
  const { selecionado } = useTenant();
  const { session } = useAuth();
  const [lista, setLista] = useState<Contrato[]>([]);
  const [fornecedores, setFornecedores] = useState<{ id: string; legal_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [aditivoDe, setAditivoDe] = useState<Contrato | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "alerta">("todos");

  const carregar = useCallback(async () => {
    if (!selecionado?.id) return;
    setLoading(true);
    setErro(null);
    const [c, f] = await Promise.all([
      dbFase3
        .from("contracts")
        .select("*")
        .eq("tenant_id", selecionado.id)
        .order("end_date", { ascending: true }),
      db
        .from("suppliers")
        .select("id, legal_name")
        .eq("tenant_id", selecionado.id)
        .order("legal_name"),
    ]);
    if (c.error) {
      if (bancoNaoConfigurado(c.error.message)) setPendente(true);
      else setErro(c.error.message);
    } else {
      setPendente(false);
      setLista((c.data ?? []) as Contrato[]);
    }
    setFornecedores(f.data ?? []);
    setLoading(false);
  }, [selecionado?.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const comNivel = useMemo(
    () =>
      lista.map((c) => {
        const dias = diasAte(c.end_date);
        return { ...c, dias, nivel: c.status === "vigente" ? nivelAlerta(dias) : ("ok" as const) };
      }),
    [lista],
  );
  const contagem = (n: NivelAlerta) => comNivel.filter((c) => c.nivel === n).length;
  const exibidos = filtro === "alerta" ? comNivel.filter((c) => c.nivel !== "ok") : comNivel;
  const nomeFornecedor = (id: string | null) =>
    fornecedores.find((f) => f.id === id)?.legal_name ?? "—";

  if (!selecionado) {
    return <p className="text-muted-foreground">Selecione uma organização no topo da tela.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contratos e vencimentos</h1>
          <p className="text-sm text-muted-foreground">
            Régua de alertas: 120, 90, 60 e 30 dias antes do fim da vigência.
          </p>
        </div>
        <Button onClick={() => setNovoAberto(true)} disabled={pendente}>
          <Plus className="h-4 w-4" /> Novo contrato
        </Button>
      </div>

      {pendente && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Aguardando ativação no banco de dados</AlertTitle>
          <AlertDescription>
            A tela está pronta, mas a estrutura de contratos ainda não foi aprovada e aplicada no
            Supabase SMS2. Depois da aprovação, os cadastros funcionarão aqui.
          </AlertDescription>
        </Alert>
      )}
      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(["vencido", "30", "60", "90", "120"] as NivelAlerta[]).map((n) => (
          <Card key={n}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{ROTULO_ALERTA[n]}</p>
              <p className="text-2xl font-semibold">{contagem(n)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={filtro === "todos" ? "default" : "outline"}
          onClick={() => setFiltro("todos")}
        >
          Todos
        </Button>
        <Button
          size="sm"
          variant={filtro === "alerta" ? "default" : "outline"}
          onClick={() => setFiltro("alerta")}
        >
          Somente com alerta
        </Button>
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : exibidos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Nenhum contrato para exibir</p>
            <p className="text-sm text-muted-foreground">
              Cadastre o primeiro contrato para acompanhar os vencimentos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {exibidos.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-base">Contrato nº {c.number}</CardTitle>
                  <p className="text-sm text-muted-foreground">{c.object}</p>
                </div>
                <Badge variant="outline" className={corAlerta[c.nivel]}>
                  {c.status !== "vigente"
                    ? c.status
                    : c.dias < 0
                      ? `Vencido há ${-c.dias} dia(s)`
                      : `${c.dias} dia(s) restantes`}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  <span>Fornecedor: {nomeFornecedor(c.supplier_id)}</span>
                  <span>Modalidade: {MODALIDADES[c.modality] ?? c.modality}</span>
                  <span>Valor: {formatarMoeda(Number(c.total_value))}</span>
                  <span>
                    Vigência: {formatarData(c.start_date)} a {formatarData(c.end_date)}
                  </span>
                  <span>Gestor: {c.manager_name || "—"}</span>
                  <span>
                    Fiscal: {c.inspector_name || "—"}
                    {c.ordinance ? ` (Portaria ${c.ordinance})` : ""}
                  </span>
                </div>
                {c.nivel !== "ok" && (
                  <p className="rounded-md bg-muted px-3 py-2 text-foreground">
                    {ORIENTACAO_ALERTA[c.nivel]}
                  </p>
                )}
                <Button size="sm" variant="outline" onClick={() => setAditivoDe(c)}>
                  <FilePlus2 className="h-4 w-4" /> Registrar aditivo
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NovoContrato
        aberto={novoAberto}
        onFechar={() => setNovoAberto(false)}
        tenantId={selecionado.id}
        userId={session?.user.id ?? ""}
        fornecedores={fornecedores}
        onSalvo={carregar}
      />
      <NovoAditivo
        contrato={aditivoDe}
        onFechar={() => setAditivoDe(null)}
        tenantId={selecionado.id}
        userId={session?.user.id ?? ""}
        onSalvo={carregar}
      />
    </div>
  );
}

function NovoContrato(props: {
  aberto: boolean;
  onFechar: () => void;
  tenantId: string;
  userId: string;
  fornecedores: { id: string; legal_name: string }[];
  onSalvo: () => void;
}) {
  const vazio = {
    number: "",
    object: "",
    supplier_id: "",
    modality: "pregao",
    total_value: "",
    start_date: "",
    end_date: "",
    manager_name: "",
    inspector_name: "",
    ordinance: "",
  };
  const [f, setF] = useState(vazio);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof vazio) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (f.end_date < f.start_date) {
      toast.error("A data final deve ser igual ou posterior à data inicial.");
      return;
    }
    setSalvando(true);
    const { error } = await dbFase3.from("contracts").insert({
      tenant_id: props.tenantId,
      number: f.number.trim(),
      object: f.object.trim(),
      supplier_id: f.supplier_id || null,
      modality: f.modality,
      total_value: Number(f.total_value.replace(",", ".")) || 0,
      start_date: f.start_date,
      end_date: f.end_date,
      manager_name: f.manager_name.trim() || null,
      inspector_name: f.inspector_name.trim() || null,
      ordinance: f.ordinance.trim() || null,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contrato cadastrado.");
    setF(vazio);
    props.onFechar();
    props.onSalvo();
  }

  return (
    <Dialog open={props.aberto} onOpenChange={(o) => !o && props.onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
        </DialogHeader>
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <Campo label="Número/ano *">
            <Input
              required
              value={f.number}
              onChange={(e) => set("number")(e.target.value)}
              placeholder="042/2026"
            />
          </Campo>
          <Campo label="Modalidade">
            <Select value={f.modality} onValueChange={set("modality")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODALIDADES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <div className="sm:col-span-2">
            <Campo label="Objeto *">
              <Textarea
                required
                minLength={3}
                value={f.object}
                onChange={(e) => set("object")(e.target.value)}
              />
            </Campo>
          </div>
          <Campo label="Fornecedor">
            <Select value={f.supplier_id} onValueChange={set("supplier_id")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {props.fornecedores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Valor global (R$)">
            <Input
              inputMode="decimal"
              value={f.total_value}
              onChange={(e) => set("total_value")(e.target.value)}
            />
          </Campo>
          <Campo label="Início da vigência *">
            <Input
              type="date"
              required
              value={f.start_date}
              onChange={(e) => set("start_date")(e.target.value)}
            />
          </Campo>
          <Campo label="Fim da vigência *">
            <Input
              type="date"
              required
              value={f.end_date}
              onChange={(e) => set("end_date")(e.target.value)}
            />
          </Campo>
          <Campo label="Gestor do contrato">
            <Input value={f.manager_name} onChange={(e) => set("manager_name")(e.target.value)} />
          </Campo>
          <Campo label="Fiscal do contrato">
            <Input
              value={f.inspector_name}
              onChange={(e) => set("inspector_name")(e.target.value)}
            />
          </Campo>
          <Campo label="Portaria de designação">
            <Input value={f.ordinance} onChange={(e) => set("ordinance")(e.target.value)} />
          </Campo>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={props.onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar contrato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NovoAditivo(props: {
  contrato: Contrato | null;
  onFechar: () => void;
  tenantId: string;
  userId: string;
  onSalvo: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [tipo, setTipo] = useState("prorrogacao");
  const [novaData, setNovaData] = useState("");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!props.contrato) return;
    const v = Number(valor.replace(",", ".")) || 0;
    setSalvando(true);
    const { error } = await dbFase3.from("contract_amendments").insert({
      tenant_id: props.tenantId,
      contract_id: props.contrato.id,
      number: numero.trim(),
      kind: tipo,
      new_end_date: tipo === "prorrogacao" ? novaData || null : null,
      value_change: tipo === "supressao" ? -Math.abs(v) : tipo === "acrescimo" ? Math.abs(v) : 0,
      created_by: props.userId,
      updated_by: props.userId,
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Aditivo registrado e contrato atualizado.");
    setNumero("");
    setNovaData("");
    setValor("");
    props.onFechar();
    props.onSalvo();
  }

  return (
    <Dialog open={!!props.contrato} onOpenChange={(o) => !o && props.onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Termo aditivo — Contrato {props.contrato?.number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={salvar} className="grid gap-4">
          <Campo label="Número do aditivo *">
            <Input
              required
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="1º Termo Aditivo"
            />
          </Campo>
          <Campo label="Tipo">
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prorrogacao">Prorrogação de prazo</SelectItem>
                <SelectItem value="acrescimo">Acréscimo de valor</SelectItem>
                <SelectItem value="supressao">Supressão de valor</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          {tipo === "prorrogacao" && (
            <Campo label="Nova data final *">
              <Input
                type="date"
                required
                value={novaData}
                onChange={(e) => setNovaData(e.target.value)}
              />
            </Campo>
          )}
          {(tipo === "acrescimo" || tipo === "supressao") && (
            <Campo label="Valor (R$) *">
              <Input
                required
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </Campo>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
