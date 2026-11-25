import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/integrations/supabase/types";
import { DocumentViewerSheet } from "./document-viewer-sheet";

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

function criarDocumento(
  overrides: Partial<Tables<"generated_documents">> = {},
): Tables<"generated_documents"> {
  return {
    content_snapshot: "TERMO DE REFERÊNCIA Nº 012/2026\nObjeto: Aquisição de insumos.",
    contract_id: null,
    created_at: "2026-11-25T14:30:00.000Z",
    created_by: "user-1",
    document_type: "termo_referencia",
    id: "doc-1",
    process_id: "proc-1",
    process_snapshot: {},
    signature_statement: null,
    signed_at: null,
    signed_by: null,
    signed_content_sha256: null,
    signed_email: null,
    signed_name: null,
    signed_pdf_mime_type: null,
    signed_pdf_sha256: null,
    signed_pdf_size: null,
    signed_pdf_storage_path: null,
    status: "draft",
    supplier_id: null,
    template_id: "tpl-1",
    template_version: 1,
    tenant_id: "tenant-1",
    title: "Termo de Referência — Processo 012/2026",
    updated_at: "2026-11-25T14:30:00.000Z",
    updated_by: "user-1",
    variables_snapshot: {},
    ...overrides,
  };
}

describe("DocumentViewerSheet", () => {
  const writeTextMock = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
    writeTextMock.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza o título, badge de status, tipo e data formatada", () => {
    const doc = criarDocumento({ status: "draft" });
    render(<DocumentViewerSheet documento={doc} aberto onOpenChange={vi.fn()} />);

    expect(screen.getByText("Termo de Referência — Processo 012/2026")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByText("termo_referencia")).toBeInTheDocument();
    expect(
      screen.getByText(`Criado em ${new Date(doc.created_at).toLocaleString("pt-BR")}`),
    ).toBeInTheDocument();
  });

  it("renderiza o conteúdo do documento e estado vazio amigável quando sem snapshot", () => {
    const doc = criarDocumento();
    const { rerender } = render(
      <DocumentViewerSheet documento={doc} aberto onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText(/TERMO DE REFERÊNCIA Nº 012\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Objeto: Aquisição de insumos\./)).toBeInTheDocument();

    rerender(
      <DocumentViewerSheet
        documento={criarDocumento({ content_snapshot: "   " })}
        aberto
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Nenhum conteúdo registrado para este documento.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar Texto" })).toBeDisabled();
  });

  it("exibe os dados da assinatura eletrônica e hash SHA-256 quando status for signed", async () => {
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const doc = criarDocumento({
      status: "signed",
      signed_name: "Maria Oliveira",
      signed_email: "maria@saude.gov.br",
      signed_at: "2026-11-25T16:00:00.000Z",
      signed_pdf_sha256: sha256,
    });

    render(<DocumentViewerSheet documento={doc} aberto onOpenChange={vi.fn()} />);

    expect(screen.getByText("Assinado eletronicamente")).toBeInTheDocument();
    expect(screen.getByText(/Maria Oliveira \(maria@saude\.gov\.br\)/)).toBeInTheDocument();
    expect(screen.getByText(sha256)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copiar SHA-256" }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(sha256);
    });
  });

  it("dispara os callbacks onImprimir, onBaixarDocx e onBaixarPdf nos botões respectivos", () => {
    const onOpenChange = vi.fn();
    const onImprimir = vi.fn();
    const onBaixarDocx = vi.fn();
    const onBaixarPdf = vi.fn();
    const docDraft = criarDocumento({ status: "draft" });

    const { rerender } = render(
      <DocumentViewerSheet
        documento={docDraft}
        aberto
        onOpenChange={onOpenChange}
        onImprimir={onImprimir}
        onBaixarDocx={onBaixarDocx}
        onBaixarPdf={onBaixarPdf}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Baixar Word" }));
    expect(onBaixarDocx).toHaveBeenCalledWith(docDraft);

    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    expect(onBaixarPdf).toHaveBeenCalledWith(docDraft);

    fireEvent.click(screen.getByRole("button", { name: "Imprimir / Visualizar Impressão" }));
    expect(onImprimir).toHaveBeenCalledWith(docDraft);

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <DocumentViewerSheet
        documento={criarDocumento({ status: "cancelled" })}
        aberto
        onOpenChange={onOpenChange}
        onBaixarDocx={onBaixarDocx}
      />,
    );

    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Baixar Word" })).not.toBeInTheDocument();
  });

  it("copia o conteúdo para o clipboard e exibe notificação ao clicar em Copiar Texto", async () => {
    const doc = criarDocumento({ content_snapshot: "Minuta completa do edital." });
    render(<DocumentViewerSheet documento={doc} aberto onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar Texto" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("Minuta completa do edital.");
      expect(mockToastSuccess).toHaveBeenCalledWith("Texto do documento copiado!");
    });
  });

  it("aceita objeto leve DocumentoParaVisualizar com propriedade content", () => {
    render(
      <DocumentViewerSheet
        documento={{
          id: "dossie-tce-1",
          title: "Dossiê TCE - Contrato nº 001/2026",
          status: "signed",
          content: "Relatório resumido de execução contratual.",
          created_at: "2026-11-25T15:00:00.000Z",
        }}
        aberto
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Dossiê TCE - Contrato nº 001/2026")).toBeInTheDocument();
    expect(screen.getByText("Relatório resumido de execução contratual.")).toBeInTheDocument();
    expect(screen.queryByText("Dados da assinatura eletrônica")).not.toBeInTheDocument();
  });
});
