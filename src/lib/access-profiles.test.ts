import { describe, expect, it } from "vitest";
import {
  filtrarPermissaoPorTexto,
  gerarSlugPerfilPersonalizado,
  selecionarPapelPadraoConvite,
  traduzirModuloPermissao,
} from "./access-profiles";

describe("access-profiles: helpers de perfis de acesso e permissões", () => {
  it("traduz corretamente os módulos técnicos de permissão para PT-BR", () => {
    expect(traduzirModuloPermissao("audit")).toBe("Auditoria");
    expect(traduzirModuloPermissao("processes")).toBe("Processos e Preços");
    expect(traduzirModuloPermissao("suppliers")).toBe("Fornecedores");
    expect(traduzirModuloPermissao("users")).toBe("Usuários e Equipe");
    expect(traduzirModuloPermissao(null)).toBe("Outros");
  });

  it("nunca seleciona admin como padrão quando existir operator ou viewer", () => {
    const roles = [
      { id: "r-admin", slug: "admin" },
      { id: "r-manager", slug: "manager" },
      { id: "r-operator", slug: "operator" },
      { id: "r-viewer", slug: "viewer" },
    ];
    expect(selecionarPapelPadraoConvite(roles)).toBe("r-operator");

    const withoutOperator = [
      { id: "r-admin", slug: "admin" },
      { id: "r-viewer", slug: "viewer" },
    ];
    expect(selecionarPapelPadraoConvite(withoutOperator)).toBe("r-viewer");

    const onlyAdmin = [{ id: "r-admin", slug: "admin" }];
    expect(selecionarPapelPadraoConvite(onlyAdmin)).toBe("r-admin");
  });

  it("gera slug único e válido para perfil duplicado/personalizado", () => {
    const slug1 = gerarSlugPerfilPersonalizado("Pregoeiro / Agente", ["admin", "pregoeiro"]);
    expect(slug1).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug1).toBe("pregoeiro-agente-custom");

    const slug2 = gerarSlugPerfilPersonalizado("Gestor", ["gestor-custom", "gestor-custom-2"]);
    expect(slug2).toBe("gestor-custom-3");
  });

  it("filtra permissões por nome, descrição, código ou módulo traduzido", () => {
    const perm = {
      name: "Homologar preço",
      description: "Aprovar preço estimado",
      code: "procurement:approve_price",
      module: "processes",
    };
    expect(filtrarPermissaoPorTexto(perm, "preço")).toBe(true);
    expect(filtrarPermissaoPorTexto(perm, "processos")).toBe(true);
    expect(filtrarPermissaoPorTexto(perm, "approve_price")).toBe(true);
    expect(filtrarPermissaoPorTexto(perm, "fornecedor")).toBe(false);
  });
});
