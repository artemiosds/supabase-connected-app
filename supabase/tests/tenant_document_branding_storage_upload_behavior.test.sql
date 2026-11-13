-- Behavioral regression for Storage's preflight metadata used by letterhead uploads.
-- Supabase Storage authorizes before transfer with contentLength; completed objects
-- use size. All fixtures are synthetic and removed by ROLLBACK.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000091',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'branding-storage@example.invalid',
  '',
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Synthetic Branding Storage"}'::jsonb,
  pg_catalog.now(),
  pg_catalog.now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles(id, full_name)
VALUES ('10000000-0000-4000-8000-000000000091', 'Synthetic Branding Storage')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants(id, name, slug, status, created_by, commercial_status, enabled_modules)
VALUES (
  '20000000-0000-4000-8000-000000000091',
  'Synthetic Branding Storage Tenant',
  'synthetic-branding-storage',
  'active',
  '10000000-0000-4000-8000-000000000091',
  'active',
  '{"documentos":true}'::jsonb
);

INSERT INTO public.permissions(code, name, description, module)
VALUES
  ('org:view', 'View organization', 'Synthetic storage test', 'org'),
  ('org:edit', 'Edit organization', 'Synthetic storage test', 'org')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_roles(id, tenant_id, name, slug, description, is_system)
VALUES (
  '30000000-0000-4000-8000-000000000091',
  '20000000-0000-4000-8000-000000000091',
  'Synthetic branding manager',
  'branding-manager-storage',
  'Test only',
  false
);

INSERT INTO public.tenant_role_permissions(role_id, permission_id)
SELECT '30000000-0000-4000-8000-000000000091', id
FROM public.permissions
WHERE code IN ('org:view', 'org:edit')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, status)
VALUES (
  '40000000-0000-4000-8000-000000000091',
  '20000000-0000-4000-8000-000000000091',
  '10000000-0000-4000-8000-000000000091',
  'active'
);

INSERT INTO public.membership_roles(membership_id, role_id, tenant_id)
VALUES (
  '40000000-0000-4000-8000-000000000091',
  '30000000-0000-4000-8000-000000000091',
  '20000000-0000-4000-8000-000000000091'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000091',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated"}',
  true
);

SELECT extensions.lives_ok(
  $test$
    INSERT INTO storage.objects(bucket_id, name, owner, owner_id, metadata)
    VALUES (
      'gfs-private-documents',
      '20000000-0000-4000-8000-000000000091/document-branding/50000000-0000-4000-8000-000000000091.png',
      auth.uid(),
      auth.uid()::text,
      '{"mimetype":"image/png","contentLength":72}'::jsonb
    )
  $test$,
  'authorized tenant editor can pass Storage preflight with contentLength metadata'
);

SELECT extensions.lives_ok(
  $test$
    INSERT INTO storage.objects(bucket_id, name, owner, owner_id, metadata)
    VALUES (
      'gfs-private-documents',
      '20000000-0000-4000-8000-000000000091/document-branding/50000000-0000-4000-8000-000000000092.png',
      auth.uid(),
      auth.uid()::text,
      '{"mimetype":"image/png","size":72}'::jsonb
    )
  $test$,
  'authorized tenant editor can insert finalized object metadata with size'
);

SELECT extensions.throws_ok(
  $test$
    INSERT INTO storage.objects(bucket_id, name, owner, owner_id, metadata)
    VALUES (
      'gfs-private-documents',
      '20000000-0000-4000-8000-000000000092/document-branding/50000000-0000-4000-8000-000000000093.png',
      auth.uid(),
      auth.uid()::text,
      '{"mimetype":"image/png","contentLength":72}'::jsonb
    )
  $test$,
  '42501',
  NULL,
  'tenant editor cannot upload a letterhead into another tenant path'
);

SELECT extensions.throws_ok(
  $test$
    INSERT INTO storage.objects(bucket_id, name, owner, owner_id, metadata)
    VALUES (
      'gfs-private-documents',
      '20000000-0000-4000-8000-000000000091/document-branding/50000000-0000-4000-8000-000000000094.png',
      auth.uid(),
      auth.uid()::text,
      '{"mimetype":"image/png","contentLength":307201}'::jsonb
    )
  $test$,
  '42501',
  NULL,
  'letterhead upload above the 300 KB limit is denied'
);

SELECT extensions.throws_ok(
  $test$
    INSERT INTO storage.objects(bucket_id, name, owner, owner_id, metadata)
    VALUES (
      'gfs-private-documents',
      '20000000-0000-4000-8000-000000000091/document-branding/50000000-0000-4000-8000-000000000095.png',
      auth.uid(),
      auth.uid()::text,
      '{"mimetype":"application/pdf","contentLength":72}'::jsonb
    )
  $test$,
  '42501',
  NULL,
  'letterhead upload with a non-image MIME type is denied'
);

SELECT * FROM extensions.finish();
ROLLBACK;
