-- Regression test: every table in public must enable both RLS and FORCE ROW LEVEL SECURITY.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(1);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)),
  0,
  'every public table enforces both ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY'
);

SELECT * FROM extensions.finish();
ROLLBACK;
