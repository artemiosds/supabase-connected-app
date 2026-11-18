import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileText, Plus } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AnimatedList, FlowingMenu } from "./primus-motion";

describe("componentes de movimento institucional", () => {
  it("preserva a lista de tarefas, o rótulo acessível e os links reais", () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedList, {
        items: [{ id: "processo-1", title: "Processo nº 11/2026" }],
        ariaLabel: "Pendências sob sua responsabilidade",
        renderItem: (item: { id: string; title: string }) =>
          createElement("a", { href: "/processos?processo=1" }, item.title),
      }),
    );
    expect(html).toContain('aria-label="Pendências sob sua responsabilidade"');
    expect(html).toContain("Processo nº 11/2026");
    expect(html).toContain('href="/processos?processo=1"');
    expect(html).toContain("<li");
  });

  it("mantém acessíveis as ações permitidas sem criar itens fictícios", () => {
    const html = renderToStaticMarkup(
      createElement(FlowingMenu, {
        ariaLabel: "Ações rápidas da Secretaria",
        items: [
          {
            id: "dfd",
            text: "Nova demanda (DFD)",
            description: "Criar",
            href: "/processos?novo=dfd",
            icon: Plus,
          },
          {
            id: "documentos",
            text: "Documentos",
            description: "Consultar",
            href: "/documentos",
            icon: FileText,
          },
        ],
      }),
    );
    expect(html).toContain('aria-label="Ações rápidas da Secretaria"');
    expect(html).toContain('href="/processos?novo=dfd"');
    expect(html).toContain('href="/documentos"');
    expect(html).not.toContain("unsplash.com");
  });

  it("não renderiza atalhos ausentes", () => {
    const html = renderToStaticMarkup(createElement(FlowingMenu, { items: [] }));
    expect(html).toBe("");
  });
});
