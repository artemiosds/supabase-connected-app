import { it, expect } from "vitest";

import { buildDocxFromText, generateDocx, docxToModel, renderPdf } from "./index";
import { DEFAULT_BRANDING } from "./branding";
it("gera mapa com tabela longa e assinatura", async () => {
  const text = [
    "Processo de homologação local",
    "Fonte\tCNPJ\tData\tUnitário\tFrete\tEfetivo",
    ...Array.from(
      { length: 45 },
      (_, i) => `Fonte ${i + 1}\tNão informado\t18/11/2026\tR$ 100,00\tR$ 20,00\tR$ 102,00`,
    ),
    "ASSINATURA ELETRÔNICA SIMPLES",
    "Exemplo sintético local — sem validade",
  ].join("\n");
  const branding = { ...DEFAULT_BRANDING, headerTitle: "Secretaria — Homologação local" };
  const doc = await generateDocx({
    template: await buildDocxFromText(text, "MAPA COMPARATIVO"),
    values: {},
    items: [],
    branding,
  });
  const pdf = await renderPdf(
    { ...(await docxToModel(doc.bytes)), footerText: [] },
    { branding, title: "Mapa" },
  );
  expect(pdf.length).toBeGreaterThan(1000);
});
