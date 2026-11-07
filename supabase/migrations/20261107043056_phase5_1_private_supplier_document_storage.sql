BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gfs-private-documents',
  'gfs-private-documents',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.supplier_documents
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint;

ALTER TABLE public.supplier_documents
  DROP CONSTRAINT IF EXISTS supplier_documents_provider_valid;

ALTER TABLE public.supplier_documents
  ADD CONSTRAINT supplier_documents_provider_valid
    CHECK (storage_provider IN ('google_drive', 'external_link', 'supabase_storage'));

ALTER TABLE public.supplier_documents
  DROP CONSTRAINT IF EXISTS supplier_documents_private_file_metadata_valid,
  DROP CONSTRAINT IF EXISTS supplier_documents_private_file_size_valid,
  DROP CONSTRAINT IF EXISTS supplier_documents_private_file_path_valid;

ALTER TABLE public.supplier_documents
  ADD CONSTRAINT supplier_documents_private_file_metadata_valid CHECK (
    (
      storage_provider = 'supabase_storage'
      AND storage_path IS NOT NULL
      AND file_name IS NOT NULL
      AND length(file_name) BETWEEN 1 AND 255
      AND mime_type IN (
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/png'
      )
      AND file_size IS NOT NULL
      AND external_url IS NULL
      AND drive_file_id IS NULL
    )
    OR (
      storage_provider IN ('google_drive', 'external_link')
      AND storage_path IS NULL
      AND file_name IS NULL
      AND mime_type IS NULL
      AND file_size IS NULL
    )
  ),
  ADD CONSTRAINT supplier_documents_private_file_size_valid CHECK (
    file_size IS NULL OR file_size BETWEEN 1 AND 20971520
  ),
  ADD CONSTRAINT supplier_documents_private_file_path_valid CHECK (
    storage_path IS NULL OR storage_path ~* (
      '^' || tenant_id::text ||
      '/supplier-documents/' || supplier_id::text ||
      '/' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{2,8}$'
    )
  );

CREATE INDEX IF NOT EXISTS idx_supplier_documents_tenant_storage_path
  ON public.supplier_documents (tenant_id, storage_path)
  WHERE storage_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_guard_supplier_document_storage_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.storage_provider = 'supabase_storage'
       AND ROW(NEW.storage_provider, NEW.storage_path, NEW.file_name, NEW.mime_type, NEW.file_size)
           IS DISTINCT FROM
           ROW(OLD.storage_provider, OLD.storage_path, OLD.file_name, OLD.mime_type, OLD.file_size) THEN
      RAISE EXCEPTION 'O arquivo privado e seus metadados sao imutaveis; cadastre uma nova versao documental.';
    END IF;

    IF OLD.storage_provider <> 'supabase_storage'
       AND NEW.storage_provider = 'supabase_storage' THEN
      RAISE EXCEPTION 'Para anexar arquivo privado, crie um novo registro documental.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_supplier_document_storage_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_supplier_document_storage_metadata
  ON public.supplier_documents;

CREATE TRIGGER trg_supplier_document_storage_metadata
  BEFORE UPDATE ON public.supplier_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_supplier_document_storage_metadata();

DROP POLICY IF EXISTS gfs_private_supplier_documents_read ON storage.objects;
CREATE POLICY gfs_private_supplier_documents_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'gfs-private-documents'
    AND (
      (SELECT app_auth.is_platform_admin())
      OR (
        CASE
          WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN
            (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:view'))
            AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
            AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'documentos'))
            AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'fornecedores'))
          ELSE false
        END
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.supplier_documents d
      WHERE d.storage_path = storage.objects.name
        AND d.status = 'active'
        AND d.storage_provider = 'supabase_storage'
        AND d.tenant_id = CASE
          WHEN split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN split_part(storage.objects.name, '/', 1)::uuid
          ELSE NULL
        END
        AND d.supplier_id = CASE
          WHEN split_part(storage.objects.name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN split_part(storage.objects.name, '/', 3)::uuid
          ELSE NULL
        END
        AND d.id = CASE
          WHEN split_part(storage.objects.name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN split_part(storage.objects.name, '/', 4)::uuid
          ELSE NULL
        END
    )
  );

DROP POLICY IF EXISTS gfs_private_supplier_documents_upload ON storage.objects;
CREATE POLICY gfs_private_supplier_documents_upload
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'gfs-private-documents'
    AND name ~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '/supplier-documents/' ||
      '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' ||
      '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
    )
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN
        (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:create'))
        AND (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:view'))
        AND (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'suppliers:view'))
        AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'documentos'))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'fornecedores'))
        AND EXISTS (
          SELECT 1
          FROM public.suppliers s
          WHERE s.id = CASE
            WHEN split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN split_part(name, '/', 3)::uuid
            ELSE NULL
          END
            AND s.tenant_id = split_part(name, '/', 1)::uuid
        )
      ELSE false
    END
  );

DROP POLICY IF EXISTS gfs_private_supplier_documents_orphan_read ON storage.objects;
CREATE POLICY gfs_private_supplier_documents_orphan_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'gfs-private-documents'
    AND owner = (SELECT auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_documents d
      WHERE d.storage_path = storage.objects.name
    )
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN
        (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:create'))
        AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'documentos'))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'fornecedores'))
      ELSE false
    END
  );

DROP POLICY IF EXISTS gfs_private_supplier_documents_orphan_delete ON storage.objects;
CREATE POLICY gfs_private_supplier_documents_orphan_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'gfs-private-documents'
    AND owner = (SELECT auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_documents d
      WHERE d.storage_path = storage.objects.name
    )
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
      THEN
        (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:create'))
        AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'documentos'))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'fornecedores'))
      ELSE false
    END
  );

COMMENT ON COLUMN public.supplier_documents.storage_path IS
  'Caminho privado no bucket gfs-private-documents, particionado por Secretaria/fornecedor/documento.';
COMMENT ON COLUMN public.supplier_documents.file_name IS
  'Nome original do arquivo privado para exibicao na interface.';
COMMENT ON COLUMN public.supplier_documents.file_size IS
  'Tamanho original em bytes; limite de bucket e banco: 20 MiB.';
COMMENT ON TABLE public.supplier_documents IS
  'Metadados dos documentos de fornecedores: link externo, Google Drive ou arquivo privado no Supabase Storage.';

COMMIT;
      THEN
        (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'documents:create'))
        AND (SELECT app_auth.is_tenant_in_good_standing(split_part(name, '/', 1)::uuid))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'documentos'))
        AND (SELECT app_auth.is_tenant_module_enabled(split_part(name, '/', 1)::uuid, 'fornecedores'))
      ELSE false
    END
  );

COMMENT ON COLUMN public.supplier_documents.storage_path IS
  'Caminho privado no bucket gfs-private-documents, particionado por Secretaria/fornecedor/documento.';
COMMENT ON COLUMN public.supplier_documents.file_name IS
  'Nome original do arquivo privado para exibicao na interface.';
COMMENT ON COLUMN public.supplier_documents.file_size IS
  'Tamanho original em bytes; limite de bucket e banco: 20 MiB.';
COMMENT ON TABLE public.supplier_documents IS
  'Metadados dos documentos de fornecedores: link externo, Google Drive ou arquivo privado no Supabase Storage.';

COMMIT;