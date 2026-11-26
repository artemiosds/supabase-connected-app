import { expect, it } from "vitest";
import {
  calculateItemTotal,
  normalizeHealthUnit,
  parsePastedItems,
} from "./procurement-items-parser";
it("imports five Excel rows with localized decimals and totals", () => {
  const rows = parsePastedItems(
    "Descrição\tUnidade\tQuantidade\tPreço\r\nAmoxicilina 500mg\tcp\t5000\t0,45\r\nDipirona 500mg\tamp\t1.500,75\t12,50\nGaze estéril\tpct\t10\t2\nSoro fisiológico\tfr\t2\t5\nLuvas\tcx\t3\t10",
    "Almoxarifado",
  );
  expect(rows).toHaveLength(5);
  expect(rows.every((r) => r.isValid)).toBe(true);
  expect(rows[0]).toMatchObject({
    unit: "COMPRIMIDO",
    estimated_total: 2250,
    delivery_location: "Almoxarifado",
  });
  expect(rows[1]).toMatchObject({ quantity: 1500.75, unit: "AMPOLA", estimated_total: 18759.38 });
});
it("supports quoted CSV, semicolon, reordered headers and numbering", () => {
  expect(parsePastedItems('"Gaze, estéril",pct,10,"1,25"')[0]).toMatchObject({
    isValid: true,
    description: "Gaze, estéril",
    estimated_total: 12.5,
  });
  expect(
    parsePastedItems("Item;Descrição;Unidade;Qtd;Valor\n1;Seringa;un;10;1,50")[0],
  ).toMatchObject({ isValid: true, quantity: 10 });
  expect(parsePastedItems("Qtd;Unidade;Descrição;Preço\n10;fr;Soro;2,50")[0]).toMatchObject({
    isValid: true,
    description: "Soro",
  });
  expect(parsePastedItems("1\tSeringa\tun\t10\t2")[0]?.isValid).toBe(true);
});
it.each(["0", "-2", "banana", "1,2x", "1e3"])("rejects invalid quantities %s", (quantity) => {
  expect(parsePastedItems("Seringa\tun\t" + quantity + "\t2")[0]?.isValid).toBe(false);
});
it("keeps row errors and missing estimates explicit", () => {
  expect(parsePastedItems("\tun\t2\t1")[0]?.isValid).toBe(false);
  expect(parsePastedItems("Seringa\tun\t10")[0]).toMatchObject({
    isValid: true,
    estimated_unit_price: null,
    estimated_total: null,
  });
  expect(parsePastedItems("Seringa,un,10,0,45")[0]?.isValid).toBe(false);
  expect(parsePastedItems('"Seringa\tun\t10\t2')[0]?.isValid).toBe(false);
  expect(parsePastedItems("Seringa\tun\t10\t-1")[0]?.isValid).toBe(false);
});
it("supports BOM, multiline quoted cells, known units and custom units", () => {
  expect(
    parsePastedItems('\uFEFFDescrição;Unidade;Qtd;Valor\n"Seringa\n20ml";und;2;1,00')[0],
  ).toMatchObject({ isValid: true, unit: "UNIDADE" });
  expect(normalizeHealthUnit("comp")).toBe("COMPRIMIDO");
  expect(normalizeHealthUnit("ml")).toBe("ML");
  expect(parsePastedItems("")).toEqual([]);
});

it("handles item header aliases, decimal scale and monetary rounding", () => {
  expect(parsePastedItems("Item;Unidade;Qtd.;Valor\nSeringa;un;10;2")[0]?.isValid).toBe(true);
  expect(parsePastedItems("Seringa\tun\t0,000001\t1")[0]?.isValid).toBe(false);
  expect(calculateItemTotal(3, 0.335)).toBe(1.01);
});

it("keeps a real first item named Produto", () => {
  expect(parsePastedItems("Produto\tUN\t10\t2")).toHaveLength(1);
});

it("supports numbered 4-column headerless rows without unit price", () => {
  expect(parsePastedItems("1\tSeringa 10ml\tun\t250")[0]).toMatchObject({
    isValid: true,
    description: "Seringa 10ml",
    unit: "UNIDADE",
    quantity: 250,
    estimated_unit_price: null,
  });
  expect(parsePastedItems("123\tun\t10\t2")[0]).toMatchObject({
    isValid: true,
    description: "123",
    unit: "UNIDADE",
    quantity: 10,
    estimated_unit_price: 2,
  });
});
