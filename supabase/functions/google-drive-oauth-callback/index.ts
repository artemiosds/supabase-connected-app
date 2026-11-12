import { safeAppUrl, sha256Hex, redirectWithDriveStatus, GOOGLE_DRIVE_SCOPES } from "../_shared/google-drive.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function fail(app: URL, reason: string) {
  const allowed = new Set([
    "invalid_state", "access_denied", "permission_revoked", "account_mismatch",
    "token_exchange_failed", "scope_missing", "google_account_unverified",
    "drive_folder_failed", "connection_failed",
  ]);
  return Response.redirect(
    redirectWithDriveStatus(app, "error", allowed.has(reason) ? reason : "connection_failed"),
    303,
  );
}


async function revokeGoogleToken(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // The token is never logged. Google-side revocation is best-effort on a
    // failed initial handshake; successful connection can always be revoked
    // later from the tenant settings screen.
  }
}

Deno.serve(async (request: Request) => {
  const app = safeAppUrl(Deno.env.get("APP_URL"));
  if (!app) return new Response("Configuração ausente.", { status: 503 });
  if (request.method !== "GET") return fail(app, "invalid_state");

  const query = new URL(request.url).searchParams;
  if (query.get("error")) {
    return fail(app, query.get("error") === "access_denied" ? "access_denied" : "invalid_state");
  }
  const code = query.get("code") ?? "";
  const state = query.get("state") ?? "";
  if (!code || code.length > 4096 || !/^[0-9a-f]{64}$/.test(state)) {
    return fail(app, "invalid_state");
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_DRIVE_REDIRECT_URI");
  if (!url || !key || !clientId || !clientSecret || !redirectUri) return fail(app, "connection_failed");

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: oauthState } = await admin
    .from("tenant_google_drive_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state_hash", await sha256Hex(state))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("tenant_id,actor_user_id")
    .maybeSingle();
  if (!oauthState) return fail(app, "invalid_state");

  const { data: authorized } = await admin.rpc("is_tenant_google_drive_oauth_actor_authorized", {
    p_tenant_id: oauthState.tenant_id,
    p_actor_user_id: oauthState.actor_user_id,
  });
  if (authorized !== true) return fail(app, "permission_revoked");

  let tokens: TokenResponse;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer") {
      return fail(app, "token_exchange_failed");
    }
  } catch {
    return fail(app, "token_exchange_failed");
  }

  const scopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  if (!GOOGLE_DRIVE_SCOPES.every((scope) => scopes.includes(scope))) {
    await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    return fail(app, "scope_missing");
  }
  if (!Number.isInteger(tokens.expires_in) || (tokens.expires_in ?? 0) < 60) {
    await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    return fail(app, "token_exchange_failed");
  }

  let account: { sub?: string; email?: string; email_verified?: boolean };
  try {
    const userInfo = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + tokens.access_token },
      signal: AbortSignal.timeout(15000),
    });
    account = await userInfo.json();
    if (!userInfo.ok || !account.sub || !account.email || account.email_verified !== true) {
      await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
      return fail(app, "google_account_unverified");
    }
  } catch {
    await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    return fail(app, "google_account_unverified");
  }

  const { data: previous, error: previousError } = await admin.rpc(
    "get_tenant_google_drive_credentials",
    { p_tenant_id: oauthState.tenant_id },
  );
  if (previousError) {
    await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    return fail(app, "connection_failed");
  }
  const existing = Array.isArray(previous) ? previous[0] : previous;
  if (existing?.google_subject && existing.google_subject !== account.sub) {
    await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    return fail(app, "account_mismatch");
  }
  let folderId = existing?.root_folder_id as string | undefined;
  let folderName = existing?.root_folder_name as string | undefined;
  let folderWasCreated = false;
  if (!folderId || !folderName) {
    folderName = "Gestão de Fornecedores - " + oauthState.tenant_id;
    try {
      const folderResponse = await fetch(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + tokens.access_token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const folder = await folderResponse.json();
      if (!folderResponse.ok || !folder.id) return fail(app, "drive_folder_failed");
      folderId = folder.id;
      folderName = folder.name ?? folderName;
      folderWasCreated = true;
    } catch {
      await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
      return fail(app, "drive_folder_failed");
    }
  }

  const { error } = await admin.rpc("complete_tenant_google_drive_connection", {
    p_tenant_id: oauthState.tenant_id,
    p_actor_user_id: oauthState.actor_user_id,
    p_google_email: account.email.toLowerCase(),
    p_google_subject: account.sub,
    p_granted_scopes: scopes,
    p_root_folder_id: folderId,
    p_root_folder_name: folderName,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token ?? null,
    p_access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  });
  if (error) {
    console.error("Drive connection could not be stored:", error.code);
    if (folderWasCreated && folderId) {
      try {
        await fetch(
          "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(folderId),
          {
            method: "DELETE",
            headers: { Authorization: "Bearer " + tokens.access_token },
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch {
        console.error("Drive folder cleanup failed after connection rollback.");
      }
    }
    await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    return fail(app, "connection_failed");
  }
  return Response.redirect(redirectWithDriveStatus(app, "connected"), 303);
});
