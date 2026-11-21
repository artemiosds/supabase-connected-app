import assert from "node:assert/strict";

export async function verifyBatchItems({ page, appUrl, tenantId, callRpc, readRows }) {
  const number = "E2E-LOTE-001";
  const result = await callRpc("create_procurement_process_with_checklist", {
    p_tenant_id: tenantId,
    p_number: number,
    p_title: "Importação sintética de itens de saúde",
  });
  assert.equal(result.status, 200);
  const processId = result.body;
  await page.goto(appUrl + "/processos?processo=" + processId, { waitUntil: "networkidle" });
  const details = page.getByRole("dialog").filter({ hasText: number });
  await details.getByRole("button", { name: "Itens, preços e orçamento", exact: false }).click();
  const composition = page
    .getByRole("dialog")
    .filter({ hasText: "Composição da contratação — " + number });
  await composition.getByRole("button", { name: "Adicionar item", exact: true }).click();
  const individual = composition.locator("form").filter({ hasText: "Descrição do item *" });
  const inputs = individual.locator("input");
  await inputs.nth(0).fill("Item inicial do processo");
  await individual.getByRole("button", { name: "AMPOLA", exact: true }).click();
  await inputs.nth(2).fill("2");
  await inputs.nth(3).fill("1,50");
  await individual.getByText(/Total estimado do item:.*3,00/).waitFor();
  await individual.getByRole("button", { name: "Salvar item", exact: true }).click();
  await individual.waitFor({ state: "hidden" });
  await composition.getByRole("button", { name: "Importar Planilha", exact: true }).click();
  const batch = page.getByRole("dialog", { name: "Colar da Planilha (Lote)", exact: true });
  await batch.getByLabel("Local de entrega padrão").fill("Almoxarifado CI");
  const pasted =
    "Descrição\tUnidade\tQtd\tPreço\nAmoxicilina 500mg\tcp\t5000\t0,45\nDipirona 500mg\tamp\t10\t1,50\nSoro fisiológico\tfr\t3\t5,20\nGaze estéril\tpct\t5\t2\nLuva cirúrgica\tpar\t2\t3";
  await batch.getByLabel("Itens da planilha").fill(pasted);
  await batch.getByText("5 itens válidos", { exact: true }).waitFor();
  await batch.getByText(/Valor total previsto da contratação:.*2\.296,60/).waitFor();
  await batch.getByRole("button", { name: "Salvar 5 Itens no Processo", exact: true }).click();
  await batch.waitFor({ state: "hidden" });
  const rows = await readRows(
    "procurement_items",
    { tenant_id: tenantId, process_id: processId },
    "id,line_number,description,unit,quantity,estimated_unit_price,estimated_total,delivery_location",
  );
  assert.equal(rows.body.length, 6);
  const ordered = rows.body.sort((a, b) => a.line_number - b.line_number);
  assert.deepEqual(
    ordered.map((row) => row.line_number),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(ordered[1].unit, "COMPRIMIDO");
  assert.equal(ordered[1].estimated_total, 2250);
  assert.ok(ordered.slice(1).every((row) => row.delivery_location === "Almoxarifado CI"));
  await composition.getByText("2. Amoxicilina 500mg", { exact: true }).waitFor();
  console.log(
    "PASS batch items: individual unit and total, five pasted rows, exact estimate, atomic insert and continuous numbering",
  );
}
