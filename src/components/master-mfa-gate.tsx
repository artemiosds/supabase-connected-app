import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  QrCode,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { AuthenticatorAssuranceLevels } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TotpEnrollmentState = {
  factorId: string;
  qrCodeSrc: string;
  secret: string;
};

function normalizeQrCodeSrc(qrCode: string): string {
  if (qrCode.startsWith("data:")) return qrCode;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;
}

function traduzirErroMfa(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid totp code") || lower.includes("invalid otp")) {
    return "Código de autenticação inválido ou expirado. Confira o relógio do dispositivo e tente novamente.";
  }
  if (lower.includes("factor") && lower.includes("already exists")) {
    return "Já existe um fator TOTP pendente. Recarregue e tente novamente.";
  }
  return message;
}

export function MasterMfaGate({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const [checking, setChecking] = useState(true);
  const [aalLevel, setAalLevel] = useState<AuthenticatorAssuranceLevels | null>(null);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [unverifiedFactorIds, setUnverifiedFactorIds] = useState<string[]>([]);
  const [enrollment, setEnrollment] = useState<TotpEnrollmentState | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMfaState = useCallback(async () => {
    setChecking(true);
    setError(null);
    const [aalRes, factorsRes] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);

    if (aalRes.error || factorsRes.error) {
      setError("Não foi possível verificar o status da autenticação em duas etapas (MFA).");
      setChecking(false);
      return;
    }

    const totpFactors = factorsRes.data?.totp ?? [];
    const verified = totpFactors.find((factor) => factor.status === "verified") ?? null;
    const unverified = totpFactors
      .filter((factor) => factor.status !== "verified")
      .map((factor) => factor.id);

    setAalLevel(aalRes.data?.currentLevel ?? null);
    setVerifiedFactorId(verified?.id ?? null);
    setUnverifiedFactorIds(unverified);
    setChecking(false);
  }, []);

  useEffect(() => {
    void loadMfaState();
  }, [loadMfaState]);

  async function iniciarConfiguracaoTotp() {
    setSubmitting(true);
    setError(null);

    for (const staleId of unverifiedFactorIds) {
      await supabase.auth.mfa.unenroll({ factorId: staleId });
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Administrador Master",
    });

    setSubmitting(false);
    if (enrollError || !data) {
      const msg = traduzirErroMfa(
        enrollError?.message ?? "Não foi possível iniciar o cadastro do TOTP.",
      );
      setError(msg);
      toast.error(msg);
      return;
    }

    setEnrollment({
      factorId: data.id,
      qrCodeSrc: normalizeQrCodeSrc(data.totp.qr_code),
      secret: data.totp.secret,
    });
    setCode("");
    setShowSetup(true);
  }

  async function confirmarCodigo(event: FormEvent, factorId: string, isEnrollment: boolean) {
    event.preventDefault();
    const cleanedCode = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanedCode)) {
      setError("Informe os 6 dígitos numéricos exibidos no seu aplicativo autenticador.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: cleanedCode,
    });
    setSubmitting(false);

    if (verifyError) {
      setError(traduzirErroMfa(verifyError.message));
      return;
    }

    setEnrollment(null);
    setShowSetup(false);
    setCode("");
    toast.success(
      isEnrollment
        ? "Autenticação em duas etapas (MFA) ativada para sua conta Master."
        : "Sessão Master verificada com MFA (AAL2).",
    );
    await loadMfaState();
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  // Bloqueio estrito quando o administrador já possui TOTP ativo, mas entrou apenas com senha (AAL1)
  if (verifiedFactorId && aalLevel !== "aal2") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
        <Card className="w-full max-w-md border-primary/30 shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LockKeyhole className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle>Verificação em duas etapas (MFA)</CardTitle>
            <CardDescription>
              Esta conta possui proteção MFA ativa. Informe o código de 6 dígitos do seu aplicativo
              autenticador para acessar o Painel Master.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={(event) => void confirmarCodigo(event, verifiedFactorId, false)}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="master-mfa-code">Código do autenticador (TOTP)</Label>
                <Input
                  id="master-mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Confirmar e liberar acesso
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => void signOut()}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden />
              Sair da conta
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Se ainda não possui MFA cadastrado, orienta o cadastro sem bloquear a operação atual
  const needsEnrollment = !verifiedFactorId;

  return (
    <>
      {needsEnrollment && (
        <div className="border-b border-amber-500/30 bg-amber-50/70 px-4 py-3 dark:bg-amber-950/20">
          <div className="mx-auto max-w-[1440px] space-y-4 md:px-4">
            <Alert className="border-amber-500/40 bg-background/95">
              <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <AlertTitle className="flex items-center gap-2">
                    Recomendação de segurança: ative o MFA (2FA) na conta Master
                    <Badge variant="outline">AAL1</Badge>
                  </AlertTitle>
                  <AlertDescription className="mt-1">
                    Assim que um fator TOTP for vinculado, o Painel Master passará a exigir o código
                    de 6 dígitos em todo acesso administrativo.
                  </AlertDescription>
                </div>
                {!showSetup && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void iniciarConfiguracaoTotp()}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <QrCode className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Configurar MFA (TOTP)
                  </Button>
                )}
              </div>
            </Alert>

            {showSetup && enrollment && (
              <Card className="border-primary/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <KeyRound className="h-4 w-4 text-primary" aria-hidden />
                    Vincular aplicativo autenticador
                  </CardTitle>
                  <CardDescription>
                    Escaneie o QR Code no Google Authenticator, Authy, 1Password ou Bitwarden e
                    informe o código de 6 dígitos gerado.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6 md:grid-cols-[180px_1fr] md:items-center">
                  <div className="flex justify-center rounded-lg border bg-white p-3">
                    <img
                      src={enrollment.qrCodeSrc}
                      alt="QR Code para autenticação MFA TOTP"
                      className="h-40 w-40"
                    />
                  </div>
                  <form
                    onSubmit={(event) => void confirmarCodigo(event, enrollment.factorId, true)}
                    className="space-y-4"
                  >
                    <div className="space-y-1">
                      <Label htmlFor="master-mfa-secret">Chave manual (se não usar câmera)</Label>
                      <Input
                        id="master-mfa-secret"
                        readOnly
                        value={enrollment.secret}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="master-mfa-enroll-code">
                        Código de confirmação (6 dígitos)
                      </Label>
                      <Input
                        id="master-mfa-enroll-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        value={code}
                        onChange={(event) =>
                          setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        required
                      />
                    </div>
                    {error && (
                      <p
                        role="alert"
                        className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      >
                        {error}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={submitting}>
                        {submitting && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        )}
                        <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
                        Ativar MFA agora
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={submitting}
                        onClick={() => {
                          setShowSetup(false);
                          setEnrollment(null);
                          setError(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
