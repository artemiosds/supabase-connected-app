import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// FASE 1: as tabelas ainda não existem no banco (migração pendente de
// aprovação), então o client gerado não tem tipos para elas. Este alias
// permite escrever as queries finais já na forma correta; após a migração,
// trocar por `import { supabase } from "@/integrations/supabase/client"`
// direto, com os tipos gerados.
export const db = supabase as unknown as SupabaseClient;

// Detecta o erro típico de estrutura ausente (migração ainda não aplicada).
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
