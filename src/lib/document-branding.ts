import { db } from "@/lib/db";
import type { Tables } from "@/integrations/supabase/types";
import {
  DEFAULT_BRANDING,
  MAX_LOGO_BYTES,
  bytesToBase64,
  clampMargin,
  detectLogoMime,
  imageSize,
  type DocumentBranding,
} from "@/lib/docx-engine";

type BrandingRow = Pick<
  Tables<"tenant_document_branding">,
  | "header_title"
  | "header_subtitle"
  | "footer_text"
  | "margin_top_mm"
  | "margin_bottom_mm"
  | "margin_left_mm"
  | "margin_right_mm"
  | "show_page_numbers"
  | "logo_storage_path"
  | "logo_mime"
>;

export function isMissingDocumentBrandingTable(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export function mapDocumentBranding(
  row: BrandingRow | null,
  tenantName: string,
  logoBase64: string | null = null,
  logoMime: DocumentBranding["logoMime"] = null,
): DocumentBranding {
  return {
    ...DEFAULT_BRANDING,
    headerTitle: row?.header_title.trim() || tenantName,
    headerSubtitle: row?.header_subtitle ?? "",
    footerText: row?.footer_text ?? "",
    logoBase64,
    logoMime,
    marginTopMm: clampMargin(row?.margin_top_mm ?? DEFAULT_BRANDING.marginTopMm),
    marginBottomMm: clampMargin(row?.margin_bottom_mm ?? DEFAULT_BRANDING.marginBottomMm),
    marginLeftMm: clampMargin(row?.margin_left_mm ?? DEFAULT_BRANDING.marginLeftMm),
    marginRightMm: clampMargin(row?.margin_right_mm ?? DEFAULT_BRANDING.marginRightMm),
    showPageNumbers: row?.show_page_numbers ?? DEFAULT_BRANDING.showPageNumbers,
  };
}

/** Loads only the selected tenant's private logo and letterhead settings. */
export async function carregarTimbradoSecretaria(
  tenantId: string,
  tenantName: string,
): Promise<DocumentBranding> {
  const { data, error } = await db
    .from("tenant_document_branding")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    if (isMissingDocumentBrandingTable(error)) return mapDocumentBranding(null, tenantName);
    throw error;
  }
  if (!data) return mapDocumentBranding(null, tenantName);

  let logoBase64: string | null = null;
  let logoMime: DocumentBranding["logoMime"] = null;
  if (data.logo_storage_path) {
    const { data: file, error: downloadError } = await db.storage
      .from("gfs-private-documents")
      .download(data.logo_storage_path);
    if (downloadError || !file) {
      throw downloadError ?? new Error("O brasão privado da Secretaria não está disponível.");
    }
    if (file.size < 1 || file.size > MAX_LOGO_BYTES) {
      throw new Error("O brasão armazenado ultrapassa o limite de 300 KB.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = detectLogoMime(bytes);
    const dimensions = imageSize(bytes);
    if (
      !detectedMime ||
      detectedMime !== data.logo_mime ||
      !dimensions ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > 4096 ||
      dimensions.height > 4096 ||
      dimensions.width * dimensions.height > 12_000_000
    ) {
      throw new Error("O brasão armazenado é inválido. Envie novamente um PNG ou JPEG.");
    }
    logoBase64 = bytesToBase64(bytes);
    logoMime = detectedMime;
  }

  return mapDocumentBranding(data, tenantName, logoBase64, logoMime);
}
