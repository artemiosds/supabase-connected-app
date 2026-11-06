BEGIN;

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

  SELECT t.variables_schema
    INTO v_schema
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

DROP TRIGGER IF EXISTS trg_generated_documents_required_variables
  ON public.generated_documents;

CREATE TRIGGER trg_generated_documents_required_variables
  BEFORE INSERT ON public.generated_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_generated_document_required_variables();

COMMENT ON FUNCTION public.fn_validate_generated_document_required_variables() IS
  'Valida no banco os campos obrigatorios do modelo quando o documento e gerado a partir de um processo.';

COMMIT;