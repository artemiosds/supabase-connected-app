import { supabase } from "@/integrations/supabase/client";

// O cliente usa os tipos gerados diretamente do schema atual do Supabase SMS2.
export const db = supabase;

/**
 * Fetches every row in deterministic pages instead of silently truncating at
 * the PostgREST max_rows limit. Callers must provide a stable ordering.
 */
export async function carregarTodasAsPaginas<T>(
  consultar: (
    inicio: number,
    fim: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const registros: T[] = [];
  const tamanhoPagina = 500;

  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await consultar(inicio, inicio + tamanhoPagina - 1);
    if (error) throw error;
    const pagina = data ?? [];
    registros.push(...pagina);
    if (pagina.length < tamanhoPagina) return registros;
  }
}

// Detecta o erro típico de estrutura ausente durante implantação controlada.
export function bancoNaoConfigurado(mensagem: string | null | undefined): boolean {
  if (!mensagem) return false;
  const m = mensagem.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("pgrst20") ||
    m.includes("pgrst205") ||
    m.includes("relation")
  );
}
