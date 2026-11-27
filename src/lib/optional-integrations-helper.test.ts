import { describe, expect, it } from "vitest";
import { gerarUrlAutorizacaoGovBr, govbrOAuthBaseUrl } from "./optional-integrations-helper";

describe("optional-integrations-helper", () => {
  it("seleciona o host Gov.br correto para homologação e produção", () => {
    expect(govbrOAuthBaseUrl("homologacao")).toBe("https://sso.staging.acesso.gov.br");
    expect(govbrOAuthBaseUrl("producao")).toBe("https://sso.acesso.gov.br");
  });

  it("gera URL OAuth2 do Gov.br apenas quando redirect_uri é seguro", () => {
    const url = gerarUrlAutorizacaoGovBr({
      environment: "producao",
      clientId: "client-123",
      redirectUri: "https://app.municipio.gov.br/callback",
      state: "doc-abc",
    });
    expect(url).toContain("https://sso.acesso.gov.br/authorize?");
    expect(url).toContain("client_id=client-123");
    expect(url).toContain("govbr_confiabilidades");

    expect(
      gerarUrlAutorizacaoGovBr({
        environment: "producao",
        clientId: "client-123",
        redirectUri: "http://inseguro.com/cb",
        state: "doc-abc",
      }),
    ).toBeNull();
  });
});
