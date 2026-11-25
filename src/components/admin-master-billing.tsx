import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FilePlus2,
  Loader2,
  LockKeyhole,
  Receipt,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Unplug,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { MasterTenant } from "@/hooks/use-platform-admin";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { filtrarFaturasMaster, resumirFinanceiroFaturas } from "@/lib/admin-master-helper";

type Provider = "mercado_pago" | "stripe" | "other";
type Environment = "sandbox" | "production";
type ProviderChoice = Provider | "";

type BillingConfiguration = {
  provider: Provider;
  provider_other_name: string | null;
  environment: Environment;
  account_name: string;
  account_reference: string | null;
  account_email: string | null;
  client_id: string | null;
  public_key: string | null;
  status: "credentials_saved" | "disabled";
  payments_enabled: false;
  has_credentials: boolean;
  updated_at: string;
};

type BillingForm = {
  provider: ProviderChoice;
  provider_other_name: string;
  environment: Environment;
  account_name: string;
  account_reference: string;
  account_email: string;
  client_id: string;
  public_key: string;
  access_token: string;
  secret_key: string;
  client_secret: string;
  webhook_secret: string;
};

const EMPTY_FORM: BillingForm = {
  provider: "",
  provider_other_name: "",
  environment: "sandbox",
  account_name: "",
  account_reference: "",
  account_email: "",
  client_id: "",
  public_key: "",
  access_token: "",
  secret_key: "",
  client_secret: "",
  webhook_secret: "",
};

function providerLabel(provider: Provider, otherName?: string | null): string {
  if (provider === "mercado_pago") return "Mercado Pago";
  if (provider === "stripe") return "Stripe";
  return otherName?.trim() || "Outro provedor";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatMoney(value: number | string | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value ?? 0) || 0,
  );
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("pt-BR").format(parsed);
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type PlatformInvoice = Tables<"platform_invoices">;

const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  paid: "Paga",
  overdue: "Em atraso",
  cancelled: "Cancelada",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  manual: "Manual",
  pix: "PIX",
  boleto: "Boleto",
  cartao: "Cartão",
  transferencia: "Transferência / TED",
  gateway: "Gateway",
};

function invoiceStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "paid") return "default";
  if (status === "overdue") return "destructive";
  if (status === "pending") return "secondary";
  return "outline";
}

export function MasterBillingSettings({
  tenants = [],
  onBillingChanged,
}: {
  tenants?: MasterTenant[];
  onBillingChanged?: () => Promise<void> | void;
}) {
  const [billingTab, setBillingTab] = useState<"faturas" | "gateway">("faturas");
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [invoicesBackedByDb, setInvoicesBackedByDb] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [refMonth, setRefMonth] = useState(currentYearMonth);
  const [statusFiltro, setStatusFiltro] = useState("todas");
  const [buscaFatura, setBuscaFatura] = useState("");
  const [runningBatch, setRunningBatch] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newInvoiceTenantId, setNewInvoiceTenantId] = useState("");
  const [newInvoiceMonth, setNewInvoiceMonth] = useState(currentYearMonth);
  const [newInvoiceAmount, setNewInvoiceAmount] = useState("");
  const [newInvoiceDueDate, setNewInvoiceDueDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [newInvoiceMethod, setNewInvoiceMethod] = useState("pix");
  const [newInvoiceNotes, setNewInvoiceNotes] = useState("");
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const [settleInvoice, setSettleInvoice] = useState<PlatformInvoice | null>(null);
  const [settleMethod, setSettleMethod] = useState("pix");
  const [settleRef, setSettleRef] = useState("");
  const [settleNotes, setSettleNotes] = useState("");
  const [settleSyncTenant, setSettleSyncTenant] = useState(true);
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState<string | null>(null);

  const [configuration, setConfiguration] = useState<BillingConfiguration | null>(null);
  const [form, setForm] = useState<BillingForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasPrivateCredential = useMemo(
    () =>
      Boolean(
        form.access_token.trim() ||
        form.secret_key.trim() ||
        form.client_secret.trim() ||
        form.webhook_secret.trim(),
      ),
    [form],
  );

  const setField = <K extends keyof BillingForm>(field: K, value: BillingForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.functions.invoke("platform-billing-config", {
      body: { action: "get" },
    });

    if (error) {
      setLoadError(
        "Não foi possível consultar a configuração. Confirme a sessão do Administrador Master e tente novamente.",
      );
      setLoading(false);
      return;
    }

    const saved = (data?.configuration ?? null) as BillingConfiguration | null;
    setConfiguration(saved);
    if (saved) {
      setForm((current) => ({
        ...current,
        provider: saved.provider,
        provider_other_name: saved.provider_other_name ?? "",
        environment: saved.environment,
        account_name: saved.account_name,
        account_reference: saved.account_reference ?? "",
        account_email: saved.account_email ?? "",
        client_id: saved.client_id ?? "",
        public_key: saved.public_key ?? "",
        access_token: "",
        secret_key: "",
        client_secret: "",
        webhook_secret: "",
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  const tenantNameById = useMemo(
    () => new Map(tenants.map((t) => [t.id, t.trade_name || t.name])),
    [tenants],
  );

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    const { data, error } = await supabase
      .from("platform_invoices")
      .select("*")
      .order("due_date", { ascending: false })
      .limit(300);

    if (error) {
      setInvoices([]);
      setInvoicesBackedByDb(false);
    } else {
      setInvoices((data ?? []) as PlatformInvoice[]);
      setInvoicesBackedByDb(true);
    }
    setInvoicesLoading(false);
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const resumoFaturas = useMemo(() => resumirFinanceiroFaturas(invoices), [invoices]);
  const faturasFiltradas = useMemo(
    () =>
      filtrarFaturasMaster(invoices, { status: statusFiltro, busca: buscaFatura }, tenantNameById),
    [invoices, statusFiltro, buscaFatura, tenantNameById],
  );
  const blockedCount = useMemo(
    () => tenants.filter((t) => t.commercial_status === "blocked_billing").length,
    [tenants],
  );

  async function gerarMensalidadesMes() {
    setRunningBatch(true);
    const { data, error } = await supabase.rpc("generate_monthly_platform_invoices", {
      p_reference_month: refMonth,
    });
    setRunningBatch(false);
    if (error) {
      toast.error(error.message || "Não foi possível gerar as mensalidades.");
      return;
    }
    const generated =
      data && typeof data === "object" && !Array.isArray(data)
        ? Number((data as { generated_count?: number }).generated_count ?? 0)
        : 0;
    toast.success(
      generated > 0
        ? `${generated} fatura(s) gerada(s) para ${refMonth}.`
        : `Nenhuma nova fatura pendente para ${refMonth} (todas já emitidas ou sem mensalidade > 0).`,
    );
    await loadInvoices();
  }

  async function sincronizarVencidas(bloquearInadimplentes: boolean) {
    setRunningBatch(true);
    const { data, error } = await supabase.rpc("sync_overdue_platform_invoices", {
      p_block_delinquent_tenants: bloquearInadimplentes,
    });
    setRunningBatch(false);
    if (error) {
      toast.error(error.message || "Não foi possível sincronizar faturas vencidas.");
      return;
    }
    const payload = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as {
      overdue_marked?: number;
      tenants_blocked?: number;
    };
    toast.success(
      `Sincronização concluída: ${payload.overdue_marked ?? 0} fatura(s) em atraso` +
        (bloquearInadimplentes
          ? ` e ${payload.tenants_blocked ?? 0} Secretaria(s) bloqueada(s).`
          : "."),
    );
    await loadInvoices();
    if (bloquearInadimplentes) await onBillingChanged?.();
  }

  function abrirNovaFatura() {
    const defaultTenant = tenants.find((t) => t.commercial_status === "active") ?? tenants[0];
    setNewInvoiceTenantId(defaultTenant?.id ?? "");
    setNewInvoiceMonth(refMonth);
    setNewInvoiceAmount(defaultTenant ? String(Number(defaultTenant.monthly_fee ?? 0)) : "");
    setNewInvoiceDueDate(new Date().toISOString().slice(0, 10));
    setNewInvoiceMethod("pix");
    setNewInvoiceNotes("");
    setCreateOpen(true);
  }

  async function criarFaturaAvulsa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newInvoiceTenantId) {
      toast.error("Selecione a Secretaria.");
      return;
    }
    const amount = Number(newInvoiceAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    setCreatingInvoice(true);
    const { error } = await supabase.rpc("create_platform_invoice", {
      p_tenant_id: newInvoiceTenantId,
      p_reference_month: newInvoiceMonth,
      p_amount: amount,
      p_due_date: newInvoiceDueDate,
      p_payment_method: newInvoiceMethod,
      p_notes: newInvoiceNotes.trim() || null,
    });
    setCreatingInvoice(false);
    if (error) {
      toast.error(error.message || "Não foi possível criar a fatura.");
      return;
    }
    toast.success("Fatura emitida com sucesso.");
    setCreateOpen(false);
    await loadInvoices();
  }

  function abrirBaixaPagamento(invoice: PlatformInvoice) {
    setSettleInvoice(invoice);
    setSettleMethod(invoice.payment_method || "pix");
    setSettleRef(invoice.external_reference ?? "");
    setSettleNotes(invoice.notes ?? "");
    setSettleSyncTenant(true);
  }

  async function confirmarBaixaPagamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settleInvoice) return;
    setUpdatingInvoiceId(settleInvoice.id);
    const { error } = await supabase.rpc("update_platform_invoice_status", {
      p_invoice_id: settleInvoice.id,
      p_status: "paid",
      p_payment_method: settleMethod,
      p_external_reference: settleRef.trim() || null,
      p_notes: settleNotes.trim() || null,
      p_sync_tenant_status: settleSyncTenant,
    });
    setUpdatingInvoiceId(null);
    if (error) {
      toast.error(error.message || "Não foi possível registrar a baixa da fatura.");
      return;
    }
    toast.success("Pagamento confirmado e histórico atualizado.");
    setSettleInvoice(null);
    await loadInvoices();
    await onBillingChanged?.();
  }

  async function alterarStatusFatura(
    invoice: PlatformInvoice,
    nextStatus: "overdue" | "cancelled",
  ) {
    setUpdatingInvoiceId(invoice.id);
    const { error } = await supabase.rpc("update_platform_invoice_status", {
      p_invoice_id: invoice.id,
      p_status: nextStatus,
      p_sync_tenant_status: nextStatus === "overdue",
    });
    setUpdatingInvoiceId(null);
    if (error) {
      toast.error(error.message || "Não foi possível atualizar o status da fatura.");
      return;
    }
    toast.success(
      nextStatus === "overdue"
        ? "Fatura marcada em atraso e inadimplência sincronizada."
        : "Fatura cancelada.",
    );
    await loadInvoices();
    if (nextStatus === "overdue") await onBillingChanged?.();
  }

  const saveConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.provider) {
      toast.error("Escolha o provedor quando decidir qual conta será vinculada.");
      return;
    }
    if (!form.account_name.trim()) {
      toast.error("Informe o nome da conta de cobrança.");
      return;
    }
    if (form.provider === "other" && !form.provider_other_name.trim()) {
      toast.error("Informe o nome do provedor.");
      return;
    }
    if (!configuration?.has_credentials && !hasPrivateCredential) {
      toast.error("Informe o token ou a chave privada antes de salvar.");
      return;
    }
    if (
      configuration?.has_credentials &&
      (configuration.provider !== form.provider ||
        configuration.environment !== form.environment) &&
      !hasPrivateCredential
    ) {
      toast.error("Informe novamente a credencial privada ao trocar de provedor ou ambiente.");
      return;
    }

    const credentials = {
      ...(form.access_token.trim() ? { access_token: form.access_token.trim() } : {}),
      ...(form.secret_key.trim() ? { secret_key: form.secret_key.trim() } : {}),
      ...(form.client_secret.trim() ? { client_secret: form.client_secret.trim() } : {}),
      ...(form.webhook_secret.trim() ? { webhook_secret: form.webhook_secret.trim() } : {}),
    };

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("platform-billing-config", {
      body: {
        action: "save",
        provider: form.provider,
        provider_other_name: form.provider === "other" ? form.provider_other_name.trim() : null,
        environment: form.environment,
        account_name: form.account_name.trim(),
        account_reference: form.account_reference.trim() || null,
        account_email: form.account_email.trim() || null,
        client_id: form.client_id.trim() || null,
        public_key: form.public_key.trim() || null,
        credentials: Object.keys(credentials).length ? credentials : undefined,
      },
    });

    setSaving(false);
    if (error || !data?.saved) {
      const message =
        typeof data?.error === "string"
          ? data.error
          : "Não foi possível salvar as credenciais. Confira os campos e tente novamente.";
      toast.error(message);
      return;
    }

    toast.success("Conta de cobrança cadastrada com segurança.");
    setForm((current) => ({
      ...current,
      access_token: "",
      secret_key: "",
      client_secret: "",
      webhook_secret: "",
    }));
    await loadConfiguration();
  };

  const disconnect = async () => {
    setDisconnecting(true);
    const { data, error } = await supabase.functions.invoke("platform-billing-config", {
      body: { action: "disconnect" },
    });
    setDisconnecting(false);

    if (error || !data?.result?.disconnected) {
      toast.error("Não foi possível desconectar a conta de cobrança.");
      return;
    }

    setConfirmDisconnect(false);
    toast.success("Credenciais privadas removidas do cofre.");
    setConfiguration((data.configuration ?? null) as BillingConfiguration | null);
    setForm(EMPTY_FORM);
  };

  const credentialLabels =
    form.provider === "mercado_pago"
      ? {
          access_token: "Access Token privado",
          secret_key: "Chave secreta adicional (opcional)",
          client_secret: "Client Secret (opcional)",
          webhook_secret: "Segredo de assinatura do webhook (opcional)",
        }
      : form.provider === "stripe"
        ? {
            access_token: "Token de acesso (opcional)",
            secret_key: "Secret Key privada",
            client_secret: "Client Secret (opcional)",
            webhook_secret: "Webhook signing secret (opcional)",
          }
        : {
            access_token: "Token de acesso privado",
            secret_key: "Chave secreta privada",
            client_secret: "Client Secret (opcional)",
            webhook_secret: "Segredo de webhook (opcional)",
          };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Cobrança, Faturas e Gateway</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Gere mensalidades por competência, acompanhe baixas de pagamento e controle a
            inadimplência das Secretarias ou configure a conta do gateway de pagamento.
          </p>
        </div>
      </div>

      <Tabs
        value={billingTab}
        onValueChange={(value) => setBillingTab(value as "faturas" | "gateway")}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="faturas" className="gap-2">
            <Receipt className="h-4 w-4" aria-hidden />
            Faturas e inadimplência
          </TabsTrigger>
          <TabsTrigger value="gateway" className="gap-2">
            <CreditCard className="h-4 w-4" aria-hidden />
            Gateway e credenciais (Cofre)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="faturas" className="space-y-6">
          {!invoicesBackedByDb && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Aguardando migration de faturas no banco</AlertTitle>
              <AlertDescription>
                Para ativar a geração de mensalidades e baixas no Supabase, aplique a migration SQL{" "}
                <code>20261124140000_platform_invoices_and_billing_cycle.sql</code> no projeto.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recebido (Pagas)
                </CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{formatMoney(resumoFaturas.totalPaid)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resumoFaturas.countPaid} fatura(s) quitada(s)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  A receber (Pendentes)
                </CardTitle>
                <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{formatMoney(resumoFaturas.totalPending)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resumoFaturas.countPending} fatura(s) em aberto
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Em atraso (Vencidas)
                </CardTitle>
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-destructive">
                  {formatMoney(resumoFaturas.totalOverdue)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resumoFaturas.countOverdue} fatura(s) vencida(s)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Bloqueados por cobrança
                </CardTitle>
                <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{blockedCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  reativação automática ao dar baixa
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="billing-ref-month" className="text-xs">
                  Competência
                </Label>
                <Input
                  id="billing-ref-month"
                  type="month"
                  value={refMonth}
                  onChange={(e) => setRefMonth(e.target.value)}
                  className="h-9 w-[160px]"
                />
              </div>
              <Button
                onClick={() => void gerarMensalidadesMes()}
                disabled={runningBatch || !invoicesBackedByDb}
              >
                {runningBatch && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gerar mensalidades do mês
              </Button>
              <Button
                variant="outline"
                onClick={() => void sincronizarVencidas(false)}
                disabled={runningBatch || !invoicesBackedByDb}
              >
                Verificar vencidas
              </Button>
              <Button
                variant="outline"
                onClick={() => void sincronizarVencidas(true)}
                disabled={runningBatch || !invoicesBackedByDb}
              >
                Bloquear inadimplentes
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={abrirNovaFatura}
                disabled={!invoicesBackedByDb || tenants.length === 0}
              >
                <FilePlus2 className="mr-2 h-4 w-4" aria-hidden />
                Nova fatura avulsa
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void loadInvoices()}
                disabled={invoicesLoading}
                aria-label="Atualizar faturas"
              >
                <RefreshCw className={`h-4 w-4 ${invoicesLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={buscaFatura}
                onChange={(e) => setBuscaFatura(e.target.value)}
                placeholder="Buscar por Secretaria, referência ou mês..."
                className="pl-9"
              />
            </div>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos os status</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="overdue">Em atraso</SelectItem>
                <SelectItem value="paid">Pagas</SelectItem>
                <SelectItem value="cancelled">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Secretaria</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Forma / Ref.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {faturasFiltradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {invoices.length === 0
                        ? "Nenhuma fatura emitida ainda. Clique em 'Gerar mensalidades do mês' ou 'Nova fatura avulsa'."
                        : "Nenhuma fatura corresponde aos filtros selecionados."}
                    </TableCell>
                  </TableRow>
                ) : (
                  faturasFiltradas.map((inv) => {
                    const busy = updatingInvoiceId === inv.id;
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          {tenantNameById.get(inv.tenant_id) ?? inv.tenant_id}
                        </TableCell>
                        <TableCell className="tabular-nums">{inv.reference_month}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatShortDate(inv.due_date)}
                        </TableCell>
                        <TableCell className="tabular-nums font-medium">
                          {formatMoney(inv.amount)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {PAYMENT_METHOD_LABELS[inv.payment_method] ?? inv.payment_method}
                          {inv.external_reference ? ` · ${inv.external_reference}` : ""}
                        </TableCell>
                        <TableCell>
                          <Badge variant={invoiceStatusVariant(inv.status)}>
                            {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {(inv.status === "pending" || inv.status === "overdue") && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => abrirBaixaPagamento(inv)}
                                >
                                  Dar baixa
                                </Button>
                                {inv.status === "pending" && (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={busy}
                                    onClick={() => void alterarStatusFatura(inv, "overdue")}
                                  >
                                    Atraso
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => void alterarStatusFatura(inv, "cancelled")}
                                >
                                  Cancelar
                                </Button>
                              </>
                            )}
                            {inv.status === "paid" && (
                              <span className="text-xs text-muted-foreground">
                                Pago em {formatDate(inv.paid_at)}
                              </span>
                            )}
                            {inv.status === "cancelled" && (
                              <span className="text-xs text-muted-foreground">Cancelada</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="gateway" className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">
                Conta de recebimento da plataforma
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Cadastre as credenciais do provedor (Mercado Pago, Stripe ou outro) no Supabase
                Vault para futura automatização de links e webhooks.
              </p>
            </div>
            <Button variant="outline" onClick={() => void loadConfiguration()} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar
            </Button>
          </div>

          <Alert>
            <LockKeyhole className="h-4 w-4" />
            <AlertTitle>Cobranças desativadas nesta etapa</AlertTitle>
            <AlertDescription>
              Este cadastro guarda as credenciais com criptografia no Supabase Vault. Ele ainda não
              cria cobranças, assinaturas, links de pagamento ou webhooks. A ativação ficará para
              uma etapa própria, depois da escolha e homologação do provedor.
            </AlertDescription>
          </Alert>

          {loadError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Configuração indisponível</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          {configuration && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CreditCard className="h-4 w-4" />
                      Conta cadastrada
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {providerLabel(configuration.provider, configuration.provider_other_name)} ·{" "}
                      {configuration.environment === "sandbox" ? "Ambiente de teste" : "Produção"}
                    </CardDescription>
                  </div>
                  <Badge variant={configuration.has_credentials ? "secondary" : "outline"}>
                    {configuration.has_credentials ? "Credenciais guardadas" : "Desconectada"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Conta</p>
                  <p className="font-medium">{configuration.account_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Identificador</p>
                  <p className="font-medium">
                    {configuration.account_reference || "Não informado"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">E-mail</p>
                  <p className="font-medium">{configuration.account_email || "Não informado"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Última atualização</p>
                  <p className="font-medium">{formatDate(configuration.updated_at)}</p>
                </div>
                <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Nenhuma chave privada é exibida novamente depois de salva.
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {configuration ? "Editar ou substituir credenciais" : "Cadastrar conta"}
              </CardTitle>
              <CardDescription>
                Você poderá retornar a esta tela para trocar o provedor ou atualizar os tokens sem
                precisar enviá-los pelo chat.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração...
                </div>
              ) : (
                <form onSubmit={saveConfiguration} className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Provedor de pagamento</Label>
                      <Select
                        value={form.provider}
                        onValueChange={(value) => setField("provider", value as Provider)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione quando decidir" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mercado_pago">Mercado Pago</SelectItem>
                          <SelectItem value="stripe">Stripe</SelectItem>
                          <SelectItem value="other">Outro provedor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Ambiente</Label>
                      <Select
                        value={form.environment}
                        onValueChange={(value) => setField("environment", value as Environment)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o ambiente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sandbox">Teste / Sandbox</SelectItem>
                          <SelectItem value="production">Produção</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.provider === "other" && (
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="billing-provider-other">Nome do provedor</Label>
                        <Input
                          id="billing-provider-other"
                          value={form.provider_other_name}
                          maxLength={100}
                          onChange={(event) => setField("provider_other_name", event.target.value)}
                          required
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="billing-account-name">Nome da conta / titular</Label>
                      <Input
                        id="billing-account-name"
                        value={form.account_name}
                        maxLength={160}
                        onChange={(event) => setField("account_name", event.target.value)}
                        placeholder="Nome cadastrado no provedor"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-account-reference">ID da conta / Merchant ID</Label>
                      <Input
                        id="billing-account-reference"
                        value={form.account_reference}
                        maxLength={160}
                        onChange={(event) => setField("account_reference", event.target.value)}
                        placeholder="Identificador da conta no gateway"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-account-email">E-mail da conta</Label>
                      <Input
                        id="billing-account-email"
                        type="email"
                        value={form.account_email}
                        onChange={(event) => setField("account_email", event.target.value)}
                        placeholder="financeiro@empresa.com.br"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-client-id">Client ID (quando aplicável)</Label>
                      <Input
                        id="billing-client-id"
                        value={form.client_id}
                        maxLength={512}
                        onChange={(event) => setField("client_id", event.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="billing-public-key">
                        {form.provider === "stripe" ? "Publishable Key" : "Public Key"}
                      </Label>
                      <Input
                        id="billing-public-key"
                        value={form.public_key}
                        maxLength={1024}
                        onChange={(event) => setField("public_key", event.target.value)}
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Campo público do provedor. Nunca coloque aqui tokens privados ou chaves
                        secretas.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start gap-2">
                      <LockKeyhole className="mt-0.5 h-4 w-4 text-primary" />
                      <div>
                        <h3 className="text-sm font-semibold">Credenciais privadas</h3>
                        <p className="text-xs text-muted-foreground">
                          {configuration?.has_credentials
                            ? "Já existem credenciais no cofre. Deixe os campos vazios para manter as atuais; preencha somente o que deseja substituir."
                            : "Preencha o token ou a chave privada disponibilizada pelo seu provedor."}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="billing-access-token">
                          {credentialLabels.access_token}
                        </Label>
                        <Input
                          id="billing-access-token"
                          type="password"
                          value={form.access_token}
                          onChange={(event) => setField("access_token", event.target.value)}
                          autoComplete="new-password"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billing-secret-key">{credentialLabels.secret_key}</Label>
                        <Input
                          id="billing-secret-key"
                          type="password"
                          value={form.secret_key}
                          onChange={(event) => setField("secret_key", event.target.value)}
                          autoComplete="new-password"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billing-client-secret">
                          {credentialLabels.client_secret}
                        </Label>
                        <Input
                          id="billing-client-secret"
                          type="password"
                          value={form.client_secret}
                          onChange={(event) => setField("client_secret", event.target.value)}
                          autoComplete="new-password"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billing-webhook-secret">
                          {credentialLabels.webhook_secret}
                        </Label>
                        <Input
                          id="billing-webhook-secret"
                          type="password"
                          value={form.webhook_secret}
                          onChange={(event) => setField("webhook_secret", event.target.value)}
                          autoComplete="new-password"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Os valores privados são enviados diretamente à função administrativa e
                      armazenados no Vault criptografado. Não são gravados no perfil, no cadastro da
                      Secretaria, no log de auditoria ou no navegador após salvar.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {configuration?.has_credentials && (
                      <div className="space-y-2">
                        {!confirmDisconnect ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setConfirmDisconnect(true)}
                          >
                            <Unplug className="mr-2 h-4 w-4" /> Desconectar conta
                          </Button>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              Remover as credenciais do Vault?
                            </span>
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => void disconnect()}
                              disabled={disconnecting}
                            >
                              {disconnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Confirmar remoção
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setConfirmDisconnect(false)}
                              disabled={disconnecting}
                            >
                              Cancelar
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    <Button type="submit" disabled={saving || loading} className="ml-auto">
                      {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {configuration ? "Salvar configuração" : "Cadastrar conta"}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Pronto para a escolha futura do gateway</AlertTitle>
            <AlertDescription>
              O cadastro aceita Mercado Pago, Stripe ou outro provedor. A integração de API,
              validação de credenciais, webhooks, planos, assinaturas e recebimento de mensalidades
              será feita depois que você escolher o serviço. Até lá, você já pode controlar faturas
              e baixas na aba Faturas e inadimplência.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir fatura avulsa</DialogTitle>
            <DialogDescription>
              Registre uma mensalidade ou cobrança manual vinculada a uma Secretaria.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={criarFaturaAvulsa} className="space-y-4">
            <div className="space-y-2">
              <Label>Secretaria</Label>
              <Select
                value={newInvoiceTenantId}
                onValueChange={(value) => {
                  setNewInvoiceTenantId(value);
                  const found = tenants.find((t) => t.id === value);
                  if (found) setNewInvoiceAmount(String(Number(found.monthly_fee ?? 0)));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a Secretaria" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.trade_name || t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-inv-month">Competência</Label>
                <Input
                  id="new-inv-month"
                  type="month"
                  value={newInvoiceMonth}
                  onChange={(e) => setNewInvoiceMonth(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-inv-due">Vencimento</Label>
                <Input
                  id="new-inv-due"
                  type="date"
                  value={newInvoiceDueDate}
                  onChange={(e) => setNewInvoiceDueDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-inv-amount">Valor (R$)</Label>
                <Input
                  id="new-inv-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newInvoiceAmount}
                  onChange={(e) => setNewInvoiceAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Forma prevista</Label>
                <Select value={newInvoiceMethod} onValueChange={setNewInvoiceMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-inv-notes">Observações</Label>
              <Textarea
                id="new-inv-notes"
                rows={2}
                value={newInvoiceNotes}
                onChange={(e) => setNewInvoiceNotes(e.target.value)}
                placeholder="Ex.: Empenho nº, parcela de implantação..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={creatingInvoice}>
                {creatingInvoice && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Emitir fatura
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(settleInvoice)}
        onOpenChange={(open) => !open && setSettleInvoice(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar recebimento</DialogTitle>
            <DialogDescription>
              {settleInvoice
                ? `${tenantNameById.get(settleInvoice.tenant_id) ?? "Secretaria"} · ${settleInvoice.reference_month} (${formatMoney(settleInvoice.amount)})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={confirmarBaixaPagamento} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Meio de pagamento</Label>
                <Select value={settleMethod} onValueChange={setSettleMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settle-ref">Comprovante / Referência</Label>
                <Input
                  id="settle-ref"
                  value={settleRef}
                  onChange={(e) => setSettleRef(e.target.value)}
                  placeholder="ID PIX, boleto ou nota"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settle-notes">Observações</Label>
              <Textarea
                id="settle-notes"
                rows={2}
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="settle-reactivate" className="cursor-pointer">
                  Reativar Secretaria automaticamente
                </Label>
                <p className="text-xs text-muted-foreground">
                  Libera o acesso caso esteja bloqueada por cobrança e sem outras faturas vencidas.
                </p>
              </div>
              <Switch
                id="settle-reactivate"
                checked={settleSyncTenant}
                onCheckedChange={setSettleSyncTenant}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSettleInvoice(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={Boolean(updatingInvoiceId)}>
                {updatingInvoiceId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar pagamento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
