-- Behavioral RLS regression for per-tenant document letterhead settings.
-- Uses synthetic Auth identities and tenant fixtures inside a rollback-only test.
-- Run only against the disposable local Supabase database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'branding-a@example.invalid', '',
   pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Synthetic Branding A"}'::jsonb, pg_catalog.now(), pg_catalog.now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'branding-b@example.invalid', '',
   pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Synthetic Branding B"}'::jsonb, pg_catalog.now(), pg_catalog.now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles(id, full_name)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Branding A'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Branding B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants(id, name, slug, status, created_by, commercial_status, enabled_modules)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'Synthetic Tenant A', 'synthetic-branding-a',
   'active', '10000000-0000-4000-8000-000000000001', 'active',
   '{"modelos":true,"documentos":true}'::jsonb),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic Tenant B', 'synthetic-branding-b',
   'active', '10000000-0000-4000-8000-000000000002', 'active',
   '{"modelos":true,"documentos":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.permissions(code, name, description, module)
VALUES
  ('org:view', 'View organization', 'Synthetic test permission', 'org'),
  ('org:edit', 'Edit organization', 'Synthetic test permission', 'org'),
  ('documents:view', 'View documents', 'Synthetic test permission', 'documents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_roles(id, tenant_id, name, slug, description, is_system)
VALUES
  ('30000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'Synthetic branding manager A', 'branding-manager-a', 'Test only', false),
  ('30000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Synthetic branding manager B', 'branding-manager-b', 'Test only', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM public.tenant_roles r
JOIN public.permissions p ON p.code IN ('org:view', 'org:edit', 'documents:view')
WHERE r.id IN (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, status)
VALUES
  ('40000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'active'),
  ('40000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_roles(membership_id, role_id, tenant_id)
VALUES
  ('40000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

-- Seed one row in each tenant as their respective synthetic user.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true
);
INSERT INTO public.tenant_document_branding(tenant_id, header_title, created_by, updated_by)
VALUES ('20000000-0000-4000-8000-000000000002', 'Tenant B private heading',
        '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tenant_document_branding),
  0,
  'tenant A user cannot read tenant B letterhead before creating its own'
);

SELECT extensions.lives_ok(
  $test$INSERT INTO public.tenant_document_branding(tenant_id, header_title)
        VALUES ('20000000-0000-4000-8000-000000000001', 'Tenant A inserted')$test$,
  'tenant A user can create letterhead settings for tenant A'
);

SELECT extensions.throws_ok(
  $test$INSERT INTO public.tenant_document_branding(tenant_id, header_title)
        VALUES ('20000000-0000-4000-8000-000000000002', 'Cross-tenant attempt')$test$,
  '42501',
  NULL,
  'tenant A user cannot create letterhead settings for tenant B'
);

SELECT extensions.is(
  (SELECT header_title FROM public.tenant_document_branding
   WHERE tenant_id = '20000000-0000-4000-8000-000000000002'),
  'Tenant B private heading',
  'tenant A user cannot update tenant B letterhead'
);

SELECT extensions.lives_ok(
  $test$UPDATE public.tenant_document_branding
        SET header_title = 'Tenant A updated'
        WHERE tenant_id = '20000000-0000-4000-8000-000000000001'
          AND header_title = 'Tenant A inserted'$test$,
  'tenant A user can update its own letterhead'
);

SELECT extensions.is(
  (SELECT updated_by::text FROM public.tenant_document_branding
   WHERE tenant_id = '20000000-0000-4000-8000-000000000001'
     AND header_title = 'Tenant A updated'),
  '10000000-0000-4000-8000-000000000001',
  'letterhead update records the authenticated actor'
);

SELECT extensions.throws_ok(
  $test$UPDATE public.tenant_document_branding
        SET tenant_id = '20000000-0000-4000-8000-000000000002'
        WHERE tenant_id = '20000000-0000-4000-8000-000000000001'$test$,
  'P0001',
  NULL,
  'tenant identity cannot be reassigned by an authenticated editor'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege(
    'authenticated', 'public.tenant_document_branding', 'DELETE'
  ),
  'authenticated users cannot physically delete letterhead settings'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.audit_events
   WHERE tenant_id = '20000000-0000-4000-8000-000000000001'
     AND entity = 'tenant_document_branding'),
  2,
  'insert and update operations produce tenant-scoped audit events'
);

SELECT * FROM extensions.finish();
ROLLBACK;
