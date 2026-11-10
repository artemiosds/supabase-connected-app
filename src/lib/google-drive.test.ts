import { describe, expect, it } from "vitest";
import {
  GOOGLE_DRIVE_SCOPES,
  expectedDriveMimeType,
  isUuid,
  redirectWithDriveStatus,
  safeAppUrl,
  sanitizeDriveFileName,
  sha256Hex,
  validateDriveFileContent,
  validateDriveFileMetadata,
} from "../../supabase/functions/_shared/google-drive";

function fileFromBytes(name: string, bytes: number[], type: string): File {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  Object.defineProperty(blob, "name", { value: name, enumerable: true });
  return blob as File;
}

describe("Google Drive shared security helpers", () => {
  it("keeps the smallest expected authorization scopes", () => {
    expect(GOOGLE_DRIVE_SCOPES).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ]);
  });

  it("validates UUID values before using tenant and document identifiers", () => {
    expect(isUuid("9d7f0e7a-5e9e-4c99-8f01-37a42a4d1ce2")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("computes a stable SHA-256 hex digest for OAuth state", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("removes path separators, control characters and invalid filename characters", () => {
    expect(sanitizeDriveFileName("../Certidão:\r\n2026?.pdf")).toBe("_Certidão_2026_.pdf");
    expect(sanitizeDriveFileName("")).toBe("documento");
    expect(sanitizeDriveFileName("a".repeat(220))).toHaveLength(180);
  });

  it("maps only approved extensions to approved MIME types", () => {
    expect(expectedDriveMimeType("contrato.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(expectedDriveMimeType("contrato.exe")).toBeNull();
  });

  it("accepts browser MIME octet-stream when extension and content are verified", () => {
    expect(validateDriveFileMetadata("arquivo.pdf", "application/octet-stream", 1024)).toBeNull();
    expect(validateDriveFileMetadata("arquivo.pdf", "image/png", 1024)).toContain(
      "não corresponde",
    );
  });

  it("rejects unsupported extension, invalid size and oversized files", () => {
    expect(validateDriveFileMetadata("arquivo.exe", "application/octet-stream", 100)).toContain(
      "não permitido",
    );
    expect(validateDriveFileMetadata("arquivo.pdf", "application/pdf", 0)).toContain("20 MB");
    expect(
      validateDriveFileMetadata("arquivo.pdf", "application/pdf", 20 * 1024 * 1024 + 1),
    ).toContain("20 MB");
  });

  it("checks PDF magic bytes rather than trusting only the file extension", async () => {
    const valid = fileFromBytes("arquivo.pdf", [0x25, 0x50, 0x44, 0x46, 0x2d], "application/pdf");
    const invalid = fileFromBytes("arquivo.pdf", [0x4d, 0x5a, 0x00, 0x00], "application/pdf");
    await expect(validateDriveFileContent(valid)).resolves.toBeNull();
    await expect(validateDriveFileContent(invalid)).resolves.toContain("PDF válido");
  });

  it("checks Office and image signatures", async () => {
    const docx = fileFromBytes(
      "modelo.docx",
      [0x50, 0x4b, 0x03, 0x04, 0x00, 0x00],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const jpeg = fileFromBytes("imagem.jpg", [0xff, 0xd8, 0xff, 0xe0], "image/jpeg");
    const png = fileFromBytes(
      "imagem.png",
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "image/png",
    );
    await expect(validateDriveFileContent(docx)).resolves.toBeNull();
    await expect(validateDriveFileContent(jpeg)).resolves.toBeNull();
    await expect(validateDriveFileContent(png)).resolves.toBeNull();
  });

  it("accepts HTTPS application URLs and localhost development, rejecting unsafe URLs", () => {
    expect(safeAppUrl("https://sistema.example.gov.br")?.origin).toBe(
      "https://sistema.example.gov.br",
    );
    expect(safeAppUrl("http://localhost:5173")?.origin).toBe("http://localhost:5173");
    expect(safeAppUrl("http://sistema.example.gov.br")).toBeNull();
    expect(safeAppUrl("https://user:password@sistema.example.gov.br")).toBeNull();
    expect(safeAppUrl("https://sistema.example.gov.br/?token=secret")).toBeNull();
  });

  it("builds a fixed settings redirect and sanitizes callback status reasons", () => {
    const appUrl = new URL("https://sistema.example.gov.br");
    const result = redirectWithDriveStatus(appUrl, "error", "scope_missing" + "x".repeat(60));
    expect(result.origin).toBe(appUrl.origin);
    expect(result.pathname).toBe("/configuracoes");
    expect(result.searchParams.get("drive")).toBe("error");
    expect(result.searchParams.get("drive_reason")).toHaveLength(40);
  });
});
