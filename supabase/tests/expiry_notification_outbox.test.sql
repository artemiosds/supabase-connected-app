BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.expiry_notification_deliveries') IS NOT NULL,
  'expiry notification outbox exists'
);
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid='public.expiry_notification_deliveries'::regclass),
  'expiry notification outbox forces RLS'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public'
      AND tablename='expiry_notification_deliveries'
      AND policyname='p_expiry_notification_deliveries_default_deny'
      AND permissive='RESTRICTIVE'
      AND cmd='ALL'
      AND roles @> ARRAY['anon','authenticated']::name[]
      AND qual='false'
      AND with_check='false'
  ),
  'expiry notification outbox has an explicit restrictive deny policy'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.expiry_notification_deliveries','SELECT')
  AND NOT has_table_privilege('authenticated','public.expiry_notification_deliveries','SELECT')
  AND NOT has_table_privilege('authenticated','public.expiry_notification_deliveries','INSERT'),
  'API roles have no direct privileges on notification deliveries'
);
SELECT extensions.ok(
  has_table_privilege('service_role','public.expiry_notification_deliveries','SELECT,INSERT,UPDATE,DELETE'),
  'service role can manage the private notification outbox'
);
SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.claim_expiry_notification_delivery(uuid)') IS NOT NULL,
  'atomic delivery claim function exists'
);
SELECT extensions.ok(
  pg_catalog.to_regprocedure('public.finish_expiry_notification_delivery(uuid,text,text,text)') IS NOT NULL,
  'delivery completion function exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.claim_expiry_notification_delivery(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.claim_expiry_notification_delivery(uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.claim_expiry_notification_delivery(uuid)','EXECUTE'),
  'only service role can claim a notification delivery'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.finish_expiry_notification_delivery(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.finish_expiry_notification_delivery(uuid,text,text,text)','EXECUTE')
  AND has_function_privilege('service_role','public.finish_expiry_notification_delivery(uuid,text,text,text)','EXECUTE'),
  'only service role can finish a notification delivery'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.claim_expiry_notification_delivery(uuid)'::regprocedure),
  'delivery claim RPC is SECURITY DEFINER with pinned search_path'
);
SELECT extensions.ok(
  (SELECT p.prosecdef AND COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.finish_expiry_notification_delivery(uuid,text,text,text)'::regprocedure),
  'delivery completion RPC is SECURITY DEFINER with pinned search_path'
);

SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) NOT ILIKE '%locked_at <%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid='public.claim_expiry_notification_delivery(uuid)'::regprocedure),
  'ambiguous sending rows are never reclaimed automatically'
);

SELECT extensions.ok(
  has_table_privilege('service_role','public.tenants','SELECT')
  AND has_table_privilege('service_role','public.supplier_documents','SELECT')
  AND has_table_privilege('service_role','public.suppliers','SELECT')
  AND has_table_privilege('service_role','public.tenant_memberships','SELECT')
  AND has_table_privilege('service_role','public.membership_roles','SELECT')
  AND has_table_privilege('service_role','public.profiles','SELECT')
  AND has_table_privilege('service_role','public.tenant_roles','SELECT'),
  'service role can read only the required expiry notification source tables'
);
SELECT extensions.ok(
  NOT has_table_privilege('service_role','public.tenants','INSERT')
  AND NOT has_table_privilege('service_role','public.tenants','UPDATE')
  AND NOT has_table_privilege('service_role','public.tenants','DELETE')
  AND NOT has_table_privilege('service_role','public.supplier_documents','INSERT')
  AND NOT has_table_privilege('service_role','public.supplier_documents','UPDATE')
  AND NOT has_table_privilege('service_role','public.supplier_documents','DELETE')
  AND NOT has_table_privilege('service_role','public.suppliers','INSERT')
  AND NOT has_table_privilege('service_role','public.suppliers','UPDATE')
  AND NOT has_table_privilege('service_role','public.suppliers','DELETE')
  AND NOT has_table_privilege('service_role','public.tenant_memberships','INSERT')
  AND NOT has_table_privilege('service_role','public.tenant_memberships','UPDATE')
  AND NOT has_table_privilege('service_role','public.tenant_memberships','DELETE')
  AND NOT has_table_privilege('service_role','public.membership_roles','INSERT')
  AND NOT has_table_privilege('service_role','public.membership_roles','UPDATE')
  AND NOT has_table_privilege('service_role','public.membership_roles','DELETE')
  AND NOT has_table_privilege('service_role','public.profiles','INSERT')
  AND NOT has_table_privilege('service_role','public.profiles','UPDATE')
  AND NOT has_table_privilege('service_role','public.profiles','DELETE')
  AND NOT has_table_privilege('service_role','public.tenant_roles','INSERT')
  AND NOT has_table_privilege('service_role','public.tenant_roles','UPDATE')
  AND NOT has_table_privilege('service_role','public.tenant_roles','DELETE'),
  'service role source-table privileges remain read-only'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon','public.tenants','SELECT')
  AND NOT has_table_privilege('anon','public.supplier_documents','SELECT')
  AND NOT has_table_privilege('anon','public.suppliers','SELECT')
  AND NOT has_table_privilege('anon','public.tenant_memberships','SELECT')
  AND NOT has_table_privilege('anon','public.membership_roles','SELECT')
  AND NOT has_table_privilege('anon','public.profiles','SELECT')
  AND NOT has_table_privilege('anon','public.tenant_roles','SELECT'),
  'anon cannot read expiry notification source tables'
);

SELECT * FROM extensions.finish();
ROLLBACK;
