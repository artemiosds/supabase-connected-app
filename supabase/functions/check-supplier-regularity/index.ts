import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getAllowedOrigins } from "../_shared/origins.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CNPJ_DIGITS = /^\d{14}$/;

type RegularitySource = "rfb_cnpj" | "ceis_cgu" | "cnep_cgu" | "outro";
type RegularityStatus = "regular" | "irregular" | "pending_review" | "not_found";

type AutomatedCheckItem = {
  source: RegularitySource;
  sourceLabel: string;
  status: RegularityStatus;
  certificateNumber: string | null;
  evidenceUrl: string | null;
  notes: string;
  requiresAction: boolean;
  rawSituation: string;
};

function response(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "application/json",
    },
  });
}

function mapTcuSituation(situation: string): { status: RegularityStatus; requiresAction: boolean } {
  const norm = situation.trim().toUpperCase();
  if (norm === "NADA_CONSTA") return { status: "regular", requiresAction: false };
  if (norm === "CONSTA") return { status: "irregular", requiresAction: true };
  return { status: "pending_review", requiresAction: true };
}

function mapRfbSituation(situation: string): { status: RegularityStatus; requiresAction: boolean } {
  const norm = situation.trim().toUpperCase();
  if (norm === "ATIVA") return { status: "regular", requiresAction: false };
  if (norm.includes("BAIXAD") || norm.includes("INAPT") || norm.includes("SUSPENS") || norm.includes("NUL")) {
    return { status: "irregular", requiresAction: true };
  }
  return { status: "pending_review", requiresAction: true };
}

async function fetchTcuConsolidated(cnpj: string): Promise<{
  razaoSocial: string | null;
  checks: AutomatedCheckItem[];
  warning?: string;
}> {
  const url = `https://certidoes-apf.apps.tcu.gov.br/api/rest/publico/certidoes/${cnpj}?seEmitirPDF=false`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "PrimusGestao/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        razaoSocial: null,
        checks: [],
        warning: `Portal TCU respondeu HTTP ${res.status}.`,
      };
    }
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const certidoes = Array.isArray(payload?.["certidoes"]) ? payload["certidoes"] : [];
    const checks: AutomatedCheckItem[] = [];

    for (const raw of certidoes) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const tipo = typeof item["tipo"] === "string" ? item["tipo"] : "";
      const emissor = typeof item["emissor"] === "string" ? item["emissor"] : "";
      const descricao = typeof item["descricao"] === "string" ? item["descricao"] : tipo;
      const situacao = typeof item["situacao"] === "string" ? item["situacao"] : "INDISPONIVEL";
      const dataHora = typeof item["dataHoraEmissao"] === "string" ? item["dataHoraEmissao"] : "";
      const link = typeof item["linkConsultaManual"] === "string" ? item["linkConsultaManual"] : null;
      const obs = typeof item["observacao"] === "string" ? item["observacao"] : "";

      let source: RegularitySource = "outro";
      let sourceLabel = `${emissor || "TCU"} — ${descricao}`;
      if (tipo.toUpperCase() === "CEIS") {
        source = "ceis_cgu";
        sourceLabel = "CEIS (CGU)";
      } else if (tipo.toUpperCase() === "CNEP") {
        source = "cnep_cgu";
        sourceLabel = "CNEP (CGU)";
      } else if (tipo.toUpperCase() === "CNIA") {
        source = "outro";
        sourceLabel = "CNJ (CNIA — Improbidade Administrativa)";
      } else if (emissor.toUpperCase() === "TCU") {
        source = "outro";
        sourceLabel = "TCU (Licitantes Inidôneos)";
      }

      const mapped = mapTcuSituation(situacao);
      const noteParts = [
        `Consulta automática oficial (${emissor || "TCU"})`,
        `Situação: ${situacao}`,
        dataHora ? `Emissão: ${dataHora}` : null,
        obs || null,
      ].filter(Boolean);

      checks.push({
        source,
        sourceLabel,
        status: mapped.status,
        certificateNumber: dataHora ? `TCU-APF ${dataHora}` : "TCU-APF",
        evidenceUrl: link,
        notes: noteParts.join(" · "),
        requiresAction: mapped.requiresAction,
        rawSituation: situacao,
      });
    }

    const razao = typeof payload?.["razaoSocial"] === "string" ? payload["razaoSocial"] : null;
    return { razaoSocial: razao, checks };
  } catch {
    return {
      razaoSocial: null,
      checks: [],
      warning: "A consulta consolidada do TCU não respondeu dentro do tempo limite.",
    };
  }
}

async function fetchRfbStatus(cnpj: string): Promise<{
  check: AutomatedCheckItem | null;
  warning?: string;
}> {
  const sources = [
    {
      name: "BrasilAPI / Receita Federal",
      url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      parse: (data: Record<string, unknown>) => ({
        situacao:
          typeof data["descricao_situacao_cadastral"] === "string"
            ? data["descricao_situacao_cadastral"]
            : "",
        dataSituacao:
          typeof data["data_situacao_cadastral"] === "string"
            ? data["data_situacao_cadastral"]
            : "",
        razao: typeof data["razao_social"] === "string" ? data["razao_social"] : "",
      }),
    },
    {
      name: "CNPJ.ws / Receita Federal",
      url: `https://publica.cnpj.ws/cnpj/${cnpj}`,
      parse: (data: Record<string, unknown>) => {
        const est =
          data["estabelecimento"] && typeof data["estabelecimento"] === "object"
            ? (data["estabelecimento"] as Record<string, unknown>)
            : {};
        return {
          situacao:
            typeof est["situacao_cadastral"] === "string" ? est["situacao_cadastral"] : "",
          dataSituacao:
            typeof est["data_situacao_cadastral"] === "string"
              ? est["data_situacao_cadastral"]
              : "",
          razao: typeof data["razao_social"] === "string" ? data["razao_social"] : "",
        };
      },
    },
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        headers: { Accept: "application/json", "User-Agent": "PrimusGestao/1.0" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!data) continue;
      const parsed = src.parse(data);
      if (!parsed.situacao) continue;

      const mapped = mapRfbSituation(parsed.situacao);
      return {
        check: {
          source: "rfb_cnpj",
          sourceLabel: "Receita Federal (CNPJ)",
          status: mapped.status,
          certificateNumber: parsed.dataSituacao ? `RFB ${parsed.dataSituacao}` : "RFB-CNPJ",
          evidenceUrl: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpjreva_solicitacao.asp",
          notes: `Consulta automática (${src.name}) · Situação Cadastral: ${parsed.situacao}${parsed.razao ? ` · Razão Social: ${parsed.razao}` : ""}`,
          requiresAction: mapped.requiresAction,
          rawSituation: parsed.situacao,
        },
      };
    } catch {
      // try next provider
    }
  }

  return {
    check: null,
    warning: "Não foi possível consultar a situação cadastral na Receita Federal neste momento.",
  };
}

Deno.serve(async (request: Request) => {
  let origin = "";
  try {
    origin = new URL(request.headers.get("Origin") ?? "").origin;
  } catch {
    origin = "";
  }
  if (!origin || !getAllowedOrigins((name) => Deno.env.get(name)).has(origin)) {
    return new Response("Origem não autorizada.", {
      status: 403,
      headers: { "X-Content-Type-Options": "nosniff" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (request.method !== "POST") {
    return response({ error: "Método não permitido." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    return response({ error: "Serviço de consulta indisponível." }, 503, origin);
  }

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return response({ error: "Sessão autenticada obrigatória." }, 401, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return response({ error: "Corpo da solicitação inválido." }, 400, origin);
  }

  const tenantId = typeof body["tenant_id"] === "string" ? body["tenant_id"].trim() : "";
  const cnpj = typeof body["cnpj"] === "string" ? body["cnpj"].replace(/\D/g, "") : "";

  if (!UUID.test(tenantId)) {
    return response({ error: "Secretaria inválida." }, 400, origin);
  }
  if (!CNPJ_DIGITS.test(cnpj)) {
    return response({ error: "Informe um CNPJ válido com 14 dígitos para consulta." }, 400, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous || !auth.user.email_confirmed_at) {
    return response({ error: "Entre com uma conta confirmada para consultar certidões." }, 401, origin);
  }

  const { data: tenantRow, error: tenantError } = await userClient
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError || !tenantRow) {
    return response({ error: "Sem permissão para consultar regularidade nesta Secretaria." }, 403, origin);
  }

  const [tcuResult, rfbResult] = await Promise.all([
    fetchTcuConsolidated(cnpj),
    fetchRfbStatus(cnpj),
  ]);

  const checks: AutomatedCheckItem[] = [
    ...(rfbResult.check ? [rfbResult.check] : []),
    ...tcuResult.checks,
  ];
  const warnings = [tcuResult.warning, rfbResult.warning].filter((w): w is string => Boolean(w));

  return response(
    {
      checkedAt: new Date().toISOString(),
      cnpj,
      razaoSocial: tcuResult.razaoSocial,
      checks,
      warnings,
    },
    200,
    origin,
  );
});
