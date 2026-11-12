BEGIN;

ALTER TABLE public.supplier_documents
  ADD CONSTRAINT supplier_documents_external_url_http_valid
  CHECK (
    external_url IS NULL
    OR (
      length(external_url) <= 2048
      AND external_url ~* '^https?://[^[:space:]@/]+([/?#][^[:space:]]*)?$'
    )
  );

COMMIT;
