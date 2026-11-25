import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle";

const mockTheme = vi.hoisted(() => ({
  value: "system",
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mockTheme.value,
    setTheme: mockTheme.setTheme,
  }),
}));

describe("ThemeToggle: preferência visual do Primus", () => {
  beforeEach(() => {
    mockTheme.value = "system";
    mockTheme.setTheme.mockClear();
  });

  it("identifica o modo Sistema com ícone Monitor sem alterar o tema automaticamente", () => {
    const { container } = render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Selecionar tema. Atual: Sistema" })).toBeTruthy();
    expect(container.querySelector(".lucide-monitor")).toBeTruthy();
    expect(mockTheme.setTheme).not.toHaveBeenCalled();
  });

  it("exibe o ícone Moon quando a preferência persistida é Escuro", () => {
    mockTheme.value = "dark";
    const { container } = render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Selecionar tema. Atual: Escuro" })).toBeTruthy();
    expect(container.querySelector(".lucide-moon")).toBeTruthy();
  });

  it("mostra as três opções em português e envia a seleção ao ThemeProvider", async () => {
    render(<ThemeToggle />);
    const trigger = screen.getByRole("button", { name: /Selecionar tema/ });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const light = await screen.findByRole("menuitem", { name: "Claro" });
    const dark = screen.getByRole("menuitem", { name: "Escuro" });
    const system = screen.getByRole("menuitem", { name: "Sistema" });

    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(system.getAttribute("aria-current")).toBe("true");

    fireEvent.click(dark);
    expect(mockTheme.setTheme).toHaveBeenCalledWith("dark");
  });
});
