import { expect, it } from "vitest";
import { classifySupplierCnae } from "./supplier-cnae-classifier";
it.each([
  ["4644-3/01", "medicamentos"],
  ["4771701", "medicamentos"],
  ["4645-1", "materiais_hospitalares"],
  ["4773-3", "materiais_hospitalares"],
  ["4664-8", "equipamentos"],
  ["3313-1", "equipamentos"],
  ["86.10-1", "servicos"],
  ["77", "servicos"],
  ["", "outros"],
  ["123", "outros"],
])("classifies %s as %s", (code, category) => expect(classifySupplierCnae(code)).toBe(category));
