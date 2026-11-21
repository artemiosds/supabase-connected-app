import { expect, it, vi } from "vitest";
import { lookupCep, normalizeCep } from "./cep";
it("normalizes CEP and rejects incomplete input", async () => {
  expect(normalizeCep("50.000-001")).toBe("50000001");
  await expect(lookupCep("123")).rejects.toThrow("8 dígitos");
});
it("uses ViaCEP when BrasilAPI fails", async () => {
  const mock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cep: "50000-001",
          localidade: "Recife",
          uf: "PE",
          logradouro: "Rua",
          bairro: "Centro",
        }),
      ),
    );
  expect(await lookupCep("50000-001", mock)).toMatchObject({
    city: "Recife",
    state: "PE",
    street: "Rua",
  });
  expect(mock).toHaveBeenCalledTimes(2);
});
it("rejects wrong CEP responses and keeps fallback available", async () => {
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ cep: "99999999", city: "Errada", state: "SP" })),
    )
    .mockResolvedValueOnce(new Response('{"erro":true}'));
  await expect(lookupCep("50000001", mock)).rejects.toThrow();
});
