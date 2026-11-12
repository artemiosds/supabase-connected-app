BEGIN;

-- The editable text remains on document_templates; the original Word file is an
-- optional, immutable attachment to exactly one archived version.
CREATE TABLE public.document_template_sources (
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_size bigint NOT NULL CHECK (file_size BETWEEN 1 AND 20971520),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version),
  FOREIGN KEY (template_id, tenant_id) REFERENCES public.document_templates(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (template_id, version) REFERENCES public.document_template_versions(template_id, version) ON DELETE RESTRICT,
  CONSTRAINT document_template_sources_path_check CHECK (
    storage_path ~* (
      '^' || tenant_id::text || '/template-sources/' || template_id::text ||
      '/v' || version::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.docx$'
    )
  )
);

CREATE INDEX idx_document_template_sources_tenant_version
  ON public.document_template_sources (tenant_id, template_id, version DESC);

ALTER TABLE public.document_template_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_template_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.document_template_sources TO authenticated;

CREATE POLICY document_template_sources_select ON public.document_template_sources
  FOR SELECT TO authenticated USING (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view'))
    AND (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'modelos'))
  );

CREATE POLICY document_template_sources_insert ON public.document_template_sources
  FOR INSERT TO authenticated WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:manage_templates'))
    AND (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'modelos'))
    AND EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'gfs-private-documents' AND o.name = storage_path
    )
  );

CREATE POLICY gfs_private_template_sources_upload ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'gfs-private-documents'
    AND name ~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '/template-sources/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '/v[1-9][0-9]*/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.docx$'
    )
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       AND split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN
        (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:manage_templates'))
        AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'modelos'))
        AND EXISTS (
          SELECT 1 FROM public.document_templates t
          WHERE t.id = split_part(name, '/', 3)::uuid
            AND t.tenant_id = split_part(name, '/', 1)::uuid
            AND t.version::text = substring(split_part(name, '/', 4) from 2)
        )
      ELSE false
    END
  );

CREATE POLICY gfs_private_template_sources_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'gfs-private-documents'
    AND EXISTS (
      SELECT 1 FROM public.document_template_sources s
      WHERE s.storage_path = storage.objects.name
        AND (SELECT app_auth.has_tenant_data_permission(s.tenant_id, 'documents:view'))
        AND (SELECT app_auth.is_tenant_in_good_standing(s.tenant_id))
        AND (SELECT app_auth.is_tenant_module_enabled(s.tenant_id, 'modelos'))
    )
  );

-- A failed metadata write may leave a private upload; only its uploader may
-- read and remove that unlinked object. Linked sources remain immutable.
CREATE POLICY gfs_private_template_sources_orphan_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'gfs-private-documents'
    AND name ~* '/template-sources/.*/v[1-9][0-9]*/.*\.docx$'
    AND owner_id = (SELECT auth.uid()::text)
    AND NOT EXISTS (SELECT 1 FROM public.document_template_sources s WHERE s.storage_path = storage.objects.name)
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:manage_templates'))
      ELSE false
    END
  );

CREATE POLICY gfs_private_template_sources_orphan_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'gfs-private-documents'
    AND name ~* '/template-sources/.*/v[1-9][0-9]*/.*\.docx$'
    AND owner_id = (SELECT auth.uid()::text)
    AND NOT EXISTS (SELECT 1 FROM public.document_template_sources s WHERE s.storage_path = storage.objects.name)
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{12}$'
      THEN (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:manage_templates'))
      ELSE false
    END
  );

COMMENT ON TABLE public.document_template_sources IS
  'DOCX original privado associado a uma versao historica de modelo, sem sobrescrita.';
COMMIT;
