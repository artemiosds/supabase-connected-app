BEGIN;

-- Avoid an RLS cycle: the source INSERT policy checks Storage, while the
-- Storage SELECT policy checks source metadata. This narrowly-scoped helper
-- checks only whether the exact object exists and runs as the table owner,
-- bypassing storage.objects RLS for this integrity check.
CREATE OR REPLACE FUNCTION public.document_template_source_object_exists(p_storage_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'gfs-private-documents'
      AND o.name = p_storage_path
  );
$function$;

REVOKE ALL ON FUNCTION public.document_template_source_object_exists(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.document_template_source_object_exists(text)
  TO authenticated;

DROP POLICY IF EXISTS document_template_sources_insert
  ON public.document_template_sources;

CREATE POLICY document_template_sources_insert
  ON public.document_template_sources
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:manage_templates'))
    AND (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'modelos'))
    AND (SELECT public.document_template_source_object_exists(storage_path))
  );

COMMENT ON FUNCTION public.document_template_source_object_exists(text) IS
  'Verifica a existência do objeto DOCX exato durante a inserção dos metadados, evitando recursão entre políticas RLS de Storage e document_template_sources.';

COMMIT;
