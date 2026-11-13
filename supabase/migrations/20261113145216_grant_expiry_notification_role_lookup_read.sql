-- The expiry worker expands membership_roles to tenant_roles(slug).
-- Grant the server-only worker read access to the referenced role table.
BEGIN;

GRANT SELECT ON TABLE public.tenant_roles TO service_role;

COMMIT;
