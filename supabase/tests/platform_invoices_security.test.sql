BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.has_table('public', 'platform_invoices', 'platform_invoices table exists');
SELECT extensions.ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.platform_invoices'::regclass),
  'platform_invoices enforces and forces RLS'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.platform_invoices', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_invoices', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.platform_invoices', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.platform_invoices', 'DELETE'),
  'anon and authenticated cannot mutate platform_invoices directly'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.generate_monthly_platform_invoices(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.generate_monthly_platform_invoices(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.create_platform_invoice(uuid, text, numeric, date, text, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.create_platform_invoice(uuid, text, numeric, date, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.update_platform_invoice_status(uuid, text, text, text, text, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.update_platform_invoice_status(uuid, text, text, text, text, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.sync_overdue_platform_invoices(boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.sync_overdue_platform_invoices(boolean)', 'EXECUTE'),
  'billing RPCs block anon and restrict execution to authenticated Master checks'
);

INSERT INTO auth.users (id, email)
VALUES ('44444444-4444-4444-8444-444444444444', 'billing-test-user@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, name, slug, status, created_by, commercial_status, monthly_fee)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  'Teste Faturas Secretaria',
  'teste-faturas-secretaria',
  'active',
  '44444444-4444-4444-8444-444444444444',
  'active',
  1990
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.platform_invoices),
  0,
  'non-platform-admin sees zero invoices via RLS'
);

SELECT extensions.throws_ok(
  $$SELECT public.generate_monthly_platform_invoices('2026-11')$$,
  '42501',
  NULL,
  'non-platform-admin cannot generate monthly invoices'
);

SELECT extensions.throws_ok(
  $$SELECT public.create_platform_invoice('55555555-5555-4555-8555-555555555555'::uuid, '2026-11', 100, '2026-11-30'::date, 'manual', null)$$,
  '42501',
  NULL,
  'non-platform-admin cannot create manual invoice'
);

SELECT extensions.throws_ok(
  $$SELECT public.sync_overdue_platform_invoices(true)$$,
  '42501',
  NULL,
  'non-platform-admin cannot sync overdue invoices'
);

SELECT * FROM extensions.finish();
ROLLBACK;
