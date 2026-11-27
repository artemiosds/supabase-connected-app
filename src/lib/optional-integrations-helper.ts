// =============================================================================
// optional-integrations-helper.ts — Flags e URLs das Integrações Opcionais
// =============================================================================

export interface OptionalIntegrationsStatus {
  pncp_enabled: boolean;
  pncp_environment: "treinamento" | "producao";
  pncp_configured: boolean;
  govbr_enabled: boolean;
  govbr_environment: "homologacao" | "producao";
  govbr_configured: boolean;
  agu_assistant_enabled: boolean;
}

export const DEFAULT_OPTIONAL_INTEGRATIONS: OptionalIntegrationsStatus = {
  pncp_enabled: false,
  pncp_environment: "treinamento",
  pncp_configured: false,
  govbr_enabled: false,
  govbr_environment: "homologacao",
  govbr_configured: false,
  agu_assistant_enabled: false,
};

export function govbrOAuthBaseUrl(environment: "homologacao" | "producao"): string {
  return environment === "producao"
    ? "https://sso.acesso.gov.br"
    : "https://sso.staging.acesso.gov.br";
}

export function gerarUrlAutorizacaoGovBr(params: {
  environment: "homologacao" | "producao";
  clientId: string;
  redirectUri: string;
  state: string;
}): string | null {
  const clientId = params.clientId.trim();
  const redirectUri = params.redirectUri.trim();
  const state = params.state.trim();
  if (!clientId || !redirectUri || !state) return null;

  try {
    const parsedRedirect = new URL(redirectUri);
    if (
      parsedRedirect.protocol !== "https:" &&
      parsedRedirect.hostname !== "localhost" &&
      parsedRedirect.hostname !== "127.0.0.1"
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const base = govbrOAuthBaseUrl(params.environment);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "openid email profile govbr_confiabilidades",
    redirect_uri: redirectUri,
    state,
  });
  return `${base}/authorize?${query.toString()}`;
}
