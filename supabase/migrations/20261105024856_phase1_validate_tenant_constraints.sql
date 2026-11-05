-- Complete formal validation of tenant institutional-data constraints.
-- The tenants table was verified empty in SMS2 before this migration.
-- Existing constraints are unchanged; this only validates their CHECK scans.
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_cnpj_valid;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_contact_email_format;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_contact_phone_length;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_municipality_length;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_state_format;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_street_length;
