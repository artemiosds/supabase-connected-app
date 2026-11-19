import assert from "node:assert/strict";

export async function verifyAnnualDemand({
  page,
  browser,
  appUrl,
  password,
  tenantId,
  readRows,
  callRpc,
}) {
  const title = "PCA E2E — materiais de atenção básica";
  const justification = "Planejamento anual de reposição da unidade sintética";
  const number = "E2E-PCA-2026-001";
  const items = [
    { description: "Material de atenção básica A", unit: "Frasco c/ 21", quantity: 5000 },
    { description: "Material de atenção básica B", unit: "Ampola 2ml", quantity: 12000 },
  ];
  const open = async (tab) => {
    await tab.goto(appUrl + "/processos");
    await tab.getByRole("button", { name: "Plano de Contratações Anual" }).click();
    await tab.getByLabel("Exercício").selectOption("2026");
  };
  const card = (tab) => tab.locator("article").filter({ hasText: title });
  await open(page);
  await page.getByLabel("Objeto da demanda").fill(title);
  await page.getByLabel("Justificativa", { exact: true }).fill(justification);
  await page.getByRole("button", { name: "Adicionar item" }).click();
  for (const [index, item] of items.entries()) {
    const row = page.getByRole("group", { name: "Item " + (index + 1), exact: true });
    await row.getByLabel("Descrição").fill(item.description);
    await row.getByLabel("Unidade").fill(item.unit);
    await row.getByLabel("Quantidade").fill(String(item.quantity));
  }
  await page.getByRole("button", { name: "Enviar demanda para aprovação" }).click();
  await card(page).getByText("Aguardando aprovação").waitFor();
  const filters = { tenant_id: tenantId, plan_year: 2026, title };
  const submitted = await readRows("annual_procurement_demands", filters);
  assert.equal(submitted.body.length, 1);
  const demand = submitted.body[0];
  const args = {
    p_tenant_id: tenantId,
    p_id: demand.id,
    p_action: "convert",
    p_data: { number, modality: "pregao" },
  };
  assert.ok((await callRpc("manage_annual_demand", args)).status >= 400);
  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    await reviewer.addInitScript((id) => localStorage.setItem("gfs:organizacao-id", id), tenantId);
    await reviewer.goto(appUrl + "/entrar?portal=secretaria");
    await reviewer.getByLabel("E-mail").fill("reviewer.secretaria.a@example.invalid");
    await reviewer.locator("#senha").fill(password);
    await Promise.all([
      reviewer.waitForURL(/\/painel(?:[/?#]|$)/),
      reviewer.getByRole("button", { name: "Entrar", exact: true }).click(),
    ]);
    await open(reviewer);
    await card(reviewer).getByText("Aguardando aprovação").waitFor();
    assert.equal(await reviewer.getByLabel("Objeto da demanda").count(), 0);
    await card(reviewer).getByRole("button", { name: "Aprovar demanda" }).click();
    await card(reviewer).getByText("Demanda aprovada").waitFor();
  } finally {
    await reviewerContext.close();
  }
  await open(page);
  await card(page).getByLabel("Número do processo").fill(number);
  await card(page).getByLabel("Modalidade").selectOption("pregao");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/rpc/manage_annual_demand") && r.request().method() === "POST",
    ),
    card(page).getByRole("button", { name: "Criar processo desta demanda" }).click(),
  ]);
  assert.equal(response.status(), 200);
  const processId = await response.json();
  const approved = (await readRows("annual_procurement_demands", filters)).body[0];
  assert.ok(approved.approved_at);
  assert.equal(approved.approved_by, "90000000-0000-4000-8000-000000000003");
  assert.notEqual(approved.approved_by, approved.submitted_by);
  assert.equal(approved.process_id, processId);
  assert.equal((await callRpc("manage_annual_demand", args)).body, processId);
  const processes = await readRows(
    "procurement_processes",
    { tenant_id: tenantId, number },
    "id,title,description",
  );
  assert.deepEqual(processes.body, [{ id: processId, title, description: justification }]);
  const copied = await readRows(
    "procurement_items",
    { tenant_id: tenantId, process_id: processId },
    "description,unit,quantity,line_number",
  );
  assert.deepEqual(
    copied.body
      .sort((a, b) => a.line_number - b.line_number)
      .map(({ description, unit, quantity }) => ({ description, unit, quantity })),
    items,
  );
  await open(page);
  const link = card(page).getByRole("link", { name: "Abrir DFD do processo" });
  assert.equal(
    new URL(await link.getAttribute("href"), appUrl).searchParams.get("processo"),
    processId,
  );
  await link.click();
  await page.getByRole("dialog").getByText(number, { exact: false }).first().waitFor();
  const source = page.getByRole("region", { name: "Demanda de origem do PCA" });
  await source.getByText(title, { exact: true }).waitFor();
  await source.getByText(justification, { exact: true }).waitFor();
  assert.deepEqual(
    await source.getByRole("listitem").allTextContents(),
    items.map((item) => item.description + " — " + item.quantity + " " + item.unit),
  );
  console.log(
    "PASS PCA: separate reviewer, linked process, two preserved items, retry and DFD generator",
  );
}
