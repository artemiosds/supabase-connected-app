import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("SpecularButton institucional nos botões do Primus", () => {
  it("usa o efeito nos botões principais sem alterar tipo, clique ou estado desabilitado", () => {
    const click = vi.fn();
    render(
      <Button type="submit" onClick={click} disabled>
        Salvar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(button.className).toContain("primus-specular-button");
    expect(button.type).toBe("submit");
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });

  it("preserva o disparo do botão e os handlers de ponteiro existentes", () => {
    const click = vi.fn();
    const pointerMove = vi.fn();
    render(
      <Button onClick={click} onPointerMove={pointerMove}>
        Enviar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Enviar" });
    fireEvent.pointerMove(button, { pointerType: "mouse", clientX: 20, clientY: 10 });
    fireEvent.click(button);
    expect(pointerMove).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("preserva navegação de âncoras via asChild", () => {
    render(
      <Button asChild>
        <a href="/contratos?novo=1">Novo contrato</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Novo contrato" });
    expect(link.getAttribute("href")).toBe("/contratos?novo=1");
    expect(link.className).toContain("primus-specular-button");
  });

  it("inclui botões fantasma e somente ícone, preservando links textuais e opt-out", () => {
    render(
      <>
        <Button variant="ghost">Fechar</Button>
        <Button variant="link">Ajuda</Button>
        <Button size="icon" aria-label="Abrir menu">
          ≡
        </Button>
        <Button specular={false}>Sem efeito</Button>
      </>,
    );
    for (const name of ["Fechar", "Abrir menu"]) {
      expect(screen.getByRole("button", { name }).className).toContain("primus-specular-button");
    }
    for (const name of ["Ajuda", "Sem efeito"]) {
      expect(screen.getByRole("button", { name }).className).not.toContain(
        "primus-specular-button",
      );
    }
  });
});
