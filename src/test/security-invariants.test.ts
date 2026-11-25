import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());

function readText(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function listFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listFiles(full, results);
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("invariantes automatizadas de cibersegurança", () => {
  it("nenhuma Edge Function usa CORS wildcard (*) e todas enviam X-Content-Type-Options: nosniff", () => {
    const functionsRoot = join(ROOT, "supabase", "functions");
    const functionDirs = readdirSync(functionsRoot).filter(
      (name) => name !== "_shared" && statSync(join(functionsRoot, name)).isDirectory(),
    );

    expect(functionDirs.length).toBeGreaterThanOrEqual(11);

    for (const fn of functionDirs) {
      const source = readFileSync(join(functionsRoot, fn, "index.ts"), "utf8");
      expect(source, `${fn} não deve expor CORS wildcard *`).not.toMatch(
        /Access-Control-Allow-Origin["']?\s*:\s*["']\*/,
      );
      expect(source, `${fn} precisa enviar X-Content-Type-Options: nosniff`).toContain("nosniff");
    }
  });

  it("Edge Functions expostas ao navegador exigem allowlist de origem via getAllowedOrigins", () => {
    const browserFunctions = [
      "google-drive-sync",
      "invite-platform-staff",
      "invite-platform-support-agent",
      "invite-tenant-user",
      "lookup-cnpj",
      "platform-ai-configuration",
      "platform-billing-config",
      "primus-ai",
      "sign-generated-document",
      "tenant-integration-settings",
    ];

    for (const fn of browserFunctions) {
      const source = readText(`supabase/functions/${fn}/index.ts`);
      expect(source, `${fn} deve validar Origin com getAllowedOrigins`).toContain(
        "getAllowedOrigins",
      );
      expect(source, `${fn} deve rejeitar origem desconhecida com 403`).toContain("403");
    }
  });

  it("supabase/config.toml mantém verify_jwt = true nas funções autenticadas e exceções documentadas", () => {
    const config = readText("supabase/config.toml");

    const jwtRequired = [
      "invite-tenant-user",
      "invite-platform-support-agent",
      "platform-billing-config",
      "invite-platform-staff",
      "tenant-integration-settings",
      "sign-generated-document",
      "google-drive-sync",
      "platform-ai-configuration",
      "primus-ai",
      "lookup-cnpj",
    ];

    for (const fn of jwtRequired) {
      const section = new RegExp(`\\[functions\\.${fn}\\]\\s*\\r?\\nverify_jwt\\s*=\\s*true`);
      expect(config, `${fn} deve exigir verify_jwt = true`).toMatch(section);
    }

    expect(readText("supabase/functions/lookup-cnpj/index.ts")).toContain("email_confirmed_at");
    expect(readText("supabase/functions/lookup-cnpj/index.ts")).toContain("is_anonymous");
    expect(readText("supabase/functions/sign-generated-document/index.ts")).toContain(
      "email_confirmed_at",
    );
    expect(readText("supabase/functions/sign-generated-document/index.ts")).toContain(
      "userClient.storage",
    );
    expect(readText("supabase/functions/google-drive-oauth-callback/index.ts")).toContain(
      '"Referrer-Policy": "no-referrer"',
    );
    expect(readText("supabase/functions/send-expiry-notifications/index.ts")).toContain(
      "expectedSecret.length < 32",
    );
  });

  it("SSR aplica cabeçalhos de segurança, CSP e proteção CSRF", () => {
    const serverTs = readText("src/server.ts");
    const startTs = readText("src/start.ts");

    expect(serverTs).toContain("applySecurityHeaders");
    expect(startTs).toContain("createCsrfMiddleware");
    expect(startTs).toContain("nosniff");
  });

  it("autenticação exige mínimo de 10 caracteres e Painel Master usa MasterMfaGate", () => {
    const signup = readText("src/routes/cadastro.tsx");
    const reset = readText("src/routes/redefinir-senha.tsx");
    const master = readText("src/routes/admin-master.tsx");

    expect(signup).toContain("senha.length < 10");
    expect(signup).toContain("minLength={10}");
    expect(reset).toContain("senha.length < 10");
    expect(reset).toContain("minLength={10}");
    expect(master).toContain("MasterMfaGate");
  });

  it("frontend em src/ não contém chaves privadas ou service_role hardcoded", () => {
    const srcFiles = listFiles(join(ROOT, "src")).filter(
      (file) => !file.includes(".test.") && /\.(ts|tsx|js|jsx|mjs)$/.test(file),
    );
    const forbiddenPatterns = [
      /VITE_SUPABASE_SERVICE_ROLE_KEY/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bsk_live_[A-Za-z0-9]{16,}/,
      /\bghp_[A-Za-z0-9]{20,}/,
      /\bAIza[0-9A-Za-z_-]{30,}/,
      /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    ];

    for (const file of srcFiles) {
      const content = readFileSync(file, "utf8");
      const isServerOnly = file.endsWith(".server.ts") || file.endsWith(".server.tsx");
      if (!isServerOnly && !file.endsWith("admin-master-configuration.tsx")) {
        expect(content, `SUPABASE_SERVICE_ROLE_KEY não deve aparecer em ${file}`).not.toContain(
          "SUPABASE_SERVICE_ROLE_KEY",
        );
      }
      if (!isServerOnly) {
        expect(content, `client.server não deve ser importado no cliente (${file})`).not.toContain(
          "client.server",
        );
      }
      for (const pattern of forbiddenPatterns) {
        expect(content, `Padrão proibido ${pattern} encontrado em ${file}`).not.toMatch(pattern);
      }
    }
  });

  it("migração e teste SQL de FORCE ROW LEVEL SECURITY existem para todas as tabelas public", () => {
    const migration = readText(
      "supabase/migrations/20261125100000_force_rls_on_legacy_public_tables.sql",
    );
    const sqlTest = readText("supabase/tests/force_rls_all_public_tables.test.sql");

    for (const table of [
      "audit_events",
      "document_template_catalog",
      "document_template_versions",
      "membership_roles",
      "permissions",
      "platform_admins",
      "profiles",
      "tenant_memberships",
      "tenant_role_permissions",
      "tenant_roles",
      "tenants",
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
    }
    expect(sqlTest).toContain("relforcerowsecurity");
  });
});
