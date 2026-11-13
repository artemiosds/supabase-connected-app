BEGIN;

-- Keep this SECURITY DEFINER helper in the non-exposed app_auth schema.
-- It breaks the RLS cycle between source metadata and Storage objects.
CREATE OR REPLACE FUNCTION app_auth.document_template_source_object_exists(
  p_tenant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_storage_path LIKE p_tenant_id::text || '/template-sources/%'
    AND (SELECT app_auth.has_tenant_data_permission(p_tenant_id, 'documents:manage_templates'))
    AND (SELECT app_auth.is_tenant_in_good_standing(p_tenant_id))
    AND (SELECT app_auth.is_tenant_module_enabled(p_tenant_id, 'modelos'))
    AND EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = 'gfs-private-documents'
        AND o.name = p_storage_path
    );
$function$;

REVOKE ALL ON FUNCTION app_auth.document_template_source_object_exists(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA app_auth TO authenticated;
GRANT EXECUTE ON FUNCTION app_auth.document_template_source_object_exists(uuid, text)
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
    AND (SELECT app_auth.document_template_source_object_exists(tenant_id, storage_path))
  );

COMMENT ON FUNCTION app_auth.document_template_source_object_exists(uuid, text) IS
  'Verifica a existência do objeto DOCX exato para o tenant autenticado e autorizado, evitando recursão entre políticas RLS de Storage e document_template_sources.';

COMMIT;
