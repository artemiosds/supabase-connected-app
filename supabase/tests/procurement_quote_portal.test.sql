-- Security invariants for electronic supplier quote portal (procurement_quote_requests)
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'procurement_quote_requests'
     AND c.relrowsecurity
     AND c.relforcerowsecurity),
  1,
  'procurement_quote_requests enforces both RLS and FORCE ROW LEVEL SECURITY'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.procurement_quote_requests', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.procurement_quote_requests', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.procurement_quote_requests', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.procurement_quote_requests', 'DELETE'),
  'anon has zero direct privileges on procurement_quote_requests'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege('anon', 'public.create_procurement_quote_request(uuid,uuid,uuid,text,date,text)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.create_procurement_quote_request(uuid,uuid,uuid,text,date,text)', 'EXECUTE'),
  'create_procurement_quote_request requires authenticated and blocks anon'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege('anon', 'public.cancel_procurement_quote_request(uuid,uuid)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.cancel_procurement_quote_request(uuid,uuid)', 'EXECUTE'),
  'cancel_procurement_quote_request requires authenticated and blocks anon'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege('anon', 'public.mark_procurement_quote_request_imported(uuid,uuid)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.mark_procurement_quote_request_imported(uuid,uuid)', 'EXECUTE'),
  'mark_procurement_quote_request_imported requires authenticated and blocks anon'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'create_procurement_quote_request',
       'cancel_procurement_quote_request',
       'mark_procurement_quote_request_imported',
       'get_procurement_quote_portal_data',
       'submit_procurement_quote_portal'
     )
     AND p.prosecdef = true
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
       WHERE cfg IN ('search_path=', 'search_path=""')
     )),
  5,
  'all 5 quote portal SECURITY DEFINER functions fix search_path'
);

SELECT extensions.is(
  (public.get_procurement_quote_portal_data('invalid-short-token')->>'success')::boolean,
  false,
  'get_procurement_quote_portal_data rejects invalid tokens safely'
);

SELECT extensions.is(
  (public.submit_procurement_quote_portal('invalid-short-token', '{}'::jsonb)->>'success')::boolean,
  false,
  'submit_procurement_quote_portal rejects invalid tokens safely'
);

SELECT * FROM extensions.finish();
ROLLBACK;
