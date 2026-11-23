BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE public.procurement_price_quotes
  ADD COLUMN IF NOT EXISTS supplier_selection_justification text;

CREATE OR REPLACE FUNCTION public.fn_guard_procurement_quote_source_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND ROW(
      NEW.source_type,NEW.reference_identifier,NEW.accessed_at,NEW.source_tax_id,
      NEW.source_contact_name,NEW.source_contact_email,NEW.source_address,
      NEW.supplier_selection_justification
    ) IS NOT DISTINCT FROM ROW(
      OLD.source_type,OLD.reference_identifier,OLD.accessed_at,OLD.source_tax_id,
      OLD.source_contact_name,OLD.source_contact_email,OLD.source_address,
      OLD.supplier_selection_justification
    ) THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type IN ('painel_precos','contratacoes_publicas','midia_especializada','site_especializado','banco_precos_saude')
    AND NEW.accessed_at IS NULL THEN
    RAISE EXCEPTION 'Registre a data e hora de acesso da fonte consultada.';
  END IF;

  IF NEW.source_type='fornecedor' AND length(btrim(COALESCE(NEW.supplier_selection_justification,'')))<10 THEN
    RAISE EXCEPTION 'A cotação direta exige justificativa da escolha do fornecedor (mínimo de 10 caracteres).';
  END IF;

  IF NEW.source_type='fornecedor' AND NEW.supplier_id IS NULL
    AND (NULLIF(btrim(NEW.source_tax_id),'') IS NULL OR NULLIF(btrim(NEW.source_contact_name),'') IS NULL
      OR NULLIF(btrim(NEW.source_contact_email),'') IS NULL OR NULLIF(btrim(NEW.source_address),'') IS NULL) THEN
    RAISE EXCEPTION 'A cotação direta exige CPF/CNPJ, responsável, e-mail e endereço do fornecedor.';
  END IF;

  IF NEW.source_type='nota_fiscal_eletronica'
    AND (NULLIF(btrim(NEW.reference_identifier),'') IS NULL OR NEW.accessed_at IS NULL) THEN
    RAISE EXCEPTION 'Informe a identificação da nota fiscal e a data/hora da consulta.';
  END IF;

  IF NEW.source_type='outro' AND NULLIF(btrim(NEW.reference_identifier),'') IS NULL
    AND NULLIF(btrim(NEW.reference_url),'') IS NULL AND NULLIF(btrim(NEW.notes),'') IS NULL THEN
    RAISE EXCEPTION 'Identifique a fonte ou registre observação que permita rastrear a consulta.';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.procurement_price_quotes.supplier_selection_justification IS
  'Justificativa documentada da escolha do fornecedor consultado, conforme art. 3º, VIII, e art. 5º, IV, da IN SEGES/ME 65/2021.';

COMMIT;
