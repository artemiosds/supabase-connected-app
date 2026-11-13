-- Behavioral regression for the private expiry-notification outbox.
-- Uses synthetic tenants, users and deliveries in a rollback-only transaction.
-- This validates idempotency and retry state transitions without calling Resend.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(19);

SELECT extensions.ok(
  pg_catalog.to_regclass('public.expiry_notification_deliveries') IS NOT NULL,
  'private expiry outbox exists'
);

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

INSERT INTO public.expiry_notification_deliveries (
  id, tenant_id, entity_type, entity_id, recipient_user_id, alert_level, due_on
) VALUES (
  '97000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  'contract',
  '96000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  '30',
  CURRENT_DATE + 30
);

SELECT extensions.is(
  (SELECT status FROM public.expiry_notification_deliveries
   WHERE id='97000000-0000-4000-8000-000000000001'),
  'pending',
  'a new delivery starts pending'
);
SELECT extensions.is(
  (SELECT attempts::integer FROM public.expiry_notification_deliveries
   WHERE id='97000000-0000-4000-8000-000000000001'),
  0,
  'a new delivery starts with zero attempts'
);

SELECT extensions.throws_ok(
  $test$INSERT INTO public.expiry_notification_deliveries (
    tenant_id, entity_type, entity_id, recipient_user_id, alert_level, due_on
  ) VALUES (
    '98000000-0000-4000-8000-000000000001',
    'contract',
    '96000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000001',
    '30',
    CURRENT_DATE + 30
  )$test$,
  '23505',
  NULL,
  'the unique notification identity blocks duplicate deliveries'
);

SELECT extensions.is(
  (SELECT attempts::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001'
  )),
  1,
  'the first atomic claim increments attempts to one'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.expiry_notification_deliveries
    WHERE id='97000000-0000-4000-8000-000000000001'
      AND status='sending'
      AND attempts=1
      AND locked_at IS NOT NULL
  ),
  'claim moves the delivery into sending and records its lock time'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001'
  )),
  0,
  'a concurrent or repeated claim cannot claim an already-sending delivery'
);

SELECT extensions.is(
  public.finish_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001',
    'failed',
    NULL,
    'RESEND_HTTP_429'
  ),
  true,
  'a claimed delivery can be marked as a retryable provider failure'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.expiry_notification_deliveries
    WHERE id='97000000-0000-4000-8000-000000000001'
      AND status='failed'
      AND attempts=1
      AND locked_at IS NULL
      AND sent_at IS NULL
      AND last_error_code='RESEND_HTTP_429'
  ),
  'failed completion clears the lock and records the provider error'
);

SELECT extensions.is(
  (SELECT attempts::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001'
  )),
  2,
  'a failed delivery can be reclaimed and increments attempts'
);
SELECT extensions.is(
  public.finish_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001',
    'sent',
    'resend-synthetic-message-001',
    NULL
  ),
  true,
  'a claimed retry can be finalized as sent'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.expiry_notification_deliveries
    WHERE id='97000000-0000-4000-8000-000000000001'
      AND status='sent'
      AND attempts=2
      AND locked_at IS NULL
      AND sent_at IS NOT NULL
      AND provider_message_id='resend-synthetic-message-001'
      AND last_error_code IS NULL
  ),
  'successful completion records the provider ID and sent timestamp'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001'
  )),
  0,
  'a sent delivery can never be claimed again'
);
SELECT extensions.is(
  public.finish_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000001',
    'failed',
    NULL,
    'RESEND_HTTP_500'
  ),
  false,
  'a terminal delivery cannot be overwritten by a second completion'
);

INSERT INTO public.expiry_notification_deliveries (
  id, tenant_id, entity_type, entity_id, recipient_user_id, alert_level, due_on
) VALUES (
  '97000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000001',
  'supplier_document',
  '96000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000001',
  '60',
  CURRENT_DATE + 60
);

SELECT extensions.is(
  (SELECT attempts::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000002'
  )),
  1,
  'a second synthetic delivery can be claimed once'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000002'
  )),
  0,
  'ambiguous sending deliveries are not automatically reclaimed'
);

INSERT INTO public.expiry_notification_deliveries (
  id, tenant_id, entity_type, entity_id, recipient_user_id, alert_level, due_on
) VALUES (
  '97000000-0000-4000-8000-000000000003',
  '98000000-0000-4000-8000-000000000001',
  'contract',
  '96000000-0000-4000-8000-000000000003',
  '99000000-0000-4000-8000-000000000001',
  '90',
  CURRENT_DATE + 90
);

DO $attempt_limit$
DECLARE
  v_attempt integer;
  v_finished boolean;
BEGIN
  FOR v_attempt IN 1..5 LOOP
    PERFORM * FROM public.claim_expiry_notification_delivery(
      '97000000-0000-4000-8000-000000000003'
    );
    v_finished := public.finish_expiry_notification_delivery(
      '97000000-0000-4000-8000-000000000003',
      'failed',
      NULL,
      'SYNTHETIC_RETRY'
    );
    IF v_finished IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Synthetic outbox retry % did not complete.', v_attempt;
    END IF;
  END LOOP;
END;
$attempt_limit$;

SELECT extensions.is(
  (SELECT attempts::integer FROM public.expiry_notification_deliveries
   WHERE id='97000000-0000-4000-8000-000000000003'),
  5,
  'the retry loop stops at the configured five-attempt limit'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.claim_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000003'
  )),
  0,
  'a delivery at the attempt limit cannot be claimed again'
);
SELECT extensions.throws_ok(
  $test$SELECT public.finish_expiry_notification_delivery(
    '97000000-0000-4000-8000-000000000003','sending',NULL,NULL
  )$test$,
  '22023',
  NULL,
  'completion rejects unsupported delivery states'
);

SELECT * FROM extensions.finish();
ROLLBACK;
