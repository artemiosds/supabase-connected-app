BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_billing_get_credentials()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_billing_get_credentials()', 'EXECUTE'),
  'platform_billing_get_credentials is strictly restricted to service_role'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_billing_set_payments_enabled(uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_billing_set_payments_enabled(uuid, boolean)', 'EXECUTE'),
  'platform_billing_set_payments_enabled is strictly restricted to service_role'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_billing_attach_payment_link(uuid, uuid, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_billing_attach_payment_link(uuid, uuid, text, text)', 'EXECUTE'),
  'platform_billing_attach_payment_link is strictly restricted to service_role'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.platform_billing_confirm_webhook_payment(text, uuid, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.platform_billing_confirm_webhook_payment(text, uuid, text, text)', 'EXECUTE'),
  'platform_billing_confirm_webhook_payment is strictly restricted to service_role'
);

SELECT * FROM extensions.finish();
ROLLBACK;
