import { getAllowedOrigins } from "../_shared/origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SERIES_SGS: Record<string, { sgs: number; nome: string }> = {
  ipca: { sgs: 433, nome: "IPCA (IBGE)" },
  inpc: { sgs: 188, nome: "INPC (IBGE)" },
  igpm: { sgs: 189, nome: "IGP-M (FGV)" },
  ipcfipe: { sgs: 193, nome: "IPC-FIPE" },
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const userHits = new Map<string, number[]>();

function isRateLimited(userId: string, nowMs: number = Date.now()): boolean {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const recent = (userHits.get(userId) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    userHits.set(userId, recent);
    return true;
  }
  recent.push(nowMs);
  userHits.set(userId, recent);
  return false;
}

function json(payload: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store, max-age=0",
      ...(origin
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          }
        : {}),
    },
  });
}

function isoToBr(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

Deno.serve(async (req) => {
  const allowedOrigins = getAllowedOrigins((name) => Deno.env.get(name));
  const requestOrigin = req.headers.get("Origin") ?? "";
  const origin = allowedOrigins.has(requestOrigin) ? requestOrigin : "";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "X-Content-Type-Options": "nosniff",
        ...(origin
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
            }
          : {}),
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Método não suportado." }, 405, origin);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!authHeader || !supabaseUrl || !supabaseAnonKey) {
    return json({ error: "Autenticação obrigatória." }, 401, origin);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Sessão inválida ou expirada." }, 401, origin);
  }

  if (isRateLimited(authData.user.id)) {
    return json({ error: "Limite de consultas ao Banco Central atingido. Aguarde 1 minuto." }, 429, origin);
  }

  let body: { indexCode?: string; dataInicialISO?: string; dataFinalISO?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo JSON inválido." }, 400, origin);
  }

  const indexKey = String(body.indexCode ?? "").trim().toLowerCase();
  const serie = SERIES_SGS[indexKey];
  if (!serie) {
    return json({ error: "Índice inválido. Utilize ipca, inpc, igpm ou ipcfipe." }, 400, origin);
  }

  const dataInicialBr = isoToBr(String(body.dataInicialISO ?? ""));
  const dataFinalBr = isoToBr(String(body.dataFinalISO ?? ""));
  if (!dataInicialBr || !dataFinalBr) {
    return json({ error: "Informe dataInicialISO e dataFinalISO válidas (YYYY-MM-DD)." }, 400, origin);
  }

  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie.sgs}/dados?formato=json&dataInicial=${encodeURIComponent(dataInicialBr)}&dataFinal=${encodeURIComponent(dataFinalBr)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      return json(
        { error: `Banco Central respondeu com status ${resp.status}. Tente novamente ou informe manualmente.` },
        502,
        origin,
      );
    }
    const raw = await resp.json();
    return json({ indexCode: indexKey, sgs: serie.sgs, nome: serie.nome, pontos: raw }, 200, origin);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao consultar API do Banco Central.";
    return json({ error: msg }, 502, origin);
  } finally {
    clearTimeout(timer);
  }
});
