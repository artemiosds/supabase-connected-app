BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

-- 1. supplier_homologations RLS
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_homologations'::regclass
      AND c.relrowsecurity
  ),
  'supplier_homologations enables row-level security'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_homologations'::regclass
      AND c.relforcerowsecurity
  ),
  'supplier_homologations forces row-level security'
);

-- 2. checklist items RLS
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_homologation_checklist_items'::regclass
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ),
  'supplier_homologation_checklist_items forces row-level security'
);

-- 3. events RLS
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_homologation_events'::regclass
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ),
  'supplier_homologation_events forces row-level security'
);

-- 4. No physical delete on homologation tables for authenticated
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_homologations', 'DELETE'),
  'authenticated users cannot physically delete supplier_homologations'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_homologation_events', 'DELETE'),
  'authenticated users cannot physically delete supplier_homologation_events'
);

-- 5. RPC functions exist with security definer and empty search_path
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE proname = 'start_supplier_homologation'
      AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  ),
  'start_supplier_homologation is security definer with empty search path'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE proname = 'conclude_supplier_homologation'
      AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  ),
  'conclude_supplier_homologation is security definer with empty search path'
);

-- 6. Permissions equivalence check: manager and operator have suppliers:update and suppliers:deactivate
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    JOIN public.tenant_role_permissions trp ON trp.role_id = tr.id
    JOIN public.permissions p ON p.id = trp.permission_id
    WHERE tr.slug = 'manager' AND p.code = 'suppliers:update'
  ) AND EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    JOIN public.tenant_role_permissions trp ON trp.role_id = tr.id
    JOIN public.permissions p ON p.id = trp.permission_id
    WHERE tr.slug = 'operator' AND p.code = 'suppliers:update'
  ),
  'manager and operator both have suppliers:update permission'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    JOIN public.tenant_role_permissions trp ON trp.role_id = tr.id
    JOIN public.permissions p ON p.id = trp.permission_id
    WHERE tr.slug = 'manager' AND p.code = 'suppliers:deactivate'
  ) AND EXISTS (
    SELECT 1 FROM public.tenant_roles tr
    JOIN public.tenant_role_permissions trp ON trp.role_id = tr.id
    JOIN public.permissions p ON p.id = trp.permission_id
    WHERE tr.slug = 'operator' AND p.code = 'suppliers:deactivate'
  ),
  'manager and operator both have suppliers:deactivate permission'
);

SELECT * FROM extensions.finish();
ROLLBACK;
