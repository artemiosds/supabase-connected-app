BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Per-tenant letterhead settings. The logo remains in the private GED bucket.
CREATE TABLE public.tenant_document_branding (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  header_title text NOT NULL DEFAULT '' CHECK (char_length(btrim(header_title)) <= 180),
  header_subtitle text NOT NULL DEFAULT '' CHECK (char_length(btrim(header_subtitle)) <= 240),
  footer_text text NOT NULL DEFAULT '' CHECK (char_length(btrim(footer_text)) <= 500),
  logo_storage_path text,
  logo_mime text,
  logo_file_name text,
  logo_file_size integer,
  margin_top_mm smallint NOT NULL DEFAULT 30 CHECK (margin_top_mm BETWEEN 10 AND 50),
  margin_bottom_mm smallint NOT NULL DEFAULT 20 CHECK (margin_bottom_mm BETWEEN 10 AND 50),
  margin_left_mm smallint NOT NULL DEFAULT 30 CHECK (margin_left_mm BETWEEN 10 AND 50),
  margin_right_mm smallint NOT NULL DEFAULT 20 CHECK (margin_right_mm BETWEEN 10 AND 50),
  show_page_numbers boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_document_branding_logo_metadata_check CHECK (
    (
      logo_storage_path IS NULL
      AND logo_mime IS NULL
      AND logo_file_name IS NULL
      AND logo_file_size IS NULL
    )
    OR (
      logo_storage_path IS NOT NULL
      AND logo_mime IS NOT NULL
      AND logo_mime IN ('image/png', 'image/jpeg')
      AND logo_file_name IS NOT NULL
      AND char_length(btrim(logo_file_name)) BETWEEN 1 AND 255
      AND logo_file_size IS NOT NULL
      AND logo_file_size BETWEEN 1 AND 307200
    )
  ),
  CONSTRAINT tenant_document_branding_logo_path_check CHECK (
    logo_storage_path IS NULL OR logo_storage_path ~* (
      '^' || tenant_id::text ||
      '/document-branding/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg)$'
    )
  ),
  CONSTRAINT tenant_document_branding_logo_mime_extension_check CHECK (
    logo_storage_path IS NULL
    OR (logo_mime = 'image/png' AND logo_storage_path ~* '\.png$')
    OR (logo_mime = 'image/jpeg' AND logo_storage_path ~* '\.(jpg|jpeg)$')
  )
);

ALTER TABLE public.tenant_document_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_document_branding FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_document_branding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tenant_document_branding TO authenticated;
GRANT ALL ON TABLE public.tenant_document_branding TO service_role;

CREATE POLICY p_tenant_document_branding_select
  ON public.tenant_document_branding FOR SELECT TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (SELECT app_auth.has_tenant_data_permission(tenant_id, 'org:view'))
    OR (SELECT app_auth.has_tenant_data_permission(tenant_id, 'documents:view'))
  );
CREATE POLICY p_tenant_document_branding_insert
  ON public.tenant_document_branding FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'org:edit'))
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
  );
CREATE POLICY p_tenant_document_branding_update
  ON public.tenant_document_branding FOR UPDATE TO authenticated
  USING ((SELECT app_auth.has_tenant_data_permission(tenant_id, 'org:edit')))
  WITH CHECK (
    (SELECT app_auth.has_tenant_data_permission(tenant_id, 'org:edit'))
    AND updated_by = (SELECT auth.uid())
  );

CREATE OR REPLACE FUNCTION public.fn_protect_tenant_document_branding_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.updated_by := (SELECT auth.uid());
    NEW.created_at := pg_catalog.now();
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A identidade e a Secretaria do timbrado são imutáveis.';
  END IF;

  NEW.updated_by := (SELECT auth.uid());
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_tenant_document_branding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  changed_fields jsonb;
  logo_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed_fields := '[
      "header_title", "header_subtitle", "footer_text",
      "margin_top_mm", "margin_bottom_mm", "margin_left_mm",
      "margin_right_mm", "show_page_numbers"
    ]'::jsonb;
    logo_changed := NEW.logo_storage_path IS NOT NULL;
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(current_row.key ORDER BY current_row.key), '[]'::jsonb)
      INTO changed_fields
    FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(NEW)) AS current_row(key, value)
    WHERE current_row.key NOT IN (
      'tenant_id', 'created_by', 'created_at', 'updated_by', 'updated_at',
      'logo_storage_path', 'logo_mime', 'logo_file_name', 'logo_file_size'
    )
      AND (pg_catalog.to_jsonb(OLD) -> current_row.key) IS DISTINCT FROM current_row.value;

    logo_changed := ROW(NEW.logo_storage_path, NEW.logo_mime, NEW.logo_file_name, NEW.logo_file_size)
      IS DISTINCT FROM
      ROW(OLD.logo_storage_path, OLD.logo_mime, OLD.logo_file_name, OLD.logo_file_size);
  END IF;

  IF logo_changed THEN
    changed_fields := changed_fields || '["logo"]'::jsonb;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_id, action, entity, entity_id, details, created_at
  )
  VALUES (
    NEW.tenant_id,
    (SELECT auth.uid()),
    TG_OP,
    'tenant_document_branding',
    NEW.tenant_id::text,
    pg_catalog.jsonb_build_object('changed_fields', changed_fields),
    pg_catalog.now()
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_protect_tenant_document_branding_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_audit_tenant_document_branding()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_tenant_document_branding_protect
  BEFORE INSERT OR UPDATE ON public.tenant_document_branding
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_tenant_document_branding_write();
CREATE TRIGGER trg_tenant_document_branding_audit
  AFTER INSERT OR UPDATE ON public.tenant_document_branding
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_tenant_document_branding();

-- The existing GED bucket is private. Branding files use a distinct path namespace.
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
          WHEN COALESCE(metadata->>'size', '') ~ '^[0-9]+$'
          THEN (metadata->>'size')::bigint BETWEEN 1 AND 307200
          ELSE false
        END
      ELSE false
    END
  );

CREATE POLICY gfs_tenant_document_branding_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'gfs-private-documents'
    AND EXISTS (
      SELECT 1 FROM public.tenant_document_branding b
      WHERE b.logo_storage_path = storage.objects.name
        AND (
          (SELECT app_auth.is_platform_admin())
          OR (SELECT app_auth.has_tenant_data_permission(b.tenant_id, 'org:view'))
          OR (SELECT app_auth.has_tenant_data_permission(b.tenant_id, 'documents:view'))
        )
    )
  );

CREATE POLICY gfs_tenant_document_branding_orphan_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'gfs-private-documents'
    AND name ~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '/document-branding/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg)$'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant_document_branding b
      WHERE b.logo_storage_path = storage.objects.name
    )
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (SELECT app_auth.has_tenant_data_permission(split_part(name, '/', 1)::uuid, 'org:edit'))
      ELSE false
    END
  );

COMMENT ON TABLE public.tenant_document_branding IS
  'Configuração do timbrado institucional por Secretaria; brasão armazenado exclusivamente no GED privado.';

COMMIT;
