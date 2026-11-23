import { describe, expect, it } from "vitest";
import {
  rotuloStatusHomologacao,
  rotuloConclusao,
  rotuloStatusChecklist,
} from "./supplier-homologation";

describe("supplier-homologation unit tests", () => {
  it("deve mapear corretamente os rótulos de status de homologação", () => {
    expect(rotuloStatusHomologacao("draft").label).toBe("Rascunho");
    expect(rotuloStatusHomologacao("in_review").label).toBe("Em Análise");
    expect(rotuloStatusHomologacao("awaiting_completion").label).toBe("Aguardando Complementação");
    expect(rotuloStatusHomologacao("completed").label).toBe("Concluída");
    expect(rotuloStatusHomologacao("cancelled").label).toBe("Cancelada");
  });

  it("deve mapear corretamente os rótulos de conclusão de análise", () => {
    expect(rotuloConclusao("regular").label).toBe("Regular para a Finalidade");
    expect(rotuloConclusao("pending").label).toBe("Com Pendências");
    expect(rotuloConclusao("rejected").label).toBe("Não Atende às Exigências");
    expect(rotuloConclusao(null).label).toBe("Não Concluída");
  });

  it("deve mapear corretamente os rótulos de verificação de itens do checklist", () => {
    expect(rotuloStatusChecklist("verified").label).toBe("Conferido e Válido");
    expect(rotuloStatusChecklist("received").label).toBe("Recebido");
    expect(rotuloStatusChecklist("awaiting_review").label).toBe("Aguardando Conferência");
    expect(rotuloStatusChecklist("pending_issue").label).toBe("Com Pendência");
    expect(rotuloStatusChecklist("expired").label).toBe("Vencido");
    expect(rotuloStatusChecklist("replaced").label).toBe("Substituído");
    expect(rotuloStatusChecklist("not_submitted").label).toBe("Não Enviado");
  });
});
