BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- The native price map is not rendered from a tenant template. Its process
-- snapshot is captured by z_generated_documents_price_map_snapshot on INSERT,
-- and submission independently enforces the research fingerprint, approved
-- item prices, legal validation and approval workflow.
CREATE OR REPLACE FUNCTION public.fn_validate_generated_document_required_variables()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_schema jsonb;
  v_item jsonb;
  v_key text;
  v_value text;
BEGIN
  IF NEW.process_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.template_id IS NULL
     AND NEW.template_version IS NULL
     AND NEW.document_type = 'custom'
     AND NEW.status = 'draft'
     AND NEW.process_snapshot->>'document_kind' = 'price_map' THEN
    RETURN NEW;
  END IF;

  SELECT t.variables_schema INTO v_schema
  FROM public.document_templates t
  WHERE t.id = NEW.template_id
    AND t.tenant_id = NEW.tenant_id
    AND t.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O modelo do documento nao esta ativo ou nao pertence a Secretaria.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_schema)
  LOOP
    IF v_item->>'required' = 'true' THEN
      v_key := v_item->>'key';
      v_value := NEW.variables_snapshot->>v_key;
      IF v_key IS NULL OR v_value IS NULL OR pg_catalog.btrim(v_value) = ''
         OR v_value LIKE '[PREENCHER:%' THEN
        RAISE EXCEPTION 'Campo obrigatorio nao preenchido no documento: %.',
          COALESCE(v_item->>'label', v_key, 'campo sem identificador')
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_validate_generated_document_required_variables()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_validate_generated_document_required_variables() IS
  'Valida campos obrigatórios do modelo; o rascunho do mapa nativo usa a captura e as validações próprias da pesquisa de preços.';
COMMIT;
