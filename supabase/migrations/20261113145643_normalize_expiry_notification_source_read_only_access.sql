-- Normalize the expiry notification worker's source access to SELECT only.
-- This keeps local Supabase defaults consistent with the hosted project's
-- least-privilege policy and prevents accidental write/maintenance grants.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
  public.tenants,
  public.supplier_documents,
  public.suppliers,
  public.tenant_memberships,
  public.membership_roles,
  public.tenant_roles,
  public.profiles
FROM service_role;

GRANT SELECT ON TABLE
  public.tenants,
  public.supplier_documents,
  public.suppliers,
  public.tenant_memberships,
  public.membership_roles,
  public.tenant_roles,
  public.profiles
TO service_role;

COMMIT;
