BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Storage checks RLS once before transfer using {mimetype, contentLength},
-- then persists the final object metadata with {mimetype, size}.
-- Accept either representation so private letterhead uploads can pass the
-- preflight without weakening tenant, path, MIME or size restrictions.
DROP POLICY IF EXISTS gfs_tenant_document_branding_upload ON storage.objects;

CREATE POLICY gfs_tenant_document_branding_upload
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gfs-private-documents'
    AND name ~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '/document-branding/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg)$'
    )
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN
        (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'org:edit'))
        AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
        AND metadata->>'mimetype' IN ('image/png', 'image/jpeg')
        AND CASE
          WHEN COALESCE(NULLIF(metadata->>'size', ''), NULLIF(metadata->>'contentLength', '')) ~ '^[0-9]+$'
          THEN COALESCE(NULLIF(metadata->>'size', ''), NULLIF(metadata->>'contentLength', ''))::bigint
            BETWEEN 1 AND 307200
          ELSE false
        END
      ELSE false
    END
  );

COMMENT ON POLICY gfs_tenant_document_branding_upload ON storage.objects IS
  'Allows authorized tenant editors to upload private PNG/JPEG letterheads, validating Storage preflight contentLength or finalized size metadata.';

COMMIT;
