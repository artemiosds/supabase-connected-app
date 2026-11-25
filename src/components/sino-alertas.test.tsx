import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SinoAlertas } from "./sino-alertas";

const { mockExtensionOpen, mockReplenishmentOpen, mockDbState } = vi.hoisted(() => ({
  mockExtensionOpen: vi.fn(),
  mockReplenishmentOpen: vi.fn(),
  mockDbState: {
    contracts: [
      {
        id: "ctr-1",
        number: "012/2026",
        object: "Fornecimento de medicamentos",
        start_date: "2026-01-01",
        end_date: "2026-12-01",
        total_value: 15000,
        status: "vigente",
        instrument_type: "contrato",
        suppliers: { legal_name: "Med Distribuidora Ltda", trade_name: "Med Dist" },
      },
    ],
    documents: [] as unknown[],
    followups: [] as Array<{ contract_id: string }>,
    items: [
      {
        id: "item-1",
        contract_id: "ctr-1",
        line_number: 1,
        description: "Dipirona 500mg",
        specification: null,
        unit: "AMPOLA",
        quantity_total: 100,
        unit_value: 2,
      },
    ],
    movements: [
      {
        contract_item_id: "item-1",
        movement_type: "consumption",
        quantity: 90,
      },
    ],
    amendments: [
      {
        id: "ad-1",
        number: "1º Termo Aditivo",
        kind: "prazo",
        signed_at: "2026-06-01",
        new_end_date: "2026-12-01",
      },
    ],
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/hooks/use-tenant", () => ({
  useTenant: () => ({ selecionado: { id: "tenant-1", nome: "SMS Teste" } }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));

vi.mock("@/components/contracts/contract-extension-dialog", () => ({
  ContractExtensionDialog: (props: {
    open: boolean;
    contrato: { number: string } | null;
    aditivosContrato: Array<{ number: string }>;
  }) => {
    if (props.open && props.contrato) {
      mockExtensionOpen({
        number: props.contrato.number,
        amendmentsCount: props.aditivosContrato.length,
      });
    }
    return props.open ? <div role="dialog">Diálogo Prorrogar {props.contrato?.number}</div> : null;
  },
}));

vi.mock("@/components/contracts/stock-replenishment-dialog", () => ({
  StockReplenishmentDialog: (props: {
    open: boolean;
    contract: { id: string; number: string };
    itensCriticos: Array<{ description: string }>;
  }) => {
    if (props.open) {
      mockReplenishmentOpen({
        contractId: props.contract.id,
        itemsCount: props.itensCriticos.length,
      });
    }
    return props.open ? <div role="dialog">Diálogo Reposição {props.contract.number}</div> : null;
  },
}));

function buildTableChain(table: string) {
  const resultMap: Record<string, unknown> = {
    contracts: mockDbState.contracts,
    supplier_documents: mockDbState.documents,
    contract_renewal_followups: mockDbState.followups,
    contract_items: mockDbState.items,
    contract_item_movements: mockDbState.movements,
    contract_amendments: mockDbState.amendments,
  };
  const payload = { data: resultMap[table] ?? [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "lte", "in", "order", "range", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain["then"] = (resolve: (val: unknown) => unknown) => Promise.resolve(payload).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  carregarTodasAsPaginas: async (
    fetcher: (from: number, to: number) => Promise<{ data: unknown[]; error: unknown }>,
  ) => {
    const res = await fetcher(0, 999);
    if (res.error) throw res.error;
    return res.data ?? [];
  },
  db: {
    from: (table: string) => buildTableChain(table),
    rpc: vi.fn(async () => ({
      data: [{ can_update: true, can_create: true }],
      error: null,
    })),
  },
}));

describe("SinoAlertas: ações diretas de prorrogação e reposição", () => {
  beforeEach(() => {
    mockExtensionOpen.mockClear();
    mockReplenishmentOpen.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("exibe alertas de saldo crítico e vencimento e abre os diálogos diretamente", async () => {
    render(<SinoAlertas />);

    const trigger = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Alertas de vencimento e saldo: 2/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });

    fireEvent.click(trigger);

    expect(await screen.findByText("Saldo crítico: Contrato nº 012/2026")).toBeInTheDocument();
    expect(screen.getByText("Contrato: Contrato nº 012/2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Gerar Reposição" }));
    await waitFor(() => {
      expect(mockReplenishmentOpen).toHaveBeenCalledWith({
        contractId: "ctr-1",
        itemsCount: 1,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Alertas de vencimento e saldo: 2/i }));
    const prorrogarBtn = await screen.findByRole("button", { name: "Prorrogar Vigência" });
    fireEvent.click(prorrogarBtn);

    await waitFor(() => {
      expect(mockExtensionOpen).toHaveBeenCalledWith({
        number: "012/2026",
        amendmentsCount: 1,
      });
    });
  });
});
