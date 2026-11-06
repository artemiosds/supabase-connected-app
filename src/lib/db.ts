import { supabase } from "@/integrations/supabase/client";

// O cliente usa os tipos gerados diretamente do schema atual do Supabase SMS2.
export const db = supabase;

// Tabelas da Fase 3 (contratos/processos) ainda não existem nos tipos gerados enquanto a
// migration pendente não for aprovada. Este cliente sem tipagem é usado só nessas telas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dbFase3 = supabase as unknown as { from: (t: string) => any };

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
