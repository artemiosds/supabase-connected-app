BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

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
SELECT * FROM extensions.finish();
ROLLBACK;
