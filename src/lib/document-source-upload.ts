export type DocumentSourceError = { message: string };

export type DocumentSourceLinkResult =
  | { status: "uploaded" }
  | { status: "upload_failed"; error: DocumentSourceError; cleanupError?: DocumentSourceError }
  | { status: "metadata_failed"; error: DocumentSourceError; cleanupError?: DocumentSourceError }
  | { status: "tenant_changed"; cleanupError?: DocumentSourceError };

type OperationResult = { error: DocumentSourceError | null };

function toDocumentSourceError(error: unknown): DocumentSourceError {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Coordinates the non-transactional Storage + metadata write.
 * Any object that cannot be linked is removed; cleanup failures remain explicit.
 */
export async function uploadAndLinkDocumentSource(input: {
  upload: () => Promise<OperationResult>;
  insertMetadata: () => Promise<OperationResult>;
  remove: () => Promise<OperationResult>;
  isTenantCurrent: () => boolean;
}): Promise<DocumentSourceLinkResult> {
  if (!input.isTenantCurrent()) return { status: "tenant_changed" };

  let uploadError: DocumentSourceError | null;
  try {
    uploadError = (await input.upload()).error;
  } catch (error) {
    uploadError = toDocumentSourceError(error);
  }

  if (uploadError) {
    let cleanupError: DocumentSourceError | undefined;
    try {
      cleanupError = (await input.remove()).error ?? undefined;
    } catch (error) {
      cleanupError = toDocumentSourceError(error);
    }
    return cleanupError
      ? { status: "upload_failed", error: uploadError, cleanupError }
      : { status: "upload_failed", error: uploadError };
  }

  if (!input.isTenantCurrent()) {
    let cleanupError: DocumentSourceError | undefined;
    try {
      cleanupError = (await input.remove()).error ?? undefined;
    } catch (error) {
      cleanupError = toDocumentSourceError(error);
    }
    return cleanupError ? { status: "tenant_changed", cleanupError } : { status: "tenant_changed" };
  }

  let metadataError: DocumentSourceError | null;
  try {
    metadataError = (await input.insertMetadata()).error;
  } catch (error) {
    metadataError = toDocumentSourceError(error);
  }

  if (!metadataError) return { status: "uploaded" };

  let cleanupError: DocumentSourceError | undefined;
  try {
    cleanupError = (await input.remove()).error ?? undefined;
  } catch (error) {
    cleanupError = toDocumentSourceError(error);
  }
  return cleanupError
    ? { status: "metadata_failed", error: metadataError, cleanupError }
    : { status: "metadata_failed", error: metadataError };
}
