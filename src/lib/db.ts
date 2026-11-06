import { supabase } from "@/integrations/supabase/client";

// O cliente usa os tipos gerados diretamente do schema atual do Supabase SMS2.
export const db = supabase;

// Estruturas de processos e contratos já existem no SMS2. O gerador de tipos ainda não
// representa todas as relações auxiliares usadas nas telas (por exemplo, itens do processo).
// Este cast legado evita tipos falsos; novas integrações devem preferir o cliente db tipado.
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
