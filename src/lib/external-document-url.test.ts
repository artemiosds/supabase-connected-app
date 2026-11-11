import { describe, expect, it } from "vitest";
import {
  extractGoogleDriveFileId,
  normalizeExternalDocumentUrl,
} from "@/lib/external-document-url";

describe("normalizeExternalDocumentUrl", () => {
  it("trims and canonicalizes HTTP(S) links", () => {
    expect(normalizeExternalDocumentUrl("  HTTPS://example.com/document  ")).toBe(
      "https://example.com/document",
    );
    expect(normalizeExternalDocumentUrl("http://example.com/document")).toBe(
      "http://example.com/document",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com/file",
    "https://user:secret@example.com/file",
    "https://example.com/a document",
    "not a URL",
  ])("rejects unsafe or malformed input: %s", (value) => {
    expect(normalizeExternalDocumentUrl(value)).toBeNull();
  });

  it("rejects URLs longer than 2,048 characters", () => {
    expect(normalizeExternalDocumentUrl(`https://example.com/${"a".repeat(2040)}`)).toBeNull();
  });
});

describe("extractGoogleDriveFileId", () => {
  it("extracts the ID from a Drive file URL", () => {
    expect(extractGoogleDriveFileId("https://drive.google.com/file/d/Abc_123/view")).toBe(
      "Abc_123",
    );
  });

  it("extracts an ID from an allowed Google Drive host query", () => {
    expect(extractGoogleDriveFileId("https://docs.google.com/open?id=Abc-123")).toBe("Abc-123");
  });

  it("does not treat lookalike domains as Google Drive", () => {
    expect(
      extractGoogleDriveFileId("https://drive.google.com.example.org/file/d/Abc_123"),
    ).toBeNull();
  });
});
