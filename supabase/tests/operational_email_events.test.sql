BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '99000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'expiry-outbox@example.invalid',
  '',
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Synthetic Outbox User"}'::jsonb,
  pg_catalog.now(),
  pg_catalog.now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (
  id, name, slug, status, created_by, commercial_status, enabled_modules
) VALUES (
  '98000000-0000-4000-8000-000000000001',
  'Secretaria E2E Outbox',
  'secretaria-e2e-outbox',
  'active',
  '99000000-0000-4000-8000-000000000001',
  'active',
  '{"contratos":true,"documentos":true}'::jsonb
);


-- Isolate the trigger from unrelated contract validation while exercising the real outbox.
CREATE TEMP TABLE contracts(id uuid, tenant_id uuid, manager_user_id uuid, inspector_user_id uuid);
CREATE TRIGGER test_contract_notifications AFTER INSERT OR UPDATE ON contracts
 FOR EACH ROW EXECUTE FUNCTION app_auth.enqueue_operational_email();
INSERT INTO contracts VALUES(gen_random_uuid(),'98000000-0000-4000-8000-000000000001',
 '99000000-0000-4000-8000-000000000001',NULL);
UPDATE contracts SET manager_user_id=manager_user_id;
UPDATE contracts SET manager_user_id=NULL;
UPDATE contracts SET manager_user_id='99000000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*)::int FROM public.operational_email_events
 WHERE tenant_id='98000000-0000-4000-8000-000000000001' AND kind='manager' AND status='pending'),1,'repeated assignment creates one daily event');
SELECT extensions.is((SELECT count(*)::int FROM public.operational_email_events
 WHERE tenant_id='98000000-0000-4000-8000-000000000001' AND kind='inspector' AND status='skipped' AND reason='NO_ASSIGNEE'),1,'missing inspector is audited');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.operational_email_events','SELECT'),'outbox is private');
SELECT * FROM extensions.finish();
ROLLBACK;
