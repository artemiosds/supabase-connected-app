-- Enforce institutional data shape in the database, not only in the UI.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_cnpj_valid') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_cnpj_valid
      CHECK (cnpj IS NULL OR (cnpj=public.normalize_cnpj(cnpj) AND public.is_valid_cnpj(cnpj))) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_contact_email_format') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_contact_email_format
      CHECK (contact_email IS NULL OR (length(contact_email)<=254 AND contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_contact_phone_length') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_contact_phone_length
      CHECK (contact_phone IS NULL OR length(btrim(contact_phone))<=40) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_street_length') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_street_length
      CHECK (street IS NULL OR length(btrim(street))<=200) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_municipality_length') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_municipality_length
      CHECK (municipality IS NULL OR length(btrim(municipality))<=120) NOT VALID;
  END IF;
END;
$block$;
