import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const appUrl = process.env.E2E_APP_URL ?? "http://127.0.0.1:4173";
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const password = "GfsE2E!2026-OnlyLocal";

assert.ok(supabaseUrl, "SUPABASE_URL must be set by the local Supabase CLI");
assert.ok(anonKey, "SUPABASE_ANON_KEY must be set by the local Supabase CLI");

const scenarios = [
  {
    email: "e2e.secretaria.a@example.invalid",
    tenantId: "91000000-0000-4000-8000-000000000001",
    otherTenantId: "91000000-0000-4000-8000-000000000002",
    tenantName: "Secretaria E2E A",
    ownSupplier: "Fornecedor Sintético Exclusivo A",
    otherSupplier: "Fornecedor Sintético Exclusivo B",
    attemptedCnpj: "45678912000155",
  },
  {
    email: "e2e.secretaria.b@example.invalid",
    tenantId: "91000000-0000-4000-8000-000000000002",
    otherTenantId: "91000000-0000-4000-8000-000000000001",
    tenantName: "Secretaria E2E B",
    ownSupplier: "Fornecedor Sintético Exclusivo B",
    otherSupplier: "Fornecedor Sintético Exclusivo A",
    attemptedCnpj: "45678912000155",
  },
];

const browser = await chromium.launch({ headless: true });
const failedPages = [];

async function readAccessToken(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
        const token = value?.access_token ?? value?.currentSession?.access_token;
        if (typeof token === "string" && token.length > 20) return token;
      } catch {
        // Other localStorage entries are application preferences, not auth sessions.
      }
    }
    return null;
  });
}

async function verifyAuthenticatedTenant(scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await page.goto(`${appUrl}/entrar?portal=secretaria`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-mail").fill(scenario.email);
    await page.getByLabel("Senha").fill(password);

    await Promise.all([
      page.waitForURL(/\/painel(?:[/?#]|$)/),
      page.getByRole("button", { name: "Entrar", exact: true }).click(),
    ]);

    await page.getByRole("heading", { name: "Painel", exact: true }).waitFor();
    await page.goto(`${appUrl}/fornecedores`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Fornecedores", exact: true }).waitFor();
    await page.getByText(scenario.ownSupplier, { exact: true }).waitFor();

    assert.equal(
      await page.getByText(scenario.otherSupplier, { exact: true }).count(),
      0,
      `${scenario.email} must not see the other tenant's supplier in the UI`,
    );
    assert.ok(
      (await page.getByText(scenario.tenantName, { exact: true }).count()) > 0,
      `${scenario.email} must see only its assigned organization`,
    );

    const accessToken = await readAccessToken(page);
    assert.ok(accessToken, "the authenticated UI session must persist a JWT");

    const apiChecks = await page.evaluate(
      async ({ apiUrl, publicKey, token, ownTenantId, otherTenantId, cnpj }) => {
        const headers = {
          apikey: publicKey,
          Authorization: `Bearer ${token}`,
        };
        const ownResponse = await fetch(
          `${apiUrl}/rest/v1/suppliers?select=id,legal_name&tenant_id=eq.${ownTenantId}`,
          { headers },
        );
        const ownRows = await ownResponse.json();

        const crossTenantRead = await fetch(
          `${apiUrl}/rest/v1/suppliers?select=id,legal_name&tenant_id=eq.${otherTenantId}`,
          { headers },
        );
        const crossTenantRows = await crossTenantRead.json();

        const crossTenantWrite = await fetch(`${apiUrl}/rest/v1/suppliers`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            tenant_id: otherTenantId,
            cnpj,
            legal_name: "Tentativa E2E de cadastro entre Secretarias",
            category: "outros",
            status: "active",
          }),
        });

        return {
          ownStatus: ownResponse.status,
          ownRows,
          crossReadStatus: crossTenantRead.status,
          crossTenantRows,
          crossWriteStatus: crossTenantWrite.status,
          crossWriteBody: await crossTenantWrite.text(),
        };
      },
      {
        apiUrl: supabaseUrl,
        publicKey: anonKey,
        token: accessToken,
        ownTenantId: scenario.tenantId,
        otherTenantId: scenario.otherTenantId,
        cnpj: scenario.attemptedCnpj,
      },
    );

    assert.equal(apiChecks.ownStatus, 200, "the authenticated user must read its own tenant");
    assert.equal(apiChecks.ownRows.length, 1, "the own-tenant query must return its fixture");
    assert.equal(
      apiChecks.ownRows[0].legal_name,
      scenario.ownSupplier,
      "the own-tenant API response must contain the expected supplier",
    );
    assert.equal(
      apiChecks.crossReadStatus,
      200,
      "PostgREST should safely return an empty collection for a tenant the user cannot access",
    );
    assert.deepEqual(
      apiChecks.crossTenantRows,
      [],
      "RLS must hide all rows belonging to the other tenant",
    );
    assert.ok(
      apiChecks.crossWriteStatus >= 400,
      `cross-tenant INSERT must be rejected; received HTTP ${apiChecks.crossWriteStatus}: ${apiChecks.crossWriteBody}`,
    );

    console.log(
      `PASS ${scenario.email}: login, UI isolation, own-tenant read, cross-tenant read denied, cross-tenant write denied`,
    );
  } catch (error) {
    await mkdir("artifacts", { recursive: true });
    const safeName = scenario.email.replace(/[^a-z0-9]+/gi, "-");
    await page
      .screenshot({
        path: `artifacts/tenant-isolation-${safeName}.png`,
        fullPage: true,
      })
      .catch(() => {});
    failedPages.push(scenario.email);
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const scenario of scenarios) {
    await verifyAuthenticatedTenant(scenario);
  }
  console.log(
    "PASS authenticated multitenant browser E2E: both synthetic tenant accounts are isolated.",
  );
} finally {
  await browser.close();
  if (failedPages.length > 0) {
    console.error(`Failed scenarios: ${failedPages.join(", ")}`);
  }
}
