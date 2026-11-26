-- Instala os modelos oficiais ativos do catálogo (document_template_catalog)
-- nas Secretarias ativas que têm o módulo 'modelos' habilitado e ainda não os possuem.

BEGIN;

ALTER TABLE public.document_templates DISABLE TRIGGER trg_document_templates_guard;

DO $$
DECLARE
  v_tenant record;
  v_actor_id uuid;
  v_rec record;
BEGIN
  FOR v_tenant IN
    SELECT t.id, t.created_by
    FROM public.tenants t
    WHERE t.status = 'active'
      AND COALESCE((t.enabled_modules->>'modelos')::boolean, true) = true
  LOOP
    SELECT tm.user_id
    INTO v_actor_id
    FROM public.tenant_memberships tm
    LEFT JOIN public.membership_roles mr ON mr.membership_id = tm.id
    LEFT JOIN public.tenant_roles tr ON tr.id = mr.role_id
    WHERE tm.tenant_id = v_tenant.id
      AND tm.status = 'active'
    ORDER BY (tr.slug = 'admin') DESC NULLS LAST, tm.created_at ASC
    LIMIT 1;

    IF v_actor_id IS NULL THEN
      v_actor_id := v_tenant.created_by;
    END IF;

    IF v_actor_id IS NULL THEN
      SELECT pa.user_id
      INTO v_actor_id
      FROM public.platform_admins pa
      LIMIT 1;
    END IF;

    IF v_actor_id IS NOT NULL THEN
      FOR v_rec IN
        SELECT c.*
        FROM public.document_template_catalog c
        WHERE c.is_active = true
          AND NOT EXISTS (
            SELECT 1
            FROM public.document_templates dt
            WHERE dt.tenant_id = v_tenant.id
              AND (
                dt.catalog_template_id = c.id
                OR (c.template_code IS NOT NULL AND dt.template_code = c.template_code)
              )
          )
        ORDER BY c.template_code
      LOOP
        INSERT INTO public.document_templates (
          tenant_id,
          title,
          description,
          content,
          is_active,
          template_type,
          template_code,
          version,
          catalog_template_id,
          legal_basis,
          source_reference,
          variables_schema,
          change_summary,
          is_base_template,
          created_by,
          updated_by
        )
        VALUES (
          v_tenant.id,
          v_rec.title,
          v_rec.description,
          v_rec.content,
          true,
          v_rec.template_type,
          v_rec.template_code,
          1,
          v_rec.id,
          v_rec.legal_basis,
          v_rec.source_reference,
          v_rec.variables_schema,
          'Instalado automaticamente a partir do catálogo oficial padrão.',
          true,
          v_actor_id,
          v_actor_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.document_templates ENABLE TRIGGER trg_document_templates_guard;

COMMIT;
