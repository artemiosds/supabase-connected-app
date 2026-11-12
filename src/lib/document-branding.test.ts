import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "@/lib/docx-engine";
import { mapDocumentBranding } from "./document-branding";

describe("configuração de timbrado por Secretaria", () => {
  it("uses safe defaults when the tenant has no branding row", () => {
    expect(mapDocumentBranding(null, "Secretaria Municipal de Saúde")).toEqual({
      ...DEFAULT_BRANDING,
      headerTitle: "Secretaria Municipal de Saúde",
    });
  });

  it("maps custom text, margins and page numbering without sharing state", () => {
    const branding = mapDocumentBranding(
      {
        header_title: "SMS Exemplo",
        header_subtitle: "Prefeitura Municipal",
        footer_text: "Documento institucional",
        margin_top_mm: 25,
        margin_bottom_mm: 18,
        margin_left_mm: 22,
        margin_right_mm: 15,
        show_page_numbers: false,
        logo_storage_path: null,
        logo_mime: null,
      },
      "Nome cadastral",
    );
    expect(branding).toMatchObject({
      headerTitle: "SMS Exemplo",
      headerSubtitle: "Prefeitura Municipal",
      footerText: "Documento institucional",
      marginTopMm: 25,
      marginBottomMm: 18,
      marginLeftMm: 22,
      marginRightMm: 15,
      showPageNumbers: false,
      logoBase64: null,
      logoMime: null,
    });
  });

  it("clamps persisted margins to the supported print range", () => {
    const branding = mapDocumentBranding(
      {
        header_title: "",
        header_subtitle: "",
        footer_text: "",
        margin_top_mm: 2,
        margin_bottom_mm: 70,
        margin_left_mm: 30,
        margin_right_mm: 20,
        show_page_numbers: true,
        logo_storage_path: null,
        logo_mime: null,
      },
      "SMS",
    );
    expect(branding.marginTopMm).toBe(10);
    expect(branding.marginBottomMm).toBe(50);
    expect(branding.headerTitle).toBe("SMS");
  });
});
