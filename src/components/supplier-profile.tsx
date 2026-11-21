import { toast } from "sonner";
import { ExternalLink, Eye } from "lucide-react";
import { useTenant } from "@/hooks/use-tenant";
import { useRef } from "react";
import { SupplierDocumentMonitor } from "@/components/supplier-document-monitor";
import { parseSupplierVerification } from "@/lib/supplier-verification";
import { daysUntil } from "@/lib/supplier-document-monitor";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/db";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarData, formatarMoeda } from "@/lib/contratacao";
import { getSanctionDisplayStatus } from "@/lib/supplier-sanctions";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const sections = [
  { key: "documents", label: "Documentos", module: "documentos" },
  { key: "quotes", label: "Cotações", module: "processos" },
  { key: "contracts", label: "Contratos e atas", module: "contratos" },
  { key: "sanctions", label: "Sanções", module: "fornecedores" },
] as const;
type Section = (typeof sections)[number]["key"];
const size = 25;

type RecordRow = {
  id: string;
  title: string;
  detail: string;
  href?: string;
  selected?: boolean;
  storage?: string | null;
  external?: string | null;
};
async function loadRecords(
  tenant: string,
  supplier: string,
  section: Section,
  page: number,
): Promise<RecordRow[]> {
  const from = page * size;
  const to = from + size;
  const today = new Date().toLocaleDateString("sv-SE");
  switch (section) {
    case "documents": {
      const { data, error } = await db
        .from("supplier_documents")
        .select("id,title,expires_at,storage_path,external_url,status")
        .eq("tenant_id", tenant)
        .eq("supplier_id", supplier)
        .order("expires_at", { nullsFirst: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return data.map((d) => ({
        id: d.id,
        title: d.title,
        storage: d.status === "active" ? d.storage_path : null,
        external: d.status === "active" ? d.external_url : null,
        detail: d.expires_at
          ? (d.expires_at < today
              ? "Vencido em "
              : d.expires_at === today
                ? "Vence hoje · "
                : "Vence em ") + formatarData(d.expires_at)
          : "Sem vencimento informado",
      }));
    }
    case "quotes": {
      const { data, error } = await db
        .from("procurement_price_quotes")
        .select(
          "id,source_name,reference_identifier,quoted_at,unit_price,quantity,is_active,selected_for_estimate,procurement_items!inner(process_id)",
        )
        .eq("tenant_id", tenant)
        .eq("supplier_id", supplier)
        .order("quoted_at", { ascending: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return data.map((q) => ({
        id: q.id,
        title: q.reference_identifier || q.source_name,
        href: "/processos?processo=" + encodeURIComponent(q.procurement_items.process_id),
        selected: q.selected_for_estimate,
        detail: [
          formatarData(q.quoted_at),
          "Quantidade: " + q.quantity.toLocaleString("pt-BR"),
          "Unitário: " + formatarMoeda(q.unit_price),
          !q.is_active && "Inativa",
        ]
          .filter(Boolean)
          .join(" · "),
      }));
    }
    case "contracts": {
      const { data, error } = await db
        .from("contracts")
        .select("id,number,object,instrument_type,start_date,end_date,total_value,status")
        .eq("tenant_id", tenant)
        .eq("supplier_id", supplier)
        .order("end_date", { ascending: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return data.map((c) => ({
        id: c.id,
        href: "/contratos?contrato=" + encodeURIComponent(c.id),
        title: (c.instrument_type === "ata_registro_precos" ? "Ata " : "Contrato ") + c.number,
        detail: [
          c.object,
          formatarData(c.start_date) + " a " + formatarData(c.end_date),
          formatarMoeda(c.total_value),
          c.status,
          daysUntil(c.end_date) < 0
            ? "Vencido há " + -daysUntil(c.end_date) + " dia(s)"
            : daysUntil(c.end_date) + " dia(s) até o vencimento",
        ].join(" · "),
      }));
    }
    case "sanctions": {
      const { data, error } = await db
        .from("supplier_sanctions")
        .select("id,measure,reference_number,start_date,end_date,status")
        .eq("tenant_id", tenant)
        .eq("supplier_id", supplier)
        .order("start_date", { ascending: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return data.map((s) => ({
        id: s.id,
        title: s.measure,
        detail: [
          getSanctionDisplayStatus(s, today),
          s.reference_number,
          formatarData(s.start_date) +
            " a " +
            (s.end_date ? formatarData(s.end_date) : "prazo indeterminado"),
        ]
          .filter(Boolean)
          .join(" · "),
      }));
    }
  }
}

function Records({
  tenant,
  supplier,
  section,
}: {
  tenant: string;
  supplier: string;
  section: Section;
}) {
  const { session } = useAuth();
  const [page, setPage] = useState(0);
  const { selecionado } = useTenant();
  const activeTenant = useRef(selecionado?.id);
  activeTenant.current = selecionado?.id;
  const [opening, setOpening] = useState(false);
  async function openFile(row: RecordRow) {
    if (activeTenant.current !== tenant) return;
    if (row.external && !row.storage) {
      try {
        const url = new URL(row.external);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error();
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {
        toast.error("Endereço do arquivo inválido.");
      }
      return;
    }
    if (!row.storage || !row.storage.startsWith(tenant + "/")) return;
    setOpening(true);
    try {
      const { data, error } = await db.storage.from("gfs-private-documents").download(row.storage);
      if (error || !data) throw new Error();
      if (activeTenant.current !== tenant) return;
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = row.title;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      toast.error("Não foi possível abrir o arquivo com seu perfil.");
    } finally {
      setOpening(false);
    }
  }
  const q = useQuery({
    queryKey: ["supplier-profile", session?.user.id, tenant, supplier, section, page],
    queryFn: () => loadRecords(tenant, supplier, section, page),
    retry: false,
  });
  if (q.isPending) return <p role="status">Carregando registros…</p>;
  if (q.isError)
    return (
      <div role="alert">
        Não foi possível consultar esta seção.{" "}
        <Button variant="link" onClick={() => void q.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  return (
    <div className="space-y-3">
      {q.data.length ? (
        <ul className="divide-y">
          {q.data.slice(0, size).map((row) => (
            <li key={row.id} className="break-words py-2">
              <p className="font-medium">{row.title}</p>
              <p className="text-sm text-muted-foreground">{row.detail}</p>
              {row.selected && <Badge variant="outline">Selecionada para estimativa</Badge>}
              {row.href && (
                <Button asChild variant="outline" size="sm">
                  <a href={row.href}>
                    <ExternalLink className="h-4 w-4" />
                    {section === "quotes" ? "Abrir processo" : "Visualizar contrato / ata"}
                  </a>
                </Button>
              )}
              {(row.storage || row.external) && (
                <Button
                  type="button"
                  disabled={opening}
                  variant="outline"
                  size="sm"
                  onClick={() => void openFile(row)}
                >
                  <Eye className="h-4 w-4" />
                  Abrir arquivo
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhum registro disponível para seu perfil nesta página.</p>
      )}
      {(page > 0 || q.data.length > size) && (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span>Página {page + 1}</span>
          <Button
            variant="outline"
            disabled={q.data.length <= size}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

export function SupplierProfile({
  supplier,
  modules,
  category,
  onClose,
}: {
  supplier: Tables<"suppliers">;
  modules: Record<string, boolean>;
  category: string;
  onClose: () => void;
}) {
  const available = sections.filter((s) => s.key === "sanctions" || modules[s.module] === true);
  const fields = [
    ["Nome fantasia", supplier.trade_name],
    ["Categoria", category],
    ["Situação interna", supplier.status === "active" ? "Ativo" : "Inativo"],
    ["Pessoa de contato", supplier.contact_name],
    ["Telefone", supplier.contact_phone],
    ["E-mail", supplier.contact_email],
    [
      "Endereço",
      [
        supplier.street,
        supplier.street_number,
        supplier.complement,
        supplier.neighborhood,
        supplier.city,
        supplier.state,
        supplier.postal_code,
      ]
        .filter(Boolean)
        .join(", "),
    ],
    ["Site", supplier.website],
    ["Observações internas", parseSupplierVerification(supplier.notes).notes],
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">{supplier.legal_name}</DialogTitle>
          <DialogDescription>Ficha do fornecedor · {formatarCnpj(supplier.cnpj)}</DialogDescription>
        </DialogHeader>
        {parseSupplierVerification(supplier.notes).verification && (
          <p className="text-sm text-muted-foreground">
            Última consulta cadastral:{" "}
            {formatarData(parseSupplierVerification(supplier.notes).verification?.consultado_em)} ·{" "}
            {parseSupplierVerification(supplier.notes).verification?.situacao}
          </p>
        )}
        <Tabs defaultValue="registration">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="registration">Cadastro</TabsTrigger>
            {available.map((s) => (
              <TabsTrigger key={s.key} value={s.key}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="registration">
            <dl className="grid gap-3 py-2 sm:grid-cols-2">
              {fields
                .filter(([, v]) => v)
                .map(([label, v]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
            </dl>
          </TabsContent>
          {available.map((s) => (
            <TabsContent key={s.key} value={s.key}>
              {s.key === "documents" && (
                <div className="space-y-3">
                  <SupplierDocumentMonitor
                    tenantId={supplier.tenant_id}
                    supplierId={supplier.id}
                    category={supplier.category}
                  />
                  <Button asChild variant="outline">
                    <a href={"/documentos?fornecedor=" + supplier.id}>Gerenciar no módulo</a>
                  </Button>
                </div>
              )}
              <Records tenant={supplier.tenant_id} supplier={supplier.id} section={s.key} />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
