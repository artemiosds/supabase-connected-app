import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

export async function verifySupplierCompletion(page, appUrl) {
  const supplierName = "Fornecedor Sintético Exclusivo A";
  await page.goto(appUrl + "/fornecedores", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Editar " + supplierName, exact: true }).click();
  const form = page.getByRole("dialog", { name: "Editar fornecedor", exact: true });
  await page.route("**/functions/v1/lookup-cnpj", (route) =>
    route.fulfill({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,content-type",
        "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      },
      json: {
        data: {
          cnpj: "12345678000195",
          legal_name: supplierName,
          trade_name: "Nome atualizado da fonte",
          street: "Rua da consulta",
          street_number: "1",
          complement: null,
          neighborhood: "Centro",
          postal_code: null,
          city: "Recife",
          state: "PE",
          contact_phone: null,
          contact_email: null,
          website: null,
          registration_status: "ATIVA",
          registration_status_date: null,
          registration_status_reason: null,
          opening_date: null,
          legal_nature: null,
          company_size: null,
          share_capital: null,
          main_activity: { code: "4644-3/01", description: "Comércio farmacêutico" },
          secondary_activities: [],
          partners: [],
          sources: ["Fonte sintética CI"],
          source: "Fonte sintética CI",
          consulted_at: "2026-11-21T13:30:00Z",
        },
      },
    }),
  );
  await form.getByRole("button", { name: "Consultar e preencher", exact: true }).click();
  const comparison = form.getByRole("region", { name: "Comparação cadastral" });
  await comparison.waitFor();
  await comparison.getByRole("checkbox", { name: "Atualizar Nome fantasia", exact: true }).check();
  await comparison.getByRole("button", { name: "Aplicar atualização cadastral" }).click();
  assert.equal(
    await form.getByLabel("Nome fantasia", { exact: true }).inputValue(),
    "Nome atualizado da fonte",
  );
  await form.getByRole("button", { name: /Categoria sugerida pelo CNAE:.*Medicamentos/ }).click();
  assert.equal(await form.getByLabel("Categoria", { exact: false }).inputValue(), "medicamentos");
  await page.route("https://brasilapi.com.br/api/cep/v1/**", (route) =>
    route.fulfill({
      headers: { "Access-Control-Allow-Origin": appUrl },
      json: {
        cep: "50000001",
        city: "Recife",
        state: "PE",
        street: "Rua CEP",
        neighborhood: "Centro",
      },
    }),
  );
  await page.route("https://viacep.com.br/ws/**", (route) =>
    route.fulfill({
      headers: { "Access-Control-Allow-Origin": appUrl },
      json: {
        cep: "50000-001",
        localidade: "Recife",
        uf: "PE",
        logradouro: "Rua CEP",
        bairro: "Centro",
      },
    }),
  );
  await page.route("https://servicodados.ibge.gov.br/**", (route) =>
    route.fulfill({ json: [{ nome: "Recife" }, { nome: "Olinda" }] }),
  );
  await form.getByLabel("Logradouro", { exact: true }).fill("");
  await form.getByLabel("Bairro", { exact: true }).fill("");
  await form.getByLabel("CEP", { exact: true }).fill("50000-001");
  await form
    .getByText("Endereço localizado. Confira os dados antes de salvar.", { exact: true })
    .waitFor();
  assert.equal(await form.getByLabel("Logradouro", { exact: true }).inputValue(), "Rua CEP");
  await form.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await form.waitFor({ state: "hidden" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Editar " + supplierName, exact: true }).click();
  await form.getByText(/Última consulta:.*21\/11\/2026/).waitFor();
  assert.ok(
    !(await form.getByLabel("Observações internas").inputValue()).includes("RFB_VERIFICATION"),
  );
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/supplier-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir ficha 360º de " + supplierName }).click();
  const profile = page.getByRole("dialog", { name: "Ficha 360º do fornecedor" });
  await profile.getByRole("tab", { name: "Documentos", exact: true }).click();
  await profile.getByRole("region", { name: "Pendências documentais" }).waitFor();
  assert.ok((await profile.getByText("AFE — Anvisa", { exact: false }).count()) > 0);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await page.screenshot({ path: "artifacts/supplier-mobile.png", fullPage: true });
  await page
    .context()
    .route("https://files.example.invalid/certificate.txt", (route) =>
      route.fulfill({ contentType: "text/plain", body: "Certidão sintética de homologação" }),
    );
  const [certificate] = await Promise.all([
    page.context().waitForEvent("page"),
    profile.getByRole("button", { name: "Abrir arquivo", exact: true }).first().click(),
  ]);
  await certificate.getByText("Certidão sintética de homologação", { exact: true }).waitFor();
  await certificate.close();

  const manage = profile.getByRole("link", { name: /Abrir módulo/ });
  assert.ok((await manage.getAttribute("href")).includes("fornecedor="));
  await manage.click();
  await page.getByRole("button", { name: "Ver todos os fornecedores", exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.unroute("**/functions/v1/lookup-cnpj");
  console.log(
    "PASS supplier completion: selected RFB diff, persisted verification, CEP, CNAE, sanitary matrix and mobile viewport",
  );
}
