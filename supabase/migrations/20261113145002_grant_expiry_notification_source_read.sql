-- Minimal read-only source access for the private expiry notification worker.
-- The function uses the service role key and reads tenant, supplier, membership,
-- profile and document data. It never writes to these source tables.
-- Delivery state remains isolated in expiry_notification_deliveries.
BEGIN;

GRANT SELECT ON TABLE
  public.tenants,
  public.supplier_documents,
  public.suppliers,
  public.tenant_memberships,
  public.membership_roles,
  public.profiles
TO service_role;

COMMIT;
