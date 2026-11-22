import assert from "node:assert/strict";

export async function verifyBatchItems({
  page,
  appUrl,
  tenantId,
  callRpc,
  readRows,
}) {
  const number = "E2E-LOTE-001";
  const result = await callRpc("create_procurement_process_with_checklist", {
    p_tenant_id: tenantId,
    p_number: number,
    p_title: "Importação sintética de itens de saúde",
  });
  assert.equal(result.status, 200);
  const processId = result.body;
  await page.goto(appUrl + "/processos?processo=" + processId, {
    waitUntil: "networkidle",
  });
  const details = page.getByRole("dialog").filter({ hasText: number });
  await details
    .getByRole("button", { name: "Itens, preços e orçamento", exact: false })
    .click();
  const composition = page
    .getByRole("dialog")
    .filter({ hasText: "Composição da contratação — " + number });
  await composition
    .getByRole("button", { name: "Adicionar item", exact: true })
    .click();
  const individual = composition
    .locator("form")
    .filter({ hasText: "Descrição do item *" });
  const inputs = individual.locator("input");
  await inputs.nth(0).fill("Item inicial do processo");
  await individual.getByRole("button", { name: "AMPOLA", exact: true }).click();
  await inputs.nth(2).fill("2");
  await inputs.nth(3).fill("1,50");
  await individual.getByText(/Total estimado do item:.*3,00/).waitFor();
  await individual
    .getByRole("button", { name: "Salvar item", exact: true })
    .click();
  await individual.waitFor({ state: "hidden" });
  await composition
    .getByRole("button", { name: "Importar Planilha", exact: true })
    .click();
  const batch = page.getByRole("dialog", {
    name: "Colar da Planilha (Lote)",
    exact: true,
  });
  await batch.getByLabel("Local de entrega padrão").fill("Almoxarifado CI");
  const pasted =
    "Descrição\tUnidade\tQtd\tPreço\nAmoxicilina 500mg\tcp\t5000\t0,45\nDipirona 500mg\tamp\t10\t1,50\nSoro fisiológico\tfr\t3\t5,20\nGaze estéril\tpct\t5\t2\nLuva cirúrgica\tpar\t2\t3";
  await batch.getByLabel("Itens da planilha").fill(pasted);
  await batch.getByText("5 itens válidos", { exact: true }).waitFor();
  await batch
    .getByText(/Valor total previsto da contratação:.*2\.296,60/)
    .waitFor();
  let dropResponse = true;
  let staleCheck = true;
  await page.route("**/rest/v1/procurement_items**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      dropResponse &&
      Array.isArray(request.postDataJSON())
    ) {
      dropResponse = false;
      const committed = await route.fetch();
      assert.ok(
        committed.ok(),
        "the bulk insert must commit before simulating a lost response",
      );
      await route.abort("failed");
      return;
    }
    if (
      request.method() === "GET" &&
      !dropResponse &&
      staleCheck &&
      url.searchParams.has("id")
    ) {
      staleCheck = false;
      await route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: [],
      });
      return;
    }
    await route.continue();
  });
  await batch
    .getByRole("button", { name: "Salvar 5 Itens no Processo", exact: true })
    .click();
  await batch
    .getByRole("button", { name: "Verificar gravação", exact: true })
    .click();

  await batch.waitFor({ state: "hidden" });
  await page.unroute("**/rest/v1/procurement_items**");
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
  assert.ok(
    ordered
      .slice(1)
      .every((row) => row.delivery_location === "Almoxarifado CI"),
  );
  await composition
    .getByText("2. Amoxicilina 500mg", { exact: true })
    .waitFor();
  console.log(
    "PASS batch items: individual unit and total, five pasted rows, exact estimate, atomic insert, lost-response recovery without duplicates and continuous numbering",
  );
  await composition
    .getByRole("button", { name: "Lançar Proposta Comercial", exact: true })
    .click();
  const proposal = page.getByRole("dialog", {
    name: "Lançar Proposta Comercial",
    exact: true,
  });
  await proposal.getByRole("combobox").click();
  await page
    .getByRole("option", {
      name: "Fornecedor Sintético Exclusivo A",
      exact: true,
    })
    .click();
  await proposal.getByLabel("Número da proposta").fill("E2E-PROPOSTA-001");
  await proposal.getByLabel("Responsável").fill("Contato sintético");
  await proposal.getByLabel("E-mail").fill("proposta@example.invalid");
  await proposal.getByLabel("Telefone").fill("11912345678");
  await proposal.getByLabel("Endereço").fill("Rua sintética 1");
  await proposal
    .getByLabel("Justificativa da escolha")
    .fill("Fornecedor consultado para teste descartável");
  await proposal.getByLabel("Prazo de resposta").fill("2027-01-01");
  await proposal
    .getByLabel("Proposta formal")
    .setInputFiles({
      name: "proposta.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% synthetic fixture\n%%EOF"),
    });
  await proposal
    .getByRole("button", { name: "Preencher valores em lote (Colar coluna)" })
    .click();
  await proposal
    .getByPlaceholder("Uma linha por item na ordem exibida")
    .fill("1,50\n0,45\n\n5,00\n0\n");
  await proposal.getByRole("button", { name: "Aplicar coluna" }).click();
  await proposal.getByText("3 itens cotados de 6", { exact: true }).waitFor();
  await proposal
    .getByText(/Valor Total da Proposta Comercial:.*2\\.268,00/)
    .waitFor();
  await proposal
    .getByRole("button", { name: "Salvar Cotações (3 itens)", exact: true })
    .click();
  await proposal.waitFor({ state: "hidden" });
  for (const [index, item] of ordered.entries()) {
    const quotes = await readRows(
      "procurement_price_quotes",
      { tenant_id: tenantId, procurement_item_id: item.id },
      "supplier_id,unit_price,evidence_storage_path",
    );
    assert.equal(quotes.body.length, [0, 1, 3].includes(index) ? 1 : 0);
    if (quotes.body.length) {
      assert.equal(
        quotes.body[0].supplier_id,
        "94000000-0000-4000-8000-000000000001",
      );
      assert.ok(quotes.body[0].evidence_storage_path);
    }
  }
  console.log(
    "PASS batch proposal: three quoted items, shared supplier and formal evidence",
  );
}
