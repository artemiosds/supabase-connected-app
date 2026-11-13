-- Disposable authenticated E2E fixtures. This file is executed only against
-- the local Supabase database started by the GitHub Actions E2E workflow.
-- The email domain is reserved (.invalid); no real users or emails are used.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'e2e.secretaria.a@example.invalid',
    extensions.crypt('GfsE2E!2026-OnlyLocal', extensions.gen_salt('bf')),
    pg_catalog.now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Usuário E2E Secretaria A"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'e2e.secretaria.b@example.invalid',
    extensions.crypt('GfsE2E!2026-OnlyLocal', extensions.gen_salt('bf')),
    pg_catalog.now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Usuário E2E Secretaria B"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  )
ON CONFLICT (id) DO UPDATE
SET encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    email_change_token_current = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = pg_catalog.now();


-- GoTrue email/password login resolves email identities as well as auth.users.
INSERT INTO auth.identities(
  provider_id, user_id, identity_data, provider, created_at, updated_at
)
VALUES
  (
    'e2e.secretaria.a@example.invalid',
    '90000000-0000-4000-8000-000000000001',
    '{"sub":"90000000-0000-4000-8000-000000000001","email":"e2e.secretaria.a@example.invalid","email_verified":true}'::jsonb,
    'email',
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    'e2e.secretaria.b@example.invalid',
    '90000000-0000-4000-8000-000000000002',
    '{"sub":"90000000-0000-4000-8000-000000000002","email":"e2e.secretaria.b@example.invalid","email_verified":true}'::jsonb,
    'email',
    pg_catalog.now(),
    pg_catalog.now()
  )
ON CONFLICT (provider_id, provider) DO UPDATE
SET user_id = EXCLUDED.user_id,
    identity_data = EXCLUDED.identity_data,
    updated_at = pg_catalog.now();

INSERT INTO public.profiles(id, full_name)
VALUES
  ('90000000-0000-4000-8000-000000000001', 'Usuário E2E Secretaria A'),
  ('90000000-0000-4000-8000-000000000002', 'Usuário E2E Secretaria B')
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name;

INSERT INTO public.tenants(
  id, name, slug, status, created_by, commercial_status, enabled_modules
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    'Secretaria E2E A',
    'secretaria-e2e-a',
    'active',
    '90000000-0000-4000-8000-000000000001',
    'active',
    '{"fornecedores":true,"contratos":true,"documentos":true}'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'Secretaria E2E B',
    'secretaria-e2e-b',
    'active',
    '90000000-0000-4000-8000-000000000002',
    'active',
    '{"fornecedores":true,"contratos":true,"documentos":true}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.permissions(code, name, description, module)
VALUES
  ('org:view', 'Visualizar organização', 'Permissão E2E sintética', 'org'),
  ('suppliers:view', 'Visualizar fornecedores', 'Permissão E2E sintética', 'suppliers'),
  ('suppliers:create', 'Cadastrar fornecedores', 'Permissão E2E sintética', 'suppliers'),
  ('suppliers:update', 'Editar fornecedores', 'Permissão E2E sintética', 'suppliers')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_roles(id, tenant_id, name, slug, description, is_system)
VALUES
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Administrador E2E A',
    'admin',
    'Papel sintético exclusivo dos testes automatizados.',
    false
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'Administrador E2E B',
    'admin',
    'Papel sintético exclusivo dos testes automatizados.',
    false
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_role_permissions(role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.tenant_roles AS roles
CROSS JOIN public.permissions AS permissions
WHERE roles.id IN (
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002'
  )
  AND permissions.code IN ('org:view', 'suppliers:view', 'suppliers:create', 'suppliers:update')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, status)
VALUES
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000002',
    'active'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_roles(membership_id, role_id, tenant_id)
VALUES
  (
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002'
  )
ON CONFLICT DO NOTHING;

-- The insert trigger stamps the authenticated actor and appends audit events.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '90000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
INSERT INTO public.suppliers(id, tenant_id, cnpj, legal_name, category, status)
VALUES (
  '94000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '12345678000195',
  'Fornecedor Sintético Exclusivo A',
  'outros',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Synthetic contract and document expiry events for the notification dry-run.
-- These fixtures exist only in the disposable CI database.
INSERT INTO public.contracts(
  id,tenant_id,number,object,supplier_id,start_date,end_date,total_value,status,created_by,updated_by
)
VALUES(
  '95000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'E2E-2026-A',
  'Contrato sintético para teste de vencimento',
  '94000000-0000-4000-8000-000000000001',
  CURRENT_DATE-30,
  CURRENT_DATE+15,
  1000,
  'vigente',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_documents(
  id,tenant_id,supplier_id,title,document_type,issue_date,expires_at,storage_provider,status
)
VALUES(
  '96000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'Certidão federal sintética E2E A',
  'certidao_federal',
  CURRENT_DATE-30,
  CURRENT_DATE+10,
  'external_link',
  'active'
)
ON CONFLICT (id) DO NOTHING;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '90000000-0000-4000-8000-000000000002',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
INSERT INTO public.suppliers(id, tenant_id, cnpj, legal_name, category, status)
VALUES (
  '94000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  '98765432000198',
  'Fornecedor Sintético Exclusivo B',
  'outros',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.contracts(
  id,tenant_id,number,object,supplier_id,start_date,end_date,total_value,status,created_by,updated_by
)
VALUES(
  '95000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  'E2E-2026-B',
  'Contrato sintético para teste de vencimento',
  '94000000-0000-4000-8000-000000000002',
  CURRENT_DATE-30,
  CURRENT_DATE+20,
  1000,
  'vigente',
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000002'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_documents(
  id,tenant_id,supplier_id,title,document_type,issue_date,expires_at,storage_provider,status
)
VALUES(
  '96000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  '94000000-0000-4000-8000-000000000002',
  'Certidão federal sintética E2E B',
  'certidao_federal',
  CURRENT_DATE-30,
  CURRENT_DATE+10,
  'external_link',
  'active'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
