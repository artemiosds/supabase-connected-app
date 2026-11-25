import { describe, expect, it } from "vitest";
import { buildSafeChartStyleCss } from "./chart";

describe("chart css sanitization", () => {
  it("gera CSS válido para identificadores e cores seguras", () => {
    const css = buildSafeChartStyleCss("chart-financeiro_1", {
      receita: { color: "hsl(var(--primary))" },
      despesa: { theme: { light: "#dc2626", dark: "rgb(248, 113, 113)" } },
    });

    expect(css).toContain("[data-chart=chart-financeiro_1]");
    expect(css).toContain("--color-receita: hsl(var(--primary));");
    expect(css).toContain("--color-despesa: #dc2626;");
  });

  it("bloqueia injeção de CSS no id, na chave ou no valor de cor", () => {
    expect(
      buildSafeChartStyleCss("evil]{}*{background:red}", {
        a: { color: "#000" },
      }),
    ).toBeNull();

    const sanitized = buildSafeChartStyleCss("chart-ok", {
      "bad;key": { color: "#000" },
      evilColor: { color: "red; }</style><script>alert(1)</script>" },
      safe: { color: "#16a34a" },
    });

    expect(sanitized).toContain("--color-safe: #16a34a;");
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("bad;key");
    expect(sanitized).not.toContain("evilColor");
  });
});
