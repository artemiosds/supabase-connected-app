import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("has the public auth routes", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    for (const path of ["/entrar", "/cadastro", "/recuperar-senha", "/redefinir-senha"]) {
      const matches = router.matchRoutes(path);
      expect(matches.at(-1)?.routeId, `rota ${path}`).not.toBe(rootRouteId);
    }
  });

  it("has the authenticated pages under the _authenticated layout", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    for (const path of ["/painel", "/organizacoes", "/usuarios", "/configuracoes"]) {
      const matches = router.matchRoutes(path);
      const ids = matches.map((m) => m.routeId);
      expect(ids, `rota ${path}`).toContain("/_authenticated");
      expect(ids, `rota ${path}`).toContain(`/_authenticated${path}`);
    }
  });
});
