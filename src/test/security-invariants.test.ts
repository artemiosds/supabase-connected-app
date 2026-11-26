import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
      (name) =>
        name !== "_shared" &&
        name !== "node_modules" &&
        statSync(join(functionsRoot, name)).isDirectory() &&
        existsSync(join(functionsRoot, name, "index.ts")),
    );

    expect(functionDirs.length).toBeGreaterThanOrEqual(11);

    for (const fn of functionDirs) {
      const source = readFileSync(join(functionsRoot, fn, "index.ts"), "utf8");
      expect(source).not.toMatch(/Access-Control-Allow-Origin["']?\s*:\s*["']\*/);
      expect(source).toContain("nosniff");
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
      "fetch-public-prices",
      "check-supplier-regularity",
      "send-quote-request-email",
      "sign-generated-document",
      "tenant-integration-settings",
    ];

    for (const fn of browserFunctions) {
      const source = readText(`supabase/functions/${fn}/index.ts`);
      expect(source).toContain("getAllowedOrigins");
      expect(source).toContain("403");
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
      "fetch-public-prices",
      "check-supplier-regularity",
      "send-quote-request-email",
    ];

    for (const fn of jwtRequired) {
      const section = new RegExp(`\\[functions\\.${fn}\\]\\s*\\r?\\nverify_jwt\\s*=\\s*true`);
      expect(config).toMatch(section);
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
    expect(readText("supabase/functions/platform-commercial-alerts/index.ts")).toContain(
      "expectedCronSecret.length >= 32",
    );
    expect(readText("supabase/functions/platform-commercial-alerts/index.ts")).toContain(
      "getAllowedOrigins",
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
        expect(content).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      }
      if (!isServerOnly) {
        expect(content).not.toContain("client.server");
      }
      for (const pattern of forbiddenPatterns) {
        expect(content).not.toMatch(pattern);
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

  it("monitoramento contínuo, Dependabot e varredura de segredos estão configurados", () => {
    const monitoringSql = readText(
      "supabase/migrations/20261125110000_security_monitoring_signals_and_rls.sql",
    );
    const monitoringTest = readText("supabase/tests/platform_security_monitoring.test.sql");
    const dependabot = readText(".github/dependabot.yml");
    const securityWorkflow = readText(".github/workflows/security-monitor.yml");

    expect(monitoringSql).toContain("get_platform_security_signals");
    expect(monitoringSql).toContain("is_platform_admin");
    expect(monitoringTest).toContain("has_function_privilege");
    expect(dependabot).toContain('package-ecosystem: "bun"');
    expect(securityWorkflow).toContain("gitleaks/gitleaks-action");
    expect(securityWorkflow).toContain("bun pm audit");
    expect(
      readText("supabase/migrations/20261125120000_platform_commercial_alerts_outbox.sql"),
    ).toContain("FORCE ROW LEVEL SECURITY");
    expect(readText("supabase/tests/platform_commercial_alerts.test.sql")).toContain(
      "relforcerowsecurity",
    );
  });
});
