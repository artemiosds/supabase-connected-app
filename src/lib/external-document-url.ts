const MAX_EXTERNAL_DOCUMENT_URL_LENGTH = 2048;
const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

export function normalizeExternalDocumentUrl(value: string): string | null {
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_EXTERNAL_DOCUMENT_URL_LENGTH ||
    /[\u0000-\u0020\u007f]/u.test(candidate)
  ) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function extractGoogleDriveFileId(value: string): string | null {
  const normalizedUrl = normalizeExternalDocumentUrl(value);
  if (!normalizedUrl) return null;

  const url = new URL(normalizedUrl);
  if (!GOOGLE_DRIVE_HOSTS.has(url.hostname)) return null;

  const pathMatch = url.pathname.match(/\/d\/([A-Za-z0-9_-]+)/);
  const queryId = url.searchParams.get("id");
  const fileId = pathMatch?.[1] ?? queryId;

  return fileId && /^[A-Za-z0-9_-]+$/.test(fileId) ? fileId : null;
}
