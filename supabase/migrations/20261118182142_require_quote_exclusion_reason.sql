BEGIN;
ALTER TABLE public.procurement_price_quotes ADD COLUMN IF NOT EXISTS justificativa_expurgo text;
CREATE FUNCTION app_auth.require_quote_exclusion_reason() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT NEW.is_active AND (TG_OP='INSERT' OR OLD.is_active OR NEW.justificativa_expurgo IS DISTINCT FROM OLD.justificativa_expurgo)
 AND nullif(btrim(NEW.justificativa_expurgo),'') IS NULL THEN
 RAISE EXCEPTION 'Informe a justificativa de expurgo da cotação.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_auth.require_quote_exclusion_reason() FROM PUBLIC;
CREATE TRIGGER require_quote_exclusion_reason BEFORE INSERT OR UPDATE ON public.procurement_price_quotes FOR EACH ROW EXECUTE FUNCTION app_auth.require_quote_exclusion_reason();
COMMIT;
