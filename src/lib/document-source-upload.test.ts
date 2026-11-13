import { describe, expect, it, vi } from "vitest";
import { uploadAndLinkDocumentSource } from "./document-source-upload";

function setup(overrides: Partial<Parameters<typeof uploadAndLinkDocumentSource>[0]> = {}) {
  const upload = vi.fn(async () => ({ error: null }));
  const insertMetadata = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const isTenantCurrent = vi.fn(() => true);
  return {
    upload,
    insertMetadata,
    remove,
    isTenantCurrent,
    run: () =>
      uploadAndLinkDocumentSource({
        upload,
        insertMetadata,
        remove,
        isTenantCurrent,
        ...overrides,
      }),
  };
}

describe("DOCX source upload and metadata linking", () => {
  it("completes when upload and metadata insert succeed", async () => {
    const flow = setup();
    await expect(flow.run()).resolves.toEqual({ status: "uploaded" });
    expect(flow.upload).toHaveBeenCalledOnce();
    expect(flow.insertMetadata).toHaveBeenCalledOnce();
    expect(flow.remove).not.toHaveBeenCalled();
  });

  it("cleans up after an upload error, including a partial upload", async () => {
    const flow = setup({
      upload: async () => ({ error: { message: "storage unavailable" } }),
    });
    await expect(flow.run()).resolves.toEqual({
      status: "upload_failed",
      error: { message: "storage unavailable" },
    });
    expect(flow.insertMetadata).not.toHaveBeenCalled();
    expect(flow.remove).toHaveBeenCalledOnce();
  });

  it("cleans up when metadata insert fails", async () => {
    const flow = setup({
      insertMetadata: async () => ({ error: { message: "metadata denied" } }),
    });
    await expect(flow.run()).resolves.toEqual({
      status: "metadata_failed",
      error: { message: "metadata denied" },
    });
    expect(flow.remove).toHaveBeenCalledOnce();
  });

  it("reports a failed cleanup instead of hiding an orphaned object", async () => {
    const flow = setup({
      insertMetadata: async () => ({ error: { message: "metadata denied" } }),
      remove: async () => ({ error: { message: "cleanup denied" } }),
    });
    await expect(flow.run()).resolves.toEqual({
      status: "metadata_failed",
      error: { message: "metadata denied" },
      cleanupError: { message: "cleanup denied" },
    });
  });

  it("removes the object if the tenant changes during upload", async () => {
    const isTenantCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const flow = setup({ isTenantCurrent });
    await expect(flow.run()).resolves.toEqual({ status: "tenant_changed" });
    expect(flow.insertMetadata).not.toHaveBeenCalled();
    expect(flow.remove).toHaveBeenCalledOnce();
  });

  it("does not start an upload if the tenant has already changed", async () => {
    const flow = setup({ isTenantCurrent: () => false });
    await expect(flow.run()).resolves.toEqual({ status: "tenant_changed" });
    expect(flow.upload).not.toHaveBeenCalled();
    expect(flow.remove).not.toHaveBeenCalled();
  });

  it("cleans up after thrown upload and metadata operations", async () => {
    const uploadFlow = setup({
      upload: async () => {
        throw new Error("upload threw");
      },
    });
    await expect(uploadFlow.run()).resolves.toMatchObject({
      status: "upload_failed",
      error: { message: "upload threw" },
    });

    const metadataFlow = setup({
      insertMetadata: async () => {
        throw new Error("insert threw");
      },
    });
    await expect(metadataFlow.run()).resolves.toMatchObject({
      status: "metadata_failed",
      error: { message: "insert threw" },
    });
    expect(metadataFlow.remove).toHaveBeenCalledOnce();
  });
});
