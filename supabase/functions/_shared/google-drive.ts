export const GOOGLE_DRIVE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const GOOGLE_DRIVE_MIME_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;

const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sanitizeDriveFileName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\u0000-\\u001f\\u007f]/g, "")
    .replace(/[\\\\/<>:"|?*]/g, "_")
    .replace(/\\s+/g, " ")
    .trim()
    .replace(/^\\.+|\\.+$/g, "");
  return (normalized || "documento").slice(0, 180);
}

export function validateDriveFileMetadata(
  fileName: string,
  mimeType: string,
  size: number,
): string | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!Object.hasOwn(MIME_EXTENSIONS, mimeType)) {
    return "Tipo de arquivo não permitido. Use PDF, DOC, DOCX, XLS, XLSX, JPG ou PNG.";
  }
  if (!MIME_EXTENSIONS[mimeType]?.includes(extension)) {
    return "A extensão do arquivo não corresponde ao formato informado.";
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > 20 * 1024 * 1024) {
    return "O arquivo deve ter até 20 MB.";
  }
  return null;
}

export async function validateDriveFileContent(file: File): Promise<string | null> {
  const metadataError = validateDriveFileMetadata(file.name, file.type, file.size);
  if (metadataError) return metadataError;

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const startsWith = (...bytes: number[]) => bytes.every((value, index) => header[index] === value);

  switch (file.type) {
    case "application/pdf":
      if (!startsWith(0x25, 0x50, 0x44, 0x46)) return "O conteúdo não corresponde a um PDF válido.";
      break;
    case "application/msword":
    case "application/vnd.ms-excel":
      if (!startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
        return "O conteúdo não corresponde a um documento Office antigo válido.";
      }
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      if (!startsWith(0x50, 0x4b, 0x03, 0x04)) {
        return "O conteúdo não corresponde a um arquivo Office moderno válido.";
      }
      break;
    case "image/jpeg":
      if (!startsWith(0xff, 0xd8, 0xff)) return "O conteúdo não corresponde a uma imagem JPEG válida.";
      break;
    case "image/png":
      if (!startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
        return "O conteúdo não corresponde a uma imagem PNG válida.";
      }
      break;
  }
  return null;
}

export function safeAppUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function redirectWithDriveStatus(appUrl: URL, status: "connected" | "error", reason?: string): URL {
  const destination = new URL("/configuracoes", appUrl.origin);
  destination.searchParams.set("drive", status);
  if (reason) destination.searchParams.set("drive_reason", reason.slice(0, 40));
  return destination;
}
