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

async function loadRecords(tenant: string, supplier: string, section: Section, page: number) {
  const from = page * size;
  const to = from + size;
  const today = new Date().toLocaleDateString("sv-SE");
  switch (section) {
    case "documents": {
      const { data, error } = await db
        .from("supplier_documents")
        .select("id,title,expires_at")
        .eq("tenant_id", tenant)
        .eq("supplier_id", supplier)
        .order("expires_at", { nullsFirst: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return data.map((d) => ({
        id: d.id,
        title: d.title,
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
        .select("id,source_name,reference_identifier,quoted_at,unit_price,quantity,is_active")
        .eq("tenant_id", tenant)
        .eq("supplier_id", supplier)
        .order("quoted_at", { ascending: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return data.map((q) => ({
        id: q.id,
        title: q.reference_identifier || q.source_name,
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
        title: (c.instrument_type === "ata_registro_precos" ? "Ata " : "Contrato ") + c.number,
        detail: [
          c.object,
          formatarData(c.start_date) + " a " + formatarData(c.end_date),
          formatarMoeda(c.total_value),
          c.status,
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
    ["Observações internas", supplier.notes],
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
              <Records tenant={supplier.tenant_id} supplier={supplier.id} section={s.key} />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
