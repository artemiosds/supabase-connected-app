import { describe, expect, it } from "vitest";
import type { CnpjLookupData } from "../../supabase/functions/_shared/cnpj-mapping";
import {
  calcularVagasUsuarios,
  filtrarConvites,
  listarModulosHabilitados,
  mesclarDadosCnpjOrganizacao,
  montarSugestaoTimbrado,
  podeAlterarStatusMembro,
  traduzirPlanoComercial,
  traduzirStatusComercial,
} from "./tenant-settings-helpers";

const EMPTY_CNPJ_LOOKUP: CnpjLookupData = {
  cnpj: "05131081000182",
  legal_name: "FUNDO MUNICIPAL DE SAUDE",
  trade_name: null,
  street: "Rua 15 de Novembro",
  street_number: "120",
  complement: null,
  neighborhood: "Centro",
  postal_code: "68270000",
  city: "Oriximiná",
  state: "pa",
  contact_phone: "(93) 3544-1000",
  contact_email: "saude@oriximina.pa.gov.br",
  website: null,
  registration_status: "ATIVA",
  registration_status_date: null,
  registration_status_reason: null,
  opening_date: null,
  legal_nature: null,
  company_size: null,
  share_capital: null,
  main_activity: null,
  secondary_activities: [],
  partners: [],
  source: "BrasilAPI",
  sources: ["BrasilAPI"],
  consulted_at: "2026-11-26T10:00:00Z",
};

describe("tenant-settings-helpers: Organização e Usuários", () => {
  it("traduz plano, status e módulos habilitados", () => {
    expect(traduzirPlanoComercial("enterprise")).toBe("Enterprise");
    expect(traduzirStatusComercial("trial")).toBe("Demonstração");
    expect(listarModulosHabilitados({ fornecedores: true, ged: false, pca: true })).toEqual([
      "Fornecedores",
      "PCA",
    ]);
  });

  it("mescla dados da Receita Federal apenas nos campos vazios", () => {
    const merged = mesclarDadosCnpjOrganizacao(
      {
        cnpj: "05.131.081/0001-82",
        contact_email: "manual@orgao.gov.br",
        contact_phone: "",
        street: "",
        municipality: "",
        state: "",
      },
      EMPTY_CNPJ_LOOKUP,
    );
    expect(merged.contact_email).toBe("manual@orgao.gov.br");
    expect(merged.contact_phone).toBe("(93) 3544-1000");
    expect(merged.street).toBe("Rua 15 de Novembro, 120, Centro");
    expect(merged.municipality).toBe("Oriximiná");
    expect(merged.state).toBe("PA");
  });

  it("monta sugestão de subtítulo e rodapé para timbrado oficial", () => {
    const sugestao = montarSugestaoTimbrado("Secretaria de Saúde", {
      cnpj: "05.131.081/0001-82",
      contact_email: "saude@orgao.gov.br",
      contact_phone: "(93) 3544-1000",
      street: "Av. Central, 10",
      municipality: "Oriximiná",
      state: "pa",
    });
    expect(sugestao.header_subtitle).toContain("Oriximiná/PA");
    expect(sugestao.footer_text).toContain("CNPJ: 05.131.081/0001-82");
  });

  it("calcula vagas ocupadas, disponíveis e limite atingido", () => {
    expect(calcularVagasUsuarios(20, 17, 3)).toEqual({
      limite: 20,
      ocupadas: 20,
      disponiveis: 0,
      atingido: true,
    });
    expect(calcularVagasUsuarios(null, 5, 1).limite).toBeNull();
  });

  it("permite reativar usuário suspenso com users:edit ou users:delete", () => {
    expect(podeAlterarStatusMembro("active", { can_edit: true, can_suspend: false })).toBe(false);
    expect(podeAlterarStatusMembro("suspended", { can_edit: true, can_suspend: false })).toBe(true);
  });

  it("filtra convites por e-mail e situação incluindo expirados", () => {
    const items = [
      { invited_email: "ana@saude.gov.br", status: "pending", expires_at: "2099-01-01T00:00:00Z" },
      {
        invited_email: "pedro@saude.gov.br",
        status: "pending",
        expires_at: "2020-01-01T00:00:00Z",
      },
      {
        invited_email: "maria@saude.gov.br",
        status: "accepted",
        expires_at: "2099-01-01T00:00:00Z",
      },
    ];
    expect(filtrarConvites(items, "pedro", "expired")).toHaveLength(1);
    expect(filtrarConvites(items, "", "pending")).toHaveLength(1);
    expect(filtrarConvites(items, "saude.gov.br", "todos")).toHaveLength(3);
  });
});
