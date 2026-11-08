import { supabase } from "@/integrations/supabase/client";

// O cliente usa os tipos gerados diretamente do schema atual do Supabase SMS2.
export const db = supabase;

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
