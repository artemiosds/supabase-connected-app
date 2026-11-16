import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function keyFromEnvironment(): Promise<CryptoKey> {
  const encoded = Deno.env.get("INTEGRATION_SECRETS_KEY") ?? "";
  const raw = base64Bytes(encoded);
  if (raw.length !== 32) throw new Error("INVALID_ENCRYPTION_KEY");
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function decrypt(value: string, key: CryptoKey): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("INVALID_CIPHERTEXT");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(base64Bytes(iv)) },
    key,
    asArrayBuffer(base64Bytes(ciphertext)),
  );
  return new TextDecoder().decode(plain);
}
async function encrypt(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(iv) },
    key,
    new TextEncoder().encode(value),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}
function redirect(status: "connected" | "error", reason?: string): Response {
  const appUrl = Deno.env.get("APP_URL") ?? "";
  let target: URL;
  try {
    target = new URL("/configuracoes", appUrl);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("invalid");
  } catch {
    return new Response("Configuração APP_URL inválida.", { status: 503 });
  }
  target.searchParams.set("drive", status);
  if (reason) target.searchParams.set("drive_error", reason);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return new Response("Método não permitido.", { status: 405 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const redirectUri = Deno.env.get("GOOGLE_DRIVE_REDIRECT_URI") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !redirectUri) {
    return redirect("error", "oauth_not_configured");
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.has("error") || !code || state.length < 32 || state.length > 256) {
    return redirect("error", "authorization_denied");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
    const stateHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data: stateRow, error: stateError } = await admin
      .from("tenant_drive_oauth_states")
      .delete()
      .eq("state_hash", stateHash)
      .gt("expires_at", new Date().toISOString())
      .select("tenant_id,actor_id,code_verifier_ciphertext")
      .maybeSingle();
    if (stateError || !stateRow) return redirect("error", "invalid_or_expired_state");

    const { data: settings, error: settingsError } = await admin
      .from("tenant_integration_settings")
      .select("drive_client_id,drive_client_secret_ciphertext,drive_refresh_token_ciphertext")
      .eq("tenant_id", stateRow.tenant_id)
      .maybeSingle();
    if (settingsError || !settings?.drive_client_id || !settings.drive_client_secret_ciphertext) {
      return redirect("error", "tenant_oauth_configuration_changed");
    }

    const key = await keyFromEnvironment();
    const clientSecret = await decrypt(settings.drive_client_secret_ciphertext, key);
    const codeVerifier = await decrypt(stateRow.code_verifier_ciphertext, key);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: settings.drive_client_id,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    const tokenBody = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || typeof tokenBody?.access_token !== "string") {
      console.error("Google OAuth token exchange rejected:", tokenResponse.status);
      return redirect("error", "token_exchange_failed");
    }

    let refreshCiphertext = settings.drive_refresh_token_ciphertext;
    if (typeof tokenBody.refresh_token === "string" && tokenBody.refresh_token.length > 0) {
      refreshCiphertext = await encrypt(tokenBody.refresh_token, key);
    }
    if (!refreshCiphertext) return redirect("error", "refresh_token_missing");

    const { error: updateError } = await admin
      .from("tenant_integration_settings")
      .update({
        drive_refresh_token_ciphertext: refreshCiphertext,
        drive_connected_at: new Date().toISOString(),
        drive_enabled: false,
        updated_by: stateRow.actor_id,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", stateRow.tenant_id);
    if (updateError) {
      console.error("Could not persist Google Drive refresh token:", updateError.message);
      return redirect("error", "credential_persistence_failed");
    }

    await admin.from("audit_events").insert({
      tenant_id: stateRow.tenant_id,
      actor_id: stateRow.actor_id,
      action: "CONNECT",
      entity: "google_drive",
      entity_id: stateRow.tenant_id,
      details: { scope: "drive.file", refresh_token_stored: true },
    });
    return redirect("connected");
  } catch {
    console.error("Google Drive OAuth callback failed.");
    return redirect("error", "callback_failed");
  }
});
