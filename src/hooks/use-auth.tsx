import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

function traduzErro(mensagem: string): string {
  if (mensagem.includes("Invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (mensagem.includes("User already registered")) {
    return "Já existe uma conta com este e-mail.";
  }
  if (mensagem.toLowerCase().includes("rate limit")) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  if (mensagem.toLowerCase().includes("password should be at least")) {
    return "A senha deve ter no mínimo 6 caracteres.";
  }
  if (mensagem.includes("Email not confirmed")) {
    return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
  }
  return mensagem;
}

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, senha: string) => Promise<string | null>;
  signUp: (
    email: string,
    senha: string,
    nome: string,
  ) => Promise<{ error: string | null; precisaConfirmarEmail: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (senha: string) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      setSession(novaSessao);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signIn: async (email, senha) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: senha,
        });
        return error ? traduzErro(error.message) : null;
      },
      signUp: async (email, senha, nome) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { data: { display_name: nome } },
        });
        if (error) return { error: traduzErro(error.message), precisaConfirmarEmail: false };
        return { error: null, precisaConfirmarEmail: !!data.user && !data.session };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/redefinir-senha`,
        });
        return error ? traduzErro(error.message) : null;
      },
      updatePassword: async (senha) => {
        const { error } = await supabase.auth.updateUser({ password: senha });
        return error ? traduzErro(error.message) : null;
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
