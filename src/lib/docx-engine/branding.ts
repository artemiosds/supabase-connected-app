export type DocumentBranding = {
  headerTitle: string;
  headerSubtitle: string;
  footerText: string;
  logoBase64: string | null;
  logoMime: "image/png" | "image/jpeg" | null;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  showPageNumbers: boolean;
};

export const MAX_LOGO_BYTES = 300 * 1024;

export const DEFAULT_BRANDING: DocumentBranding = {
  headerTitle: "",
  headerSubtitle: "",
  footerText: "",
  logoBase64: null,
  logoMime: null,
  marginTopMm: 30,
  marginBottomMm: 20,
  marginLeftMm: 30,
  marginRightMm: 20,
  showPageNumbers: true,
};

export const MARGIN_LIMITS = { min: 10, max: 50 } as const;

export function clampMargin(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(MARGIN_LIMITS.max, Math.max(MARGIN_LIMITS.min, Math.round(value)));
}

export function brandingHasHeader(b: DocumentBranding): boolean {
  return Boolean(b.headerTitle.trim() || b.headerSubtitle.trim() || b.logoBase64);
}

export function mmToTwips(mm: number): number {
  return Math.round((mm / 25.4) * 1440);
}

export function mmToPoints(mm: number): number {
  return (mm / 25.4) * 72;
}

/** Detects PNG/JPEG by magic bytes; never trusts the file extension. */
export function detectLogoMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Pixel size of a PNG/JPEG, used to keep the brasão aspect ratio. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const mime = detectLogoMime(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png" && bytes.length > 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const len = view.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
