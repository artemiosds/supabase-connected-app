import { describe, expect, it } from "vitest";
import { dataLocalIso, diasAteDataIso, resumirFichaFornecedor, situacaoDocumentoPerfil } from "./supplier-profile";

describe("Ficha 360º de fornecedores", () => {
  const hoje = "2026-11-19";

  it("diferencia documentos arquivados, vencidos e com vencimento próximo", () => {
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-11-18" }, hoje)).toBe("vencido");
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-11-19" }, hoje)).toBe("vence_hoje");
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-12-19" }, hoje)).toBe("a_vencer");
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: "2026-12-20" }, hoje)).toBe("em_dia");
    expect(situacaoDocumentoPerfil({ status: "active", expires_at: null }, hoje)).toBe("sem_vencimento");
    expect(situacaoDocumentoPerfil({ status: "archived", expires_at: "2026-01-01" }, hoje)).toBe("arquivado");
  });

  it("não sofre desvios de fuso na contagem de dias", () => {
    expect(diasAteDataIso("2026-11-18", hoje)).toBe(-1);
    expect(diasAteDataIso("2026-11-19", hoje)).toBe(0);
    expect(diasAteDataIso("2026-11-20", hoje)).toBe(1);
    expect(diasAteDataIso(null, hoje)).toBeNull();
    expect(dataLocalIso(new Date(2026, 10, 19, 23, 59))).toBe("2026-11-19");
  });

  it("separa atas, contratos, pendências e sanções de fato vigentes", () => {
    const resumo = resumirFichaFornecedor(
      [
        { status: "active", expires_at: "2026-11-18" },
        { status: "active", expires_at: "2026-11-25" },
        { status: "archived", expires_at: "2025-01-01" },
      ],
      [{ id: "q1" }, { id: "q2" }],
      [
        { instrument_type: "contrato", status: "vigente", end_date: "2026-11-25" },
        { instrument_type: "ata_registro_precos", status: "vigente", end_date: "2026-12-25" },
      ],
      [
        { status: "active", start_date: "2026-01-01", end_date: null },
        { status: "revoked", start_date: "2026-01-01", end_date: null },
      ],
      hoje,
    );
    expect(resumo).toMatchObject({
      documentos: 2,
      vencidos: 1,
      aVencer: 1,
      cotacoes: 2,
      contratos: 1,
      atas: 1,
      vencimentosContratuais: 1,
      sancoesVigentes: 1,
    });
  });
});
